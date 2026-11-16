import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openBackup, type OpenedBackup } from '../src/backup/backupFormat';
import { createBackup } from '../src/backup/exportBackup';
import {
  RestoreAbortedError, RestoreUnsupportedError, commitRestore, restoreBackup,
  type CommitPlan, type RestoreDeps, type RestoreProgress,
} from '../src/backup/restore';
import { getDb } from '../src/db';
import { getDataVersion } from '../src/db/changeSignal';
import { saveEntry } from '../src/db/entryRepo';
import { RestoreInProgressError, StorageFullError } from '../src/db/errors';
import { MAINTENANCE_LOCK_NAME } from '../src/db/locks';
import { sweepOrphanPhotos } from '../src/db/maintenance';
import { META_KEYS } from '../src/db/metaRecords';
import { backupBlob, bar, cloneParts, jpegPhoto, sampleParts, seedSampleJournal, tag } from './backupHelpers';
import { clearAll, hasRestoreSession, makeEntry, storedPhotoKeys, stubNoWebLocks, stubWebLocks } from './helpers';

beforeEach(clearAll);
afterEach(() => vi.unstubAllGlobals());

/* ---------- helpers ---------- */

const NOW = new Date('2026-05-11T10:00:00.000Z');
const THUMB = (size: number) => new Blob([`thumb-made-from-${size}-bytes`], { type: 'image/jpeg' });

function makeDeps(over: Partial<RestoreDeps> = {}): RestoreDeps {
  let n = 0;
  return {
    makeThumb: async (jpeg) => ({ thumb: THUMB(jpeg.size), width: 40, height: 30 }),
    newId: () => `new-${++n}`, // the first id is the session id, then one per photo in entry order
    now: () => NOW,
    freeBytes: async () => null,
    ...over,
  };
}

/** Every store, with Blobs reduced to "size:type" so two dumps can be compared. */
async function dump(): Promise<Record<string, unknown[]>> {
  const db = await getDb();
  const out: Record<string, unknown[]> = {};
  for (const name of ['entries', 'tags', 'bars', 'photos', 'thumbs', 'dayCovers', 'meta'] as const) {
    out[name] = (await db.getAll(name)).map((row) => {
      const copy = { ...(row as unknown as Record<string, unknown>) };
      if (copy.blob instanceof Blob) copy.blob = `${copy.blob.size}:${copy.blob.type}`;
      return copy;
    });
  }
  return out;
}

const metaKeys = async () => (await (await getDb()).getAllKeys('meta')).sort();
const poison = () => ({ get boom(): never { throw new DOMException('full', 'QuotaExceededError'); } });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const open = (parts = sampleParts()): Promise<OpenedBackup> => openBackup(backupBlob(parts));

/** A journal that is NOT the backup's: its own tag, bar, entry, photo, a form draft and a changed-entries record. */
async function seedOldJournal(): Promise<void> {
  const db = await getDb();
  await db.put('tags', tag('old-t', 'Old tag', 'INGREDIENT'));
  await db.put('bars', bar('old-b', 'Old Bar'));
  await saveEntry(makeEntry('old-e1', '2026-01-01', 12, { photoId: null, ingredientTagIds: ['old-t'] }), { kind: 'replace', ...jpegPhoto('old-p1') });
  await db.put('meta', { key: META_KEYS.entryDraft, value: { entryId: 'old-e1', note: 'unsaved text' } });
}

const planFor = (over: Partial<CommitPlan> = {}): CommitPlan => {
  const parts = sampleParts();
  return {
    sessionId: 's1',
    entries: parts.data.entries.map((e) => ({ ...e, photoId: e.photoId === 'p1' ? 'n1' : e.photoId === 'p2' ? 'n2' : null })),
    tags: parts.data.tags,
    bars: parts.data.bars,
    stagedIds: ['n1', 'n2'],
    backupCreatedAt: parts.manifest.createdAt,
    at: NOW.toISOString(),
    ...over,
  };
};

