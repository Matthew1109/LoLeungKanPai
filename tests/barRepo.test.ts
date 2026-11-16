import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db';
import { normaliseBackupState } from '../src/db/backupReminder';
import {
  BAR_NAME_MAX, cleanBarName, createBar, listBars, listBarsWithCounts, renameBar, setBarArchived, syncBarsFromEntries,
} from '../src/db/barRepo';
import { getDataVersion } from '../src/db/changeSignal';
import { getEntry, saveEntry } from '../src/db/entryRepo';
import { BarError, RestoreInProgressError } from '../src/db/errors';
import { META_KEYS } from '../src/db/metaRecords';
import type { DrinkEntry } from '../src/db/schema';
import { clearAll, hasRestoreSession, makeEntry, makePhoto, putRestoreSession, stubWebLocks } from './helpers';

const DAY = '2026-05-07';
const BACKED_UP_AT = '2026-01-01T00:00:00.000Z';
beforeEach(clearAll);
afterEach(() => vi.unstubAllGlobals());

/** The BarError code a change was refused with ('NOT_REFUSED' when it went through). Other errors are rethrown. */
async function refusedWith(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (err) {
    if (err instanceof BarError) return err.code;
    throw err;
  }
  return 'NOT_REFUSED';
}

const names = (bars: Array<{ name: string }>) => bars.map((bar) => bar.name);
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const backupState = async () => normaliseBackupState((await (await getDb()).get('meta', META_KEYS.backupState))?.value);

/** Forgets the bookkeeping the set-up saves wrote, so a test sees only what the change under test records. */
async function resetBackupState(): Promise<void> {
  await (await getDb()).put('meta', { key: META_KEYS.backupState, value: { lastBackupAt: BACKED_UP_AT, changed: {} } });
}

/** Stores drinks the way an earlier version of the app left them: the Bar library does not know about them. */
async function putEntriesDirectly(...entries: DrinkEntry[]): Promise<void> {
  const db = await getDb();
  for (const entry of entries) await db.put('entries', entry);
}

describe('creating bars', () => {
  it('cleans the name (trim, collapse spaces) and keeps the capitalisation', async () => {
    const bar = await createBar('  Bar   Leone ');
    expect(bar).toMatchObject({ name: 'Bar Leone', nameKey: 'bar leone', isArchived: false });
    expect(bar.createdAt).toBe(bar.updatedAt);
    expect(await listBars()).toEqual([bar]);
    expect(cleanBarName('  a \t  b ')).toBe('a b');
  });

  it('refuses blank and over-long names and stores nothing; the longest allowed name is fine', async () => {
    expect(await refusedWith(createBar('   '))).toBe('EMPTY');
    expect(await refusedWith(createBar('x'.repeat(BAR_NAME_MAX + 1)))).toBe('TOO_LONG');
    expect(await listBars({ includeArchived: true })).toEqual([]);
    await expect(createBar('x'.repeat(BAR_NAME_MAX))).resolves.toBeDefined();
  });

  it('counts characters, not UTF-16 units, against the limit', async () => {
    await expect(createBar('🍸'.repeat(BAR_NAME_MAX))).resolves.toBeDefined();
    expect(await refusedWith(createBar('🍸'.repeat(BAR_NAME_MAX + 1)))).toBe('TOO_LONG');
  });

  it('refuses a duplicate (any capitalisation, spacing or width, archived or not)', async () => {
    const bar = await createBar('Bar Leone');
    expect(await refusedWith(createBar(' bar   LEONE '))).toBe('DUPLICATE');
    expect(await refusedWith(createBar('ＢＡＲ ＬＥＯＮＥ'))).toBe('DUPLICATE');
    await setBarArchived(bar.id, true);
    expect(await refusedWith(createBar('Bar Leone'))).toBe('DUPLICATE');
    expect(await listBars({ includeArchived: true })).toHaveLength(1);
  });
});

