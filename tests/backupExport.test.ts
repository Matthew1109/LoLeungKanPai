import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openBackup } from '../src/backup/backupFormat';
import { JournalChangedError, backupFileName, createBackup } from '../src/backup/exportBackup';
import { ZipReader } from '../src/backup/zip';
import { normaliseBackupState } from '../src/db/backupReminder';
import { getBackupStatus, recordBackupMade, snoozeReminder, takeSnapshot } from '../src/db/backupRepo';
import { getDb } from '../src/db';
import { getDataVersion } from '../src/db/changeSignal';
import { deleteEntry, saveEntry } from '../src/db/entryRepo';
import { META_KEYS } from '../src/db/metaRecords';
import { jpegPhoto, seedSampleJournal } from './backupHelpers';
import { clearAll, makeEntry } from './helpers';

beforeEach(clearAll);
afterEach(() => vi.unstubAllGlobals());

const backupState = async () => normaliseBackupState((await (await getDb()).get('meta', META_KEYS.backupState))?.value);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createBackup', () => {
  it('writes a backup that opens again and holds exactly what the journal holds', async () => {
    await seedSampleJournal();
    const progress: Array<[number, number]> = [];
    const created = await createBackup('0.2.0-test', (done, total) => { progress.push([done, total]); }, new Date(2026, 4, 10, 8, 0));

    expect(created.fileName).toBe('LoLeungKanPai-backup-2026-05-10.zip');
    expect(created.counts).toEqual({ entries: 3, tags: 3, photos: 2 });
    expect(progress).toEqual([[1, 2], [2, 2]]);

    const opened = await openBackup(created.blob);
    const db = await getDb();
    expect(opened.data.entries).toEqual(await db.getAll('entries'));
    expect(opened.data.tags).toEqual(await db.getAll('tags'));
    expect(opened.data.bars).toEqual(await db.getAll('bars'));
    expect(opened.data.bars.map((b) => b.name)).toEqual(['Pub']); // the bar of entry e3, registered when it was saved
    expect(opened.manifest.app).toBe('LoLeungKanPai');
    expect(opened.manifest.appVersion).toBe('0.2.0-test');
    expect(opened.manifest.createdAt).toBe(created.snapshotAt);
    const { first, last } = opened.manifest.dateRange;
    expect(first !== null && last !== null && first <= last).toBe(true);
    for (const id of ['p1', 'p2']) {
      const stored = await db.get('photos', id);
      expect(await opened.readPhoto(id)).toEqual(new Uint8Array(await (stored?.blob as Blob).arrayBuffer()));
      expect(opened.data.photos.find((p) => p.id === id)?.width).toBe(40);
    }
  });

  it('contains only manifest, data and photo files (thumbnails are regenerated on restore)', async () => {
    await seedSampleJournal();
    const created = await createBackup('t');
    const names = (await ZipReader.open(created.blob)).entries.map((e) => e.name).sort();
    expect(names).toEqual(['data.json', 'manifest.json', 'photos/p1.jpg', 'photos/p2.jpg']);
  });

  it('an empty journal gives a valid, empty backup', async () => {
    const created = await createBackup('t');
    const opened = await openBackup(created.blob);
    expect(opened.manifest.counts).toEqual({ entries: 0, tags: 0, photos: 0 });
    expect(opened.data.bars).toEqual([]);
    expect(opened.manifest.dateRange).toEqual({ first: null, last: null });
  });

  it('two entries sharing one photo give one photo file', async () => {
    const db = await getDb();
    const photo = jpegPhoto('shared');
    await db.put('photos', photo.record);
    await db.put('thumbs', { id: 'shared', blob: photo.thumb });
    await db.put('entries', makeEntry('a', '2026-05-01', 20, { photoId: 'shared' }));
    await db.put('entries', makeEntry('b', '2026-05-02', 20, { photoId: 'shared' }));
    const opened = await openBackup((await createBackup('t')).blob);
    expect(opened.manifest.counts.photos).toBe(1);
    expect(opened.data.entries.map((e) => e.photoId)).toEqual(['shared', 'shared']);
  });

  it('does not change the journal and does not mark the backup as made (that happens after the hand-over)', async () => {
    await seedSampleJournal();
    const before = await backupState();
    const db = await getDb();
    const entriesBefore = await db.getAll('entries');
    await createBackup('t');
    expect(await backupState()).toEqual(before);
    expect(await db.getAll('entries')).toEqual(entriesBefore);
    expect(before.lastBackupAt).toBeNull();
  });

  it('a photo that vanishes while the file is built (entry deleted meanwhile) fails cleanly with JournalChangedError', async () => {
    await seedSampleJournal();
    await expect(
      createBackup('t', async (done) => {
        if (done === 1) await deleteEntry('e2'); // e2 owns p2, which is read next
      }),
    ).rejects.toThrow(JournalChangedError);
    expect((await backupState()).lastBackupAt).toBeNull(); // nothing was recorded
  });

  it('backupFileName uses the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('LoLeungKanPai-backup-2026-01-05.zip');
  });
});