/** The state a restore leaves just before its commit: own session record + staged photos and thumbnails. */
async function stageForCommit(opts: { sessionId?: string | null; photos?: string[]; thumbs?: string[] } = {}): Promise<void> {
  const db = await getDb();
  if (opts.sessionId !== null) {
    await db.put('meta', { key: META_KEYS.restoreSession, value: { sessionId: opts.sessionId ?? 's1', startedAt: NOW.toISOString(), phase: 'staging' } });
  }
  for (const id of opts.photos ?? ['n1', 'n2']) await db.put('photos', jpegPhoto(id).record);
  for (const id of opts.thumbs ?? ['n1', 'n2']) await db.put('thumbs', { id, blob: new Blob([`t-${id}`]) });
}

async function expectAborted(reason: RestoreAbortedError['reason'], plan: CommitPlan = planFor()): Promise<void> {
  const before = await dump();
  try {
    await commitRestore(plan);
  } catch (err) {
    expect(err).toBeInstanceOf(RestoreAbortedError);
    expect((err as RestoreAbortedError).reason).toBe(reason);
    expect(await dump()).toEqual(before); // entries, tags, photos, thumbs, meta: exactly as before
    return;
  }
  throw new Error('the commit should have been refused');
}

/* ---------- the restore itself ---------- */

