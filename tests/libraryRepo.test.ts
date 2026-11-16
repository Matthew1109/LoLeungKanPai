import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAllEntries, saveEntry } from '../src/db/entryRepo';
import { clearAll, makeEntry, makePhoto } from './helpers';

beforeEach(clearAll);

describe('getAllEntries (feeds the gallery, collections and search)', () => {
  it('returns nothing for an empty journal', async () => {
    expect(await getAllEntries()).toEqual([]);
  });

  it('returns every stored entry: all days, with and without a photograph', async () => {
    await saveEntry(makeEntry('a', '2025-12-31', 20));
    await saveEntry(makeEntry('b', '2026-01-01', 8));
    const photo = makePhoto('p1');
    await saveEntry(makeEntry('c', '2026-05-07'), { kind: 'replace', record: photo.record, thumb: photo.thumb });

    const all = await getAllEntries();
    expect(all.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c']);
    expect(all.find((entry) => entry.id === 'c')?.photoId).toBe('p1');
    expect(all.find((entry) => entry.id === 'a')?.photoId).toBeNull();
  });
});
