import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db';
import { deleteEntry, getEntriesForDay, getEntry, saveEntry, setEntryFavourite } from '../src/db/entryRepo';
import { EntryValidationError, RestoreInProgressError } from '../src/db/errors';
import { META_KEYS } from '../src/db/metaRecords';
import { normaliseBackupState } from '../src/db/backupReminder';
import { parseEntryDraft, type EntryDraft } from '../src/db/entryDraft';
import { clearEntryDraftFor, getEntryDraft, saveEntryDraft } from '../src/db/draftRepo';
import { resolveCoverEntry } from '../src/utils/cover';
import {
  at, clearAll, hasRestoreSession, makeEntry, makePhoto, putRestoreSession, stagePhotos, storedPhotoKeys,
  stubNoWebLocks, stubWebLocks,
} from './helpers';

const DAY = '2026-05-07';
beforeEach(clearAll);
afterEach(() => vi.unstubAllGlobals());

describe('saveEntry: create and edit', () => {
  it('stores the entry and derives dayKey from the LOCAL date of dateTime, ignoring a wrong dayKey', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20, { dayKey: '1999-01-01', alcoholPercentage: 12.5, alcoholVolumeMl: 90 }));
    expect(saved.dayKey).toBe(DAY);
    expect(saved.dateTime).toBe(at(DAY, 20));
    expect(await getEntry('a')).toEqual(saved);
    expect(saved.alcoholPercentage).toBe(12.5);
    expect(saved.alcoholVolumeMl).toBe(90);
  });

  it('editing the same id never creates a duplicate, keeps createdAt and refreshes updatedAt', async () => {
    const first = await saveEntry(makeEntry('a', DAY, 20));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await saveEntry({ ...first, drinkName: 'Renamed', createdAt: '1999-01-01T00:00:00.000Z' });
    expect(await getEntriesForDay(DAY)).toHaveLength(1);
    expect(second.drinkName).toBe('Renamed');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  it('two quick saves of the same reserved id (double tap) still leave one entry', async () => {
    const entry = makeEntry('reserved-id', DAY, 20);
    await Promise.all([saveEntry(entry), saveEntry({ ...entry, notes: 'second tap' })]);
    expect(await getEntriesForDay(DAY)).toHaveLength(1);
  });

  it('changing the date moves the entry to the other day', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20));
    await saveEntry({ ...saved, dateTime: at('2026-05-09', 9) });
    expect(await getEntriesForDay(DAY)).toHaveLength(0);
    expect((await getEntriesForDay('2026-05-09')).map((e) => e.id)).toEqual(['a']);
    expect((await getEntry('a'))?.dayKey).toBe('2026-05-09');
  });

  it('allows several entries on one day', async () => {
    await saveEntry(makeEntry('a', DAY, 20));
    await saveEntry(makeEntry('b', DAY, 21));
    expect((await getEntriesForDay(DAY)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('preserves tag ids on edit (tag pickers arrive in Phase 3)', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20, { baseSpiritTagIds: ['t1', 't2'], ingredientTagIds: ['t3'] }));
    await saveEntry({ ...saved, notes: 'edited' });
    const again = await getEntry('a');
    expect(again?.baseSpiritTagIds).toEqual(['t1', 't2']);
    expect(again?.ingredientTagIds).toEqual(['t3']);
  });
});