describe('restoreBackup: success', () => {
  it('replaces entries and tags, stores the photos under NEW ids, regenerates thumbnails and resets the bookkeeping', async () => {
    const locks = stubWebLocks();
    await seedOldJournal();
    const backup = await open();
    const v0 = getDataVersion();
    const steps: RestoreProgress[] = [];

    const result = await restoreBackup(backup, makeDeps(), (p) => steps.push({ ...p }));

    expect(result).toEqual({ entries: 3, tags: 3, photos: 2, cleanupPending: false });
    const db = await getDb();
    const parts = sampleParts();
    expect(await db.getAll('entries')).toEqual(
      parts.data.entries.map((e) => ({ ...e, photoId: e.photoId === 'p1' ? 'new-2' : e.photoId === 'p2' ? 'new-3' : null })),
    );
    expect(await db.getAll('tags')).toEqual([...parts.data.tags].sort((a, b) => (a.id < b.id ? -1 : 1))); // stored in key order
    expect(await db.getAll('bars')).toEqual(parts.data.bars); // the backup's bars; the old journal's bar is gone

    // photos: only the two new ones; the old photo was swept; backup ids are not reused
    expect(await storedPhotoKeys()).toEqual({ photos: ['new-2', 'new-3'], thumbs: ['new-2', 'new-3'] });
    const photo = await db.get('photos', 'new-2');
    expect(new Uint8Array(await (photo?.blob as Blob).arrayBuffer())).toEqual(parts.photos.p1);
    expect(photo).toMatchObject({ id: 'new-2', mime: 'image/jpeg', size: parts.photos.p1.length, width: 40, height: 30, createdAt: parts.data.photos[0].createdAt });
    const thumb = await db.get('thumbs', 'new-3');
    expect(thumb?.blob.size).toBe(THUMB(parts.photos.p2.length).size); // made by makeThumb, not taken from the backup

    // bookkeeping: the restored backup is the new reference point; draft and session record are gone
    expect(await metaKeys()).toEqual([META_KEYS.backupState, META_KEYS.lastRestore]);
    expect((await db.get('meta', META_KEYS.backupState))?.value).toEqual({ lastBackupAt: parts.manifest.createdAt, changed: {} });
    expect((await db.get('meta', META_KEYS.lastRestore))?.value).toEqual({
      at: NOW.toISOString(), backupCreatedAt: parts.manifest.createdAt, entries: 3, tags: 3, photos: 2,
    });
    expect(await hasRestoreSession()).toBe(false);

    // one exclusive, waiting lock for the whole run; screens were told to reload
    expect(locks.calls).toEqual([{ name: MAINTENANCE_LOCK_NAME, options: { mode: 'exclusive', ifAvailable: false } }]);
    expect(locks.events).toEqual(['acquired', 'released']);
    expect(getDataVersion()).toBeGreaterThan(v0);
    expect(steps.map((s) => `${s.step}:${s.done}/${s.total}`)).toEqual([
      'preparing:0/1', 'staging:0/2', 'staging:1/2', 'committing:0/1', 'cleaning:0/1',
    ]);
  });

  it('the full round trip: create a backup, lose everything, restore it', async () => {
    stubWebLocks();
    await seedSampleJournal();
    const db = await getDb();
    const originalEntries = await db.getAll('entries');
    const originalTags = await db.getAll('tags');
    const originalBars = await db.getAll('bars');
    expect(originalBars.map((b) => b.name)).toEqual(['Pub']); // registered when e3 was saved
    const originalBytes = new Map<string, Uint8Array>();
    for (const id of ['p1', 'p2']) originalBytes.set(id, new Uint8Array(await ((await db.get('photos', id))?.blob as Blob).arrayBuffer()));
    const created = await createBackup('t');

    await clearAll();
    expect(await db.getAll('entries')).toEqual([]);
    await restoreBackup(await openBackup(created.blob), makeDeps());

    const restored = await db.getAll('entries');
    expect(restored.map((e) => ({ ...e, photoId: null }))).toEqual(originalEntries.map((e) => ({ ...e, photoId: null })));
    expect(await db.getAll('tags')).toEqual(originalTags);
    expect(await db.getAll('bars')).toEqual(originalBars);
    const byEntry = new Map(restored.map((e) => [e.id, e.photoId as string | null]));
    expect(byEntry.get('e3')).toBeNull();
    for (const [entryId, oldPhotoId] of [['e1', 'p1'], ['e2', 'p2']]) {
      const newId = byEntry.get(entryId) as string;
      expect(newId).not.toBe(oldPhotoId);
      expect(new Uint8Array(await ((await db.get('photos', newId))?.blob as Blob).arrayBuffer())).toEqual(originalBytes.get(oldPhotoId));
      expect(await db.get('thumbs', newId)).toBeDefined();
    }
  });

  it('a backup made before the Bar library (no bars in it) gets its bars from the drinks', async () => {
    stubWebLocks();
    await seedOldJournal();
    const parts = sampleParts();
    const { entries, tags, photos } = parts.data;
    const old = backupBlob(parts, { rawData: new TextEncoder().encode(JSON.stringify({ entries, tags, photos })) });
    await restoreBackup(await openBackup(old), makeDeps());
    const bars = await (await getDb()).getAll('bars');
    expect(bars).toEqual([{ id: 'new-4', name: 'Pub', nameKey: 'pub', isArchived: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }]);
    expect((await storedPhotoKeys()).photos).toEqual(['new-2', 'new-3']); // photo ids are not disturbed by the extra id
  });

  it('keeps the backup\'s own bars as they are (archived ones too) and adds only the bars its drinks still need', async () => {
    stubWebLocks();
    const parts = cloneParts(sampleParts());
    parts.data.bars = [bar('b-closed', 'Closed Bar', { isArchived: true })]; // no "Pub" in the list although e3 is there
    parts.data.entries[0].barName = 'closed  BAR'; // an archived bar still counts as known: no duplicate is made
    await restoreBackup(await open(parts), makeDeps());
    const bars = await (await getDb()).getAll('bars');
    expect(bars.map((b) => [b.id, b.name, b.isArchived])).toEqual([['b-closed', 'Closed Bar', true], ['new-4', 'Pub', false]]);
  });

  it('restoring into the SAME device never overwrites a photo: the old copies are swept only after the commit', async () => {
    stubWebLocks();
    await seedSampleJournal(); // photos p1, p2 exist, with the same ids as in the backup
    const created = await createBackup('t');
    const during: string[][] = [];
    await restoreBackup(await openBackup(created.blob), makeDeps({
      makeThumb: async (jpeg) => {
        during.push((await storedPhotoKeys()).photos);
        return { thumb: THUMB(jpeg.size), width: 40, height: 30 };
      },
    }));
    expect(during[0]).toEqual(['p1', 'p2']); // first photo: only the old ones
    expect(during[1]).toEqual(['new-2', 'p1', 'p2']); // second photo: one staged next to the old ones
    expect((await storedPhotoKeys()).photos).toEqual(['new-2', 'new-3']);
  });

  it('two entries sharing one photo stay sharing it (one staged photo)', async () => {
    stubWebLocks();
    const parts = cloneParts(sampleParts());
    parts.data.entries[1].photoId = 'p1';
    delete parts.photos.p2;
    parts.data.photos = parts.data.photos.filter((p) => p.id === 'p1');
    parts.manifest.counts.photos = 1;
    await restoreBackup(await open(parts), makeDeps());
    const entries = await (await getDb()).getAll('entries');
    expect(entries.filter((e) => e.photoId).map((e) => e.photoId)).toEqual(['new-2', 'new-2']);
    expect((await storedPhotoKeys()).photos).toEqual(['new-2']);
  });

  it('a backup of an empty journal empties the journal', async () => {
    stubWebLocks();
    await seedOldJournal();
    const parts = sampleParts();
    parts.data = { entries: [], tags: [], bars: [], photos: [] };
    parts.photos = {};
    parts.manifest.counts = { entries: 0, tags: 0, photos: 0 };
    const result = await restoreBackup(await open(parts), makeDeps());
    expect(result).toMatchObject({ entries: 0, tags: 0, photos: 0 });
    const state = await dump();
    expect(state.entries).toEqual([]);
    expect(state.bars).toEqual([]); // the old journal's bar is gone too
    expect(state.photos).toEqual([]);
    expect(state.thumbs).toEqual([]);
  });

  it('after a restore the journal can be edited again', async () => {
    stubWebLocks();
    await restoreBackup(await open(), makeDeps());
    await expect(saveEntry(makeEntry('after', '2026-05-12', 20))).resolves.toBeDefined();
  });

  it('two restores started together run one after the other (the second wins)', async () => {
    const locks = stubWebLocks();
    const first = await open();
    const parts = cloneParts(sampleParts());
    parts.data.entries = [parts.data.entries[2]];
    parts.data.photos = [];
    parts.photos = {};
    parts.data.tags = parts.data.tags.filter((t) => t.id === 't-old');
    parts.manifest.counts = { entries: 1, tags: 1, photos: 0 };
    const second = await open(parts);
    await Promise.all([restoreBackup(first, makeDeps()), restoreBackup(second, makeDeps())]);
    expect(locks.events).toEqual(['acquired', 'released', 'acquired', 'released']);
    expect((await (await getDb()).getAll('entries')).map((e) => e.id)).toEqual(['e3']);
    expect((await storedPhotoKeys()).photos).toEqual([]);
  });
});