describe('renaming', () => {
  it('moves every drink of the bar (whatever spelling it used) to the new name and counts them as edited', async () => {
    const bar = await createBar('Bar Leone');
    const a = await saveEntry(makeEntry('a', DAY, 20, { barName: 'Bar Leone' }));
    const b = await saveEntry(makeEntry('b', DAY, 21, { barName: 'bar  leone' }));
    const other = await saveEntry(makeEntry('c', DAY, 22, { barName: 'Pub' }));
    const none = await saveEntry(makeEntry('d', DAY, 23));
    await resetBackupState();
    await pause();

    const renamed = await renameBar(bar.id, ' Leone   Bar ');

    expect(renamed).toMatchObject({ id: bar.id, name: 'Leone Bar', nameKey: 'leone bar', isArchived: false });
    expect(renamed.updatedAt > bar.updatedAt).toBe(true);
    expect(await getEntry('a')).toEqual({ ...a, barName: 'Leone Bar', updatedAt: renamed.updatedAt });
    expect(await getEntry('b')).toEqual({ ...b, barName: 'Leone Bar', updatedAt: renamed.updatedAt });
    expect(await getEntry('c')).toEqual(other);
    expect(await getEntry('d')).toEqual(none);

    const state = await backupState();
    expect(Object.keys(state.changed).sort()).toEqual(['a', 'b']);
    expect(state.lastBackupAt).toBe(BACKED_UP_AT);

    // the drinks still belong to the bar
    const row = (await listBarsWithCounts()).find((candidate) => candidate.id === bar.id);
    expect(row?.entryCount).toBe(2);
  });

  it('may change only the capitalisation, and then leaves drinks that already use that spelling alone', async () => {
    const bar = await createBar('Bar Leone');
    const a = await saveEntry(makeEntry('a', DAY, 20, { barName: 'Bar Leone' }));
    const b = await saveEntry(makeEntry('b', DAY, 21, { barName: 'BAR LEONE' }));
    await pause();

    await expect(renameBar(bar.id, 'BAR LEONE')).resolves.toMatchObject({ id: bar.id, name: 'BAR LEONE', nameKey: 'bar leone' });

    const movedA = await getEntry('a');
    expect(movedA?.barName).toBe('BAR LEONE');
    expect(movedA!.updatedAt > a.updatedAt).toBe(true);
    expect(await getEntry('b')).toEqual(b);
    expect(names(await listBars())).toEqual(['BAR LEONE']);
  });

  it('refuses a name another bar has (archived or not), a blank or over-long name and an unknown bar; nothing changes', async () => {
    await createBar('Bar Leone');
    const pub = await createBar('Pub');
    const closed = await createBar('Closed');
    await setBarArchived(closed.id, true);
    const stored = await saveEntry(makeEntry('a', DAY, 20, { barName: 'Pub' }));

    expect(await refusedWith(renameBar(pub.id, ' bar  LEONE '))).toBe('DUPLICATE');
    expect(await refusedWith(renameBar(pub.id, 'closed'))).toBe('DUPLICATE');
    expect(await refusedWith(renameBar(pub.id, '  '))).toBe('EMPTY');
    expect(await refusedWith(renameBar(pub.id, 'x'.repeat(BAR_NAME_MAX + 1)))).toBe('TOO_LONG');
    expect(await refusedWith(renameBar('missing', 'Anything'))).toBe('NOT_FOUND');

    expect(names(await listBars({ includeArchived: true }))).toEqual(['Bar Leone', 'Closed', 'Pub']);
    expect(await getEntry('a')).toEqual(stored);
  });

  it('works on an archived bar (it stays archived) and frees the old name', async () => {
    const bar = await createBar('Bar Leone');
    await saveEntry(makeEntry('a', DAY, 20, { barName: 'Bar Leone' }));
    await setBarArchived(bar.id, true);

    await expect(renameBar(bar.id, 'Leone')).resolves.toMatchObject({ name: 'Leone', isArchived: true });
    expect((await getEntry('a'))?.barName).toBe('Leone');
    await expect(createBar('Bar Leone')).resolves.toMatchObject({ name: 'Bar Leone' });
  });

  it('a bar no drink uses can be renamed without touching the backup bookkeeping', async () => {
    const bar = await createBar('Quiet Bar');
    await renameBar(bar.id, 'Loud Bar');
    expect(names(await listBars())).toEqual(['Loud Bar']);
    expect(await (await getDb()).get('meta', META_KEYS.backupState)).toBeUndefined();
  });
});

describe('archiving', () => {
  it('hides the bar from the default list but keeps it on the drinks that have it; restoring brings it back', async () => {
    const bar = await createBar('Pub');
    const stored = await saveEntry(makeEntry('a', DAY, 20, { barName: 'Pub' }));

    const archived = await setBarArchived(bar.id, true);
    expect(archived.isArchived).toBe(true);
    expect(await listBars()).toEqual([]);
    expect((await listBars({ includeArchived: true })).map((candidate) => candidate.id)).toEqual([bar.id]);
    expect(await getEntry('a')).toEqual(stored);

    const back = await setBarArchived(bar.id, false);
    expect(back.isArchived).toBe(false);
    expect((await listBars()).map((candidate) => candidate.id)).toEqual([bar.id]);
  });

  it('setting the state a bar already has changes nothing', async () => {
    const bar = await createBar('Pub');
    await pause();
    expect(await setBarArchived(bar.id, false)).toEqual(bar);
    expect(await listBars()).toEqual([bar]);
  });

  it('refuses an unknown bar', async () => {
    expect(await refusedWith(setBarArchived('missing', true))).toBe('NOT_FOUND');
  });
});