describe('export while editing', () => {
  it('entries saved or edited while the file is being built stay "changed" after the backup is recorded', async () => {
    await seedSampleJournal();
    await sleep(3);
    const lateStamp: { updatedAt?: string } = {};
    const created = await createBackup('t', async (done) => {
      if (done !== 1) return;
      lateStamp.updatedAt = (await saveEntry(makeEntry('late', '2026-05-09', 20))).updatedAt; // a NEW entry, after the snapshot
      await saveEntry({ ...makeEntry('e3', '2026-05-03', 22), drinkName: 'Pilsner (edited during backup)' }); // an EDIT
    });

    const opened = await openBackup(created.blob);
    expect(opened.data.entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']); // the snapshot is consistent: no 'late'
    expect(opened.data.entries.find((e) => e.id === 'e3')?.drinkName).toBe('Pilsner'); // ... and the pre-edit text
    expect((lateStamp.updatedAt as string) > created.snapshotAt).toBe(true);

    await recordBackupMade(created.snapshotAt);
    const state = await backupState();
    expect(state.lastBackupAt).toBe(created.snapshotAt);
    expect(Object.keys(state.changed).sort()).toEqual(['e3', 'late']); // unprotected: they are not (all) in the file
  });

  it('everything saved before the backup started is cleared by recordBackupMade', async () => {
    await seedSampleJournal();
    expect(Object.keys((await backupState()).changed).sort()).toEqual(['e1', 'e2', 'e3']);
    const created = await createBackup('t');
    await recordBackupMade(created.snapshotAt);
    expect(await backupState()).toEqual({ lastBackupAt: created.snapshotAt, changed: {} });
  });

  it('a backup that is made but never handed over (cancelled share) leaves the bookkeeping untouched', async () => {
    await seedSampleJournal();
    const before = await backupState();
    await createBackup('t'); // the user then cancelled: recordBackupMade is simply not called
    expect(await backupState()).toEqual(before);
  });

  it('property: whatever is stamped at or before the snapshot instant is IN the snapshot', async () => {
    for (let trial = 0; trial < 12; trial++) {
      await clearAll();
      const snapshotP = takeSnapshot();
      await sleep(trial % 4); // 0..3 ms: before, inside and after the read
      const saved = await saveEntry(makeEntry(`x${trial}`, '2026-05-01', 20));
      const snap = await snapshotP;
      if (saved.updatedAt <= snap.at) expect(snap.entries.map((e) => e.id)).toContain(saved.id);
    }
  });

  it('recordBackupMade is safe next to a concurrent edit (both land)', async () => {
    await seedSampleJournal();
    const created = await createBackup('t');
    await sleep(3);
    await Promise.all([recordBackupMade(created.snapshotAt), saveEntry(makeEntry('concurrent', '2026-05-09', 20))]);
    const state = await backupState();
    expect(state.lastBackupAt).toBe(created.snapshotAt);
    expect(Object.keys(state.changed)).toEqual(['concurrent']);
  });
});

describe('backup reminder, end to end', () => {
  const NOW = new Date();
  const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
  const saveMany = async (n: number, prefix = 'm') => {
    for (let i = 0; i < n; i++) await saveEntry(makeEntry(`${prefix}${i}`, '2026-05-01', 20));
  };

  it('no entries: nothing to protect', async () => {
    const status = await getBackupStatus(NOW);
    expect(status).toMatchObject({ lastBackupAt: null, entryCount: 0, photoCount: 0 });
    expect(status.reminder.due).toBe(false);
  });

  it('10 entries never backed up: due; after a backup: not due; 10 more edits: due again', async () => {
    await saveMany(10);
    expect((await getBackupStatus(NOW)).reminder).toMatchObject({ due: true, reason: 'changes' });

    const created = await createBackup('t');
    await recordBackupMade(created.snapshotAt);
    const after = await getBackupStatus(NOW);
    expect(after.reminder.due).toBe(false);
    expect(after.lastBackupAt).toBe(created.snapshotAt);

    await sleep(3);
    await saveMany(9, 'n');
    expect((await getBackupStatus(NOW)).reminder.due).toBe(false);
    await saveMany(1, 'z');
    expect((await getBackupStatus(NOW)).reminder).toMatchObject({ due: true, reason: 'changes' });
  });

  it('30 days after the last backup with at least one change: due by age', async () => {
    await saveMany(1);
    const created = await createBackup('t');
    await recordBackupMade(created.snapshotAt);
    await sleep(3);
    await saveEntry(makeEntry('m0', '2026-05-01', 20, { notes: 'changed' }));
    expect((await getBackupStatus(inDays(29))).reminder.due).toBe(false);
    expect((await getBackupStatus(inDays(31))).reminder).toMatchObject({ due: true, reason: 'age' });
  });

  it('"Later" hides the reminder for 24 hours, then it returns', async () => {
    await saveMany(10);
    expect((await getBackupStatus(NOW)).reminder.due).toBe(true);
    await snoozeReminder(NOW);
    expect((await getBackupStatus(NOW)).reminder.due).toBe(false);
    expect((await getBackupStatus(new Date(NOW.getTime() + 23 * 3_600_000))).reminder.due).toBe(false);
    expect((await getBackupStatus(new Date(NOW.getTime() + 24 * 3_600_000 + 1))).reminder.due).toBe(true);
  });

  it('counts entries and distinct photos', async () => {
    await seedSampleJournal();
    const status = await getBackupStatus(NOW);
    expect(status.entryCount).toBe(3);
    expect(status.photoCount).toBe(2);
  });

  it('recording a backup and snoozing both tell open screens that data changed', async () => {
    await seedSampleJournal();
    const created = await createBackup('t');
    const v0 = getDataVersion();
    await recordBackupMade(created.snapshotAt);
    expect(getDataVersion()).toBeGreaterThan(v0);
    const v1 = getDataVersion();
    await snoozeReminder(NOW);
    expect(getDataVersion()).toBeGreaterThan(v1);
  });
});