describe('restoreBackup: refusing and failing without losing anything', () => {
  it('without Web Locks nothing is touched and the restore is refused', async () => {
    stubNoWebLocks();
    await seedOldJournal();
    const before = await dump();
    await expect(restoreBackup(await open(), makeDeps())).rejects.toThrow(RestoreUnsupportedError);
    expect(await dump()).toEqual(before);
  });

  it('opening a damaged or unsuitable backup writes nothing at all (pass 1 never writes)', async () => {
    stubWebLocks();
    await seedOldJournal();
    const before = await dump();
    const damaged = backupBlob(sampleParts(), { omit: ['photos/p2.jpg'] });
    await expect(openBackup(damaged)).rejects.toThrow();
    await expect(openBackup(new Blob(['not a zip']))).rejects.toThrow();
    expect(await dump()).toEqual(before);
  });

  it('not enough free space is reported before anything is written', async () => {
    stubWebLocks();
    await seedOldJournal();
    const before = await dump();
    await expect(restoreBackup(await open(), makeDeps({ freeBytes: async () => 1000 }))).rejects.toThrow(StorageFullError);
    expect(await dump()).toEqual(before);
  });

  it('a browser that cannot report free space does not block the restore', async () => {
    stubWebLocks();
    await expect(restoreBackup(await open(), makeDeps({ freeBytes: async () => null }))).resolves.toBeDefined();
  });

  it('a photo that cannot be decoded (second one) leaves the journal exactly as it was and removes what was staged', async () => {
    stubWebLocks();
    await seedOldJournal();
    const before = await dump();
    let calls = 0;
    const decodeFails = new Error('DECODE_FAILED');
    await expect(
      restoreBackup(await open(), makeDeps({
        makeThumb: async (jpeg) => {
          if (++calls === 2) throw decodeFails;
          return { thumb: THUMB(jpeg.size), width: 40, height: 30 };
        },
      })),
    ).rejects.toThrow('DECODE_FAILED');
    expect(await dump()).toEqual(before);
    expect(await hasRestoreSession()).toBe(false);
  });

  it('storage running out while a photo is staged: StorageFullError, journal untouched, staged photos and record removed', async () => {
    stubWebLocks();
    await seedOldJournal();
    const before = await dump();
    let calls = 0;
    await expect(
      restoreBackup(await open(), makeDeps({
        makeThumb: async (jpeg) => ({ thumb: ++calls === 2 ? (poison() as unknown as Blob) : THUMB(jpeg.size), width: 40, height: 30 }),
      })),
    ).rejects.toThrow(StorageFullError);
    expect(await dump()).toEqual(before);
  });

  it('a failure INSIDE the commit (after entries were cleared) rolls the whole commit back', async () => {
    stubWebLocks();
    await seedOldJournal();
    const before = await dump();
    const backup = await open();
    backup.data.entries[1] = { ...backup.data.entries[1], notes: poison() as unknown as string };
    await expect(restoreBackup(backup, makeDeps())).rejects.toThrow(StorageFullError);
    expect(await dump()).toEqual(before); // old entries, tags, photos, draft: all still there
    expect(await hasRestoreSession()).toBe(false);
  });

  it('if the session record vanishes during staging, the commit is refused and the journal stays; the sweep removes the staged photos', async () => {
    stubWebLocks();
    await seedOldJournal();
    const before = await dump();
    let calls = 0;
    await expect(
      restoreBackup(await open(), makeDeps({
        makeThumb: async (jpeg) => {
          if (++calls === 2) await (await getDb()).delete('meta', META_KEYS.restoreSession); // e.g. somebody cleared it
          return { thumb: THUMB(jpeg.size), width: 40, height: 30 };
        },
      })),
    ).rejects.toThrow(RestoreAbortedError);
    const after = await dump();
    expect(after.entries).toEqual(before.entries);
    expect(after.tags).toEqual(before.tags);
    expect(await metaKeys()).toEqual([META_KEYS.backupState, META_KEYS.entryDraft]);
    await sweepOrphanPhotos();
    expect(await dump()).toEqual(before); // staged leftovers are gone after the next sweep
  });

  it('a failed restore can simply be tried again', async () => {
    stubWebLocks();
    let calls = 0;
    const flaky = makeDeps({
      makeThumb: async (jpeg) => {
        if (++calls === 1) throw new Error('first attempt fails');
        return { thumb: THUMB(jpeg.size), width: 40, height: 30 };
      },
    });
    await expect(restoreBackup(await open(), flaky)).rejects.toThrow('first attempt fails');
    await expect(restoreBackup(await open(), makeDeps())).resolves.toMatchObject({ entries: 3 });
  });
});