describe('listing', () => {
  it('sorts A to Z ignoring capitalisation', async () => {
    await createBar('zed Bar');
    await createBar('Alpha');
    await createBar('beta');
    expect(names(await listBars())).toEqual(['Alpha', 'beta', 'zed Bar']);
  });

  it('listBarsWithCounts counts the drinks of each bar (any spelling, archived bars included), sorted A to Z', async () => {
    await createBar('Quiet Bar');
    await createBar('Bar Leone');
    const closed = await createBar('Closed Bar');
    await saveEntry(makeEntry('a', DAY, 10, { barName: 'Bar Leone' }));
    await saveEntry(makeEntry('b', DAY, 11, { barName: 'bar  leone' }));
    await saveEntry(makeEntry('c', DAY, 12, { barName: 'Closed Bar' }));
    await saveEntry(makeEntry('d', DAY, 13));
    await setBarArchived(closed.id, true);

    expect((await listBarsWithCounts()).map((bar) => [bar.name, bar.entryCount, bar.isArchived])).toEqual([
      ['Bar Leone', 2, false], ['Closed Bar', 1, true], ['Quiet Bar', 0, false],
    ]);
  });
});

describe('syncBarsFromEntries (the first start after the update, and after restoring an older backup)', () => {
  it('adds one bar for each bar name the drinks use (the earliest spelling wins) and leaves the drinks alone', async () => {
    await putEntriesDirectly(
      makeEntry('late', DAY, 22, { barName: 'bar leone' }),
      makeEntry('early', DAY, 18, { barName: '  Bar   Leone ' }),
      makeEntry('pub', DAY, 20, { barName: 'Pub' }),
      makeEntry('none', DAY, 21),
    );
    const before = await (await getDb()).getAll('entries');

    expect(await syncBarsFromEntries()).toBe(2);

    expect(names(await listBars())).toEqual(['Bar Leone', 'Pub']);
    expect(await (await getDb()).getAll('entries')).toEqual(before);
  });

  it('is repeatable: the second run adds nothing', async () => {
    await putEntriesDirectly(makeEntry('a', DAY, 20, { barName: 'Pub' }));
    expect(await syncBarsFromEntries()).toBe(1);
    expect(await syncBarsFromEntries()).toBe(0);
    expect(await listBars()).toHaveLength(1);
  });

  it('never changes a bar that already exists (an archived one stays archived, its spelling is kept)', async () => {
    const pub = await createBar('The Pub');
    await setBarArchived(pub.id, true);
    const stored = (await listBars({ includeArchived: true }))[0];
    await putEntriesDirectly(makeEntry('a', DAY, 20, { barName: 'the pub' }), makeEntry('b', DAY, 21, { barName: '   ' }));

    expect(await syncBarsFromEntries()).toBe(0);
    expect(await listBars({ includeArchived: true })).toEqual([stored]);
  });

  it('tells open screens only when it added something', async () => {
    const start = getDataVersion();
    await syncBarsFromEntries();
    expect(getDataVersion()).toBe(start);
    await putEntriesDirectly(makeEntry('a', DAY, 20, { barName: 'Pub' }));
    await syncBarsFromEntries();
    expect(getDataVersion()).toBe(start + 1);
    await syncBarsFromEntries();
    expect(getDataVersion()).toBe(start + 1);
  });
});