describe('saveEntry: validation and atomicity', () => {
  it('rejects bad ABV, volume, date and writes nothing', async () => {
    for (const patch of [
      { alcoholPercentage: 101 },
      { alcoholPercentage: -1 },
      { alcoholVolumeMl: 0 },
      { alcoholVolumeMl: 5001 },
      { dateTime: 'nonsense' },
    ]) {
      await expect(saveEntry(makeEntry('bad', DAY, 20, patch))).rejects.toBeInstanceOf(EntryValidationError);
    }
    expect(await getEntry('bad')).toBeUndefined();
  });

  it('rolls EVERYTHING back when a later step of the save fails (entry, photo and bookkeeping)', async () => {
    const p = makePhoto('p1');
    const broken = { record: { ...p.record, blob: (() => 1) as unknown as Blob }, thumb: p.thumb }; // cannot be stored
    await expect(saveEntry(makeEntry('x', DAY, 20), { kind: 'replace', ...broken })).rejects.toThrow();
    expect(await getEntry('x')).toBeUndefined();
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
    const db = await getDb();
    expect(await db.get('meta', META_KEYS.backupState)).toBeUndefined();
  });

  it('a failed edit leaves the stored entry and its photo exactly as they were', async () => {
    const p = makePhoto('p1');
    const saved = await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...p });
    const broken = { record: { ...makePhoto('p2').record, blob: (() => 1) as unknown as Blob }, thumb: p.thumb };
    await expect(saveEntry({ ...saved, drinkName: 'changed' }, { kind: 'replace', ...broken })).rejects.toThrow();
    expect(await getEntry('a')).toEqual(saved);
    expect(await storedPhotoKeys()).toEqual({ photos: ['p1'], thumbs: ['p1'] });
  });
});

describe('photos', () => {
  it('stores photo + thumbnail with the entry and points photoId at them', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('p1') });
    expect(saved.photoId).toBe('p1');
    expect(await storedPhotoKeys()).toEqual({ photos: ['p1'], thumbs: ['p1'] });
  });

  it('editing without touching the photo keeps it', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('p1') });
    const edited = await saveEntry({ ...saved, photoId: null, notes: 'form state forgot the photo' }); // default = keep
    expect(edited.photoId).toBe('p1');
    expect(await storedPhotoKeys()).toEqual({ photos: ['p1'], thumbs: ['p1'] });
  });

  it('replacing deletes the old photo + thumbnail in the same transaction', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('p1') });
    const replaced = await saveEntry(saved, { kind: 'replace', ...makePhoto('p2') });
    expect(replaced.photoId).toBe('p2');
    expect(await storedPhotoKeys()).toEqual({ photos: ['p2'], thumbs: ['p2'] });
  });

  it('removing deletes the photo + thumbnail and clears photoId', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('p1') });
    const removed = await saveEntry(saved, { kind: 'remove' });
    expect(removed.photoId).toBeNull();
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
  });

  it('never deletes a photo that another entry still references', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('p1') });
    const db = await getDb();
    await db.put('entries', makeEntry('b', DAY, 21, { photoId: 'p1' })); // not reachable through the UI; defensive
    await saveEntry(saved, { kind: 'remove' });
    expect(await storedPhotoKeys()).toEqual({ photos: ['p1'], thumbs: ['p1'] });
    await deleteEntry('b');
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
  });
});

describe('deleteEntry', () => {
  it('removes the entry together with its photo and thumbnail', async () => {
    await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('p1') });
    await saveEntry(makeEntry('b', DAY, 21), { kind: 'replace', ...makePhoto('p2') });
    expect(await deleteEntry('a')).toBe(true);
    expect(await getEntry('a')).toBeUndefined();
    expect(await storedPhotoKeys()).toEqual({ photos: ['p2'], thumbs: ['p2'] });
    expect((await getEntriesForDay(DAY)).map((e) => e.id)).toEqual(['b']);
  });

  it('deletes an entry without a photo, and reports false for an unknown id', async () => {
    await saveEntry(makeEntry('a', DAY, 20));
    expect(await deleteEntry('a')).toBe(true);
    expect(await deleteEntry('a')).toBe(false);
  });
});

describe('setEntryFavourite', () => {
  it('toggles in place, bumps updatedAt, and reports false for an unknown id', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await setEntryFavourite('a', true)).toBe(true);
    const after = await getEntry('a');
    expect(after?.isFavourite).toBe(true);
    expect(after!.updatedAt > saved.updatedAt).toBe(true);
    expect(await getEntriesForDay(DAY)).toHaveLength(1);
    expect(await setEntryFavourite('nope', true)).toBe(false);
  });
});