describe('restoreBackup: while it runs, a second tab', () => {
  it('cannot sweep away the staged photos and cannot save entries; afterwards both work', async () => {
    stubWebLocks();
    await seedOldJournal();
    const reached = deferred();
    const gate = deferred();
    let calls = 0;
    const observed: Record<string, unknown> = {};
    const run = restoreBackup(await open(), makeDeps({
      makeThumb: async (jpeg) => {
        if (++calls === 2) {
          reached.resolve();
          await gate.promise; // the restoring page is "suspended" here, holding the lock
        }
        return { thumb: THUMB(jpeg.size), width: 40, height: 30 };
      },
    }));
    await reached.promise;

    observed.sweep = await sweepOrphanPhotos();
    observed.session = await hasRestoreSession();
    observed.photos = (await storedPhotoKeys()).photos;
    await expect(saveEntry(makeEntry('other-tab', '2026-05-12', 20))).rejects.toThrow(RestoreInProgressError);
    expect(observed.sweep).toMatchObject({ skipped: true });
    expect(observed.session).toBe(true);
    expect(observed.photos).toEqual(['new-2', 'old-p1']); // the staged photo survived the other tab's sweep

    gate.resolve();
    await expect(run).resolves.toMatchObject({ entries: 3 });
    await expect(saveEntry(makeEntry('other-tab', '2026-05-12', 20))).resolves.toBeDefined();
  });

  it('a restore whose page died (lock free, record and staged photos left behind) is cleaned up by the next sweep', async () => {
    stubWebLocks();
    await seedOldJournal();
    await stageForCommit(); // what a killed restore leaves behind
    const entriesBefore = (await dump()).entries;
    await expect(saveEntry(makeEntry('x', '2026-05-12', 20))).resolves.toBeDefined(); // refused once, sweeps, retries
    expect(await hasRestoreSession()).toBe(false);
    expect((await storedPhotoKeys()).photos).toEqual(['old-p1']);
    expect((await dump()).entries.length).toBe(entriesBefore.length + 1);
  });
});