describe('saving a drink registers its bar', () => {
  it('creates the bar when the library does not have it yet (the drink keeps the text that was typed)', async () => {
    const saved = await saveEntry(makeEntry('a', DAY, 20, { barName: 'Bar  Leone' }));
    const bars = await listBars();
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ name: 'Bar Leone', nameKey: 'bar leone', isArchived: false, createdAt: saved.updatedAt, updatedAt: saved.updatedAt });
    expect((await getEntry('a'))?.barName).toBe('Bar  Leone');
  });

  it('reuses the bar it matches, whatever the capitalisation, and does not create a second one', async () => {
    const bar = await createBar('Bar Leone');
    await saveEntry(makeEntry('a', DAY, 20, { barName: 'BAR LEONE' }));
    await saveEntry(makeEntry('b', DAY, 21, { barName: ' bar leone ' }));
    expect(await listBars({ includeArchived: true })).toEqual([bar]);
  });

  it('adds no bar for a drink without one', async () => {
    await saveEntry(makeEntry('a', DAY, 20));
    await saveEntry(makeEntry('b', DAY, 21, { barName: '   ' }));
    expect(await listBars({ includeArchived: true })).toEqual([]);
  });

  it('a long bar name never stops the drink from being saved', async () => {
    const long = 'x'.repeat(BAR_NAME_MAX + 10);
    await expect(saveEntry(makeEntry('a', DAY, 20, { barName: long }))).resolves.toBeDefined();
    expect(names(await listBars())).toEqual([long]);
  });

  it('two drinks saved at once at a new bar leave one bar', async () => {
    await Promise.all([
      saveEntry(makeEntry('a', DAY, 20, { barName: 'Pub' })),
      saveEntry(makeEntry('b', DAY, 21, { barName: 'pub' })),
    ]);
    expect(await listBars()).toHaveLength(1);
    expect(await getEntry('a')).toBeDefined();
    expect(await getEntry('b')).toBeDefined();
  });

  it('brings an archived bar back when a drink newly chooses it, but not when the drink was already at that bar', async () => {
    const pub = await createBar('Pub');
    const stored = await saveEntry(makeEntry('a', DAY, 20, { barName: 'Pub' }));
    const isArchived = async () => (await listBars({ includeArchived: true })).find((bar) => bar.id === pub.id)?.isArchived;

    await setBarArchived(pub.id, true);
    await saveEntry({ ...stored, notes: 'edited' }); // same bar: stays archived
    expect(await isArchived()).toBe(true);
    await saveEntry({ ...stored, barName: 'PUB' }); // only the capitalisation changed: still the same bar
    expect(await isArchived()).toBe(true);

    await saveEntry(makeEntry('b', DAY, 21, { barName: 'pub' })); // a new drink picks it again
    expect(await isArchived()).toBe(false);

    await setBarArchived(pub.id, true);
    await saveEntry(makeEntry('c', DAY, 22, { barName: 'Elsewhere' }));
    await saveEntry({ ...(await getEntry('c'))!, barName: 'Pub' }); // an existing drink moves to it
    expect(await isArchived()).toBe(false);
  });

  it('adds the bar and the drink together or not at all', async () => {
    const photo = makePhoto('p1');
    const broken = { record: { ...photo.record, blob: (() => 1) as unknown as Blob }, thumb: photo.thumb }; // cannot be stored
    await expect(saveEntry(makeEntry('x', DAY, 20, { barName: 'Bar Leone' }), { kind: 'replace', ...broken })).rejects.toThrow();
    expect(await getEntry('x')).toBeUndefined();
    expect(await listBars({ includeArchived: true })).toEqual([]);
  });
});

describe('open screens are told', () => {
  it('after each committed change, and not after a refused one', async () => {
    const start = getDataVersion();
    const bar = await createBar('Pub');
    expect(getDataVersion()).toBe(start + 1);
    await refusedWith(createBar('pub'));
    expect(getDataVersion()).toBe(start + 1);

    await renameBar(bar.id, 'The Pub');
    expect(getDataVersion()).toBe(start + 2);
    await refusedWith(renameBar(bar.id, ' '));
    expect(getDataVersion()).toBe(start + 2);

    await setBarArchived(bar.id, true);
    expect(getDataVersion()).toBe(start + 3);
    await refusedWith(setBarArchived('missing', true));
    expect(getDataVersion()).toBe(start + 3);
  });
});

describe('restore guard', () => {
  it('while a restore is alive every bar change is refused (also a drink save that would add a bar) and nothing is written', async () => {
    const pub = await createBar('Pub');
    stubWebLocks({ heldElsewhere: true });
    await putRestoreSession();

    await expect(createBar('Bar Leone')).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(renameBar(pub.id, 'The Pub')).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(setBarArchived(pub.id, true)).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(saveEntry(makeEntry('a', DAY, 20, { barName: 'Bar Leone' }))).rejects.toBeInstanceOf(RestoreInProgressError);

    expect(await listBars({ includeArchived: true })).toEqual([pub]);
    expect(await getEntry('a')).toBeUndefined();
    expect(await hasRestoreSession()).toBe(true);
  });

  it('lock free (the restore page died): the leftover record is cleared and the change goes through', async () => {
    stubWebLocks();
    await putRestoreSession();

    await expect(createBar('Pub')).resolves.toMatchObject({ name: 'Pub' });

    expect(await hasRestoreSession()).toBe(false);
    expect(names(await listBars())).toEqual(['Pub']);
  });
});