describe('calendar cover follows the earliest photographed entry (no stored cover)', () => {
  const cover = async () => resolveCoverEntry(await getEntriesForDay(DAY))?.id;

  it('recomputes after back-dating, photo removal, moving to another day and deletion', async () => {
    await saveEntry(makeEntry('early', DAY, 18), { kind: 'replace', ...makePhoto('p-early') });
    await saveEntry(makeEntry('late', DAY, 22), { kind: 'replace', ...makePhoto('p-late') });
    expect(await cover()).toBe('early');

    await saveEntry(makeEntry('backdated', DAY, 9), { kind: 'replace', ...makePhoto('p-back') });
    expect(await cover()).toBe('backdated');

    await saveEntry((await getEntry('backdated'))!, { kind: 'remove' });
    expect(await cover()).toBe('early');

    await saveEntry({ ...(await getEntry('early'))!, dateTime: at('2026-05-08', 18) });
    expect(await cover()).toBe('late');

    await deleteEntry('late');
    expect(await cover()).toBeUndefined();
  });
});

describe('restore guard: a restore-session record blocks edits, whatever its age', () => {
  const YEAR_AGO = () => new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  it('while the restore holds the lock: save, favourite and delete are refused, nothing is written, record and staged photos stay', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20));
    const locks = stubWebLocks({ heldElsewhere: true });
    await putRestoreSession(YEAR_AGO()); // age is irrelevant: only the lock says whether the restore is alive
    await stagePhotos('staged');

    await expect(saveEntry(makeEntry('b', DAY, 21))).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(setEntryFavourite('a', true)).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(deleteEntry('a')).rejects.toBeInstanceOf(RestoreInProgressError);

    expect(await getEntry('b')).toBeUndefined();
    expect(await getEntry('a')).toEqual(saved);
    expect(await hasRestoreSession()).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: ['staged'], thumbs: ['staged'] });
    // one clean-up attempt per refused write (ifAvailable, so it never waits), never a loop
    expect(locks.calls).toHaveLength(3);
    expect(locks.calls.every((call) => call.options.ifAvailable === true)).toBe(true);
  });

  it('lock free (the restore page died): the leftovers are cleared and the save is retried once and succeeds, even if the record looks brand new', async () => {
    stubWebLocks();
    await putRestoreSession(new Date().toISOString());
    await stagePhotos('staged');

    const saved = await saveEntry(makeEntry('a', DAY, 20));

    expect(saved.id).toBe('a');
    expect(await getEntry('a')).toEqual(saved);
    expect(await hasRestoreSession()).toBe(false);
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
  });

  it('favourite toggle and delete are retried the same way', async () => {
    const locks = stubWebLocks();
    await saveEntry(makeEntry('a', DAY, 20));
    await putRestoreSession();
    expect(await setEntryFavourite('a', true)).toBe(true);
    expect((await getEntry('a'))?.isFavourite).toBe(true);
    expect(await hasRestoreSession()).toBe(false);

    await putRestoreSession(YEAR_AGO());
    expect(await deleteEntry('a')).toBe(true);
    expect(await getEntry('a')).toBeUndefined();
    expect(await hasRestoreSession()).toBe(false);
    expect(locks.calls).toHaveLength(2);
  });

  it('a refused tab can save as soon as the restore tab is gone, without reloading', async () => {
    const locks = stubWebLocks({ heldElsewhere: true });
    await putRestoreSession();
    await expect(saveEntry(makeEntry('a', DAY, 20))).rejects.toBeInstanceOf(RestoreInProgressError);
    locks.setHeldElsewhere(false);
    await expect(saveEntry(makeEntry('a', DAY, 20))).resolves.toBeDefined();
    expect(await hasRestoreSession()).toBe(false);
  });

  it('without Web Locks the record is honoured and never deleted by the retry', async () => {
    stubNoWebLocks();
    await putRestoreSession(YEAR_AGO());
    await stagePhotos('staged');
    await expect(saveEntry(makeEntry('a', DAY, 20))).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(setEntryFavourite('a', true)).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(deleteEntry('a')).rejects.toBeInstanceOf(RestoreInProgressError);
    expect(await getEntry('a')).toBeUndefined();
    expect(await hasRestoreSession()).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: ['staged'], thumbs: ['staged'] });
  });

  it('a validation error is reported as such: no lock is requested, nothing is retried', async () => {
    const locks = stubWebLocks();
    await putRestoreSession();
    await expect(saveEntry(makeEntry('a', DAY, 20, { alcoholPercentage: 500 }))).rejects.toBeInstanceOf(EntryValidationError);
    expect(locks.calls).toHaveLength(0);
    expect(await hasRestoreSession()).toBe(true);
  });

  it('with no session record the lock is never requested by an ordinary save', async () => {
    const locks = stubWebLocks({ heldElsewhere: true }); // even a held lock does not matter without a record
    await expect(saveEntry(makeEntry('a', DAY, 20))).resolves.toBeDefined();
    expect(await setEntryFavourite('a', true)).toBe(true);
    expect(await deleteEntry('a')).toBe(true);
    expect(locks.calls).toHaveLength(0);
  });
});