/* ---------- the pre-commit checks (E3 v3, section 9 step 7) ---------- */

describe('commitRestore: the commit', () => {
  async function seedForCommit(): Promise<void> {
    await seedOldJournal();
    await stageForCommit();
  }

  it('replaces the journal in one go and deletes its own session record and the form draft', async () => {
    await seedForCommit();
    await commitRestore(planFor());
    const state = await dump();
    expect((state.entries as Array<{ id: string }>).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect((state.tags as Array<{ id: string }>).map((t) => t.id)).toEqual(['t-gin', 't-lime', 't-old']);
    expect((state.bars as Array<{ id: string }>).map((b) => b.id)).toEqual(['b-pub']);
    expect(await metaKeys()).toEqual([META_KEYS.backupState, META_KEYS.lastRestore]);
  });

  it('never writes to photos or thumbnails (read-only use): the old photo is still there until the sweep', async () => {
    await seedForCommit();
    const before = (await dump()) as { photos: unknown[]; thumbs: unknown[] };
    await commitRestore(planFor());
    const after = (await dump()) as { photos: unknown[]; thumbs: unknown[] };
    expect(after.photos).toEqual(before.photos);
    expect(after.thumbs).toEqual(before.thumbs);
    expect((await storedPhotoKeys()).photos).toEqual(['n1', 'n2', 'old-p1']);
  });

  it('is refused, changing NOTHING, when its session record is gone', async () => {
    await seedOldJournal();
    await stageForCommit({ sessionId: null });
    await expectAborted('SESSION_LOST');
  });

  it('is refused, changing NOTHING, when the session record belongs to another restore', async () => {
    await seedOldJournal();
    await stageForCommit({ sessionId: 'somebody-else' });
    await expectAborted('SESSION_LOST');
  });

  it('is refused, changing NOTHING, when the session record is junk', async () => {
    await seedOldJournal();
    await stageForCommit({ sessionId: null });
    await (await getDb()).put('meta', { key: META_KEYS.restoreSession, value: 'junk' });
    await expectAborted('SESSION_LOST');
  });

  it('is refused, changing NOTHING, when a staged photo is missing', async () => {
    await seedOldJournal();
    await stageForCommit({ photos: ['n1'] });
    await expectAborted('STAGED_PHOTO_MISSING');
  });

  it('is refused, changing NOTHING, when a staged thumbnail is missing', async () => {
    await seedOldJournal();
    await stageForCommit({ thumbs: ['n2'] });
    await expectAborted('STAGED_PHOTO_MISSING');
  });

  it('rolls back completely when a write fails after the entries were cleared', async () => {
    await seedOldJournal();
    await stageForCommit();
    const before = await dump();
    const plan = planFor();
    plan.entries[2] = { ...plan.entries[2], notes: poison() as unknown as string };
    await expect(commitRestore(plan)).rejects.toThrow(StorageFullError);
    expect(await dump()).toEqual(before);
  });

  it('with nothing staged (no photos in the backup) only the session record is needed', async () => {
    await seedOldJournal();
    await stageForCommit({ photos: [], thumbs: [] });
    await commitRestore(planFor({ stagedIds: [], entries: [makeEntry('only', '2026-05-01')], tags: [] }));
    expect(((await dump()).entries as Array<{ id: string }>).map((e) => e.id)).toEqual(['only']);
  });
});
