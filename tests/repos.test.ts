import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db';
import { listTags, seedDefaultTags, DEFAULT_BASE_SPIRITS, DEFAULT_INGREDIENTS } from '../src/db/tagRepo';
import { getEntriesForDay, getEntriesInRange, saveEntry } from '../src/db/entryRepo';
import { makeEntry } from './helpers';

describe('tag seeding', () => {
  it('seeds both libraries once', async () => {
    await seedDefaultTags();
    await seedDefaultTags();
    expect(await listTags('BASE_SPIRIT')).toHaveLength(DEFAULT_BASE_SPIRITS.length);
    expect(await listTags('INGREDIENT')).toHaveLength(DEFAULT_INGREDIENTS.length);
  });
  it('enforces case-insensitive uniqueness per category at the database level', async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const dup = { id: 'x', name: 'GIN', nameKey: 'gin', category: 'BASE_SPIRIT' as const, isArchived: false, createdAt: now, updatedAt: now };
    await expect(db.add('tags', dup)).rejects.toThrow();
    // the same name in the other category is allowed
    await expect(db.add('tags', { ...dup, id: 'y', category: 'INGREDIENT' })).resolves.toBeDefined();
  });
});

// Phase 2a: saveEntry now derives dayKey from dateTime (local day), so entries are built from local times (helpers.ts).
describe('entries', () => {
  it('returns several entries per day in time order, and queries by month range', async () => {
    await saveEntry(makeEntry('b', '2026-05-07', 20));
    await saveEntry(makeEntry('a', '2026-05-07', 10));
    await saveEntry(makeEntry('c', '2026-06-01', 10));
    expect((await getEntriesForDay('2026-05-07')).map((e) => e.id)).toEqual(['a', 'b']);
    expect((await getEntriesInRange('2026-05-01', '2026-05-31')).map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
  it('editing an existing id never duplicates', async () => {
    await saveEntry({ ...makeEntry('a', '2026-05-07', 10), drinkName: 'renamed' });
    const rows = await getEntriesForDay('2026-05-07');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 'a')?.drinkName).toBe('renamed');
  });
});