describe('backup bookkeeping (reminder input) is written inside the save transaction', () => {
  const state = async () => normaliseBackupState((await (await getDb()).get('meta', META_KEYS.backupState))?.value);

  it('records created and edited entries once each, and forgets deleted ones', async () => {
    const a = await saveEntry(makeEntry('a', DAY, 20));
    await saveEntry(makeEntry('b', DAY, 21));
    await saveEntry({ ...a, notes: 'edit' });
    await setEntryFavourite('b', true);
    expect(Object.keys((await state()).changed).sort()).toEqual(['a', 'b']);
    await deleteEntry('a');
    expect(Object.keys((await state()).changed)).toEqual(['b']);
  });
});

describe('form draft is cleared in the same transaction as the save/delete of its entry', () => {
  const draft = (entryId: string): EntryDraft => ({
    entryId, mode: 'new', baseUpdatedAt: null, savedAt: new Date().toISOString(),
    fields: { drinkName: 'typed', category: null, date: DAY, time: '20:00', barName: '', alcoholPercentage: '', alcoholVolumeMl: '', notes: '', isFavourite: false },
  });

  it('removes the draft of the entry that was saved, but not a draft of another entry', async () => {
    await saveEntryDraft(draft('other'));
    await saveEntry(makeEntry('a', DAY, 20));
    expect((await getEntryDraft())?.entryId).toBe('other');
    await saveEntryDraft(draft('a'));
    await saveEntry(makeEntry('a', DAY, 20));
    expect(await getEntryDraft()).toBeUndefined();
  });

  it('removes the draft when its entry is deleted', async () => {
    await saveEntry(makeEntry('a', DAY, 20));
    await saveEntryDraft({ ...draft('a'), mode: 'edit', baseUpdatedAt: 'x' });
    await deleteEntry('a');
    expect(await getEntryDraft()).toBeUndefined();
  });

  it('a failed save keeps the draft (nothing was saved, so the text is still unsaved)', async () => {
    await saveEntryDraft(draft('a'));
    await expect(saveEntry(makeEntry('a', DAY, 20, { alcoholPercentage: 500 }))).rejects.toBeInstanceOf(EntryValidationError);
    expect(parseEntryDraft((await (await getDb()).get('meta', META_KEYS.entryDraft))?.value)?.entryId).toBe('a');
  });

  it('clearEntryDraftFor removes only the draft that belongs to that entry', async () => {
    await clearEntryDraftFor('a'); // nothing stored: no error
    await saveEntryDraft(draft('a'));
    await clearEntryDraftFor('other');
    expect((await getEntryDraft())?.entryId).toBe('a');
    await clearEntryDraftFor('a');
    expect(await getEntryDraft()).toBeUndefined();
  });
});
