import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  entriesWithTag,
  favouriteEntries,
  isTagKind,
  parseCollectionKind,
  recentlyAdded,
  tagCategoryOf,
  tagCounts,
} from '../src/features/collections/collectionsModel';
import { newestFirst, recentlyAddedFirst } from '../src/utils/entrySort';
import { nameKey } from '../src/utils/normalise';
import type { DrinkEntry, Tag, TagCategory } from '../src/db/schema';
import { makeEntry } from './helpers';

const tag = (id: string, name: string, category: TagCategory, isArchived = false): Tag => ({
  id, name, nameKey: nameKey(name), category, isArchived, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const tagMap = (...tags: Tag[]) => new Map(tags.map((entry): [string, Tag] => [entry.id, entry]));
const ids = (list: DrinkEntry[]) => list.map((entry) => entry.id);
const created = (id: string, day: string, createdAt: string, patch: Partial<DrinkEntry> = {}) => makeEntry(id, day, 12, { createdAt, ...patch });

describe('sorting', () => {
  it('newestFirst orders by the date of the drink, not by when it was recorded', () => {
    const a = created('a', '2026-01-01', '2026-06-01T00:00:00.000Z');
    const b = created('b', '2026-02-01', '2026-03-01T00:00:00.000Z');
    expect(ids(newestFirst([a, b]))).toEqual(['b', 'a']);
  });

  it('recentlyAddedFirst orders by when it was recorded, ties by id, and does not change the input', () => {
    const a = created('a', '2026-01-01', '2026-06-01T00:00:00.000Z');
    const b = created('b', '2026-02-01', '2026-03-01T00:00:00.000Z');
    const c = created('c', '2026-02-02', '2026-06-01T00:00:00.000Z');
    const input = [b, c, a];
    expect(ids(recentlyAddedFirst(input))).toEqual(['a', 'c', 'b']);
    expect(ids(input)).toEqual(['b', 'c', 'a']);
  });
});

describe('Favourite Drinks', () => {
  it('lists only hearted drinks, newest first, with or without a photograph', () => {
    const list = [
      makeEntry('old', '2026-01-01', 12, { isFavourite: true }),
      makeEntry('plain', '2026-02-01'),
      makeEntry('new', '2026-03-01', 12, { isFavourite: true, photoId: 'p' }),
    ];
    expect(ids(favouriteEntries(list))).toEqual(['new', 'old']);
    expect(favouriteEntries([makeEntry('x', '2026-01-01')])).toEqual([]);
  });
});

describe('Recently Added', () => {
  it('uses the record time: a backdated drink added today is the most recent', () => {
    const list = [
      created('recorded-first', '2026-05-01', '2026-05-01T10:00:00.000Z'),
      created('backdated', '2025-01-01', '2026-05-09T10:00:00.000Z'),
      created('recorded-second', '2026-05-02', '2026-05-02T10:00:00.000Z'),
    ];
    expect(ids(recentlyAdded(list))).toEqual(['backdated', 'recorded-second', 'recorded-first']);
  });

  it('stops at the limit (30 by default)', () => {
    const list = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) => created(`e${String(i).padStart(2, '0')}`, '2026-05-01', `2026-05-01T10:${String(i).padStart(2, '0')}:00.000Z`));
    expect(RECENT_LIMIT).toBe(30);
    expect(recentlyAdded(list)).toHaveLength(30);
    expect(recentlyAdded(list)[0].id).toBe(`e${RECENT_LIMIT + 4}`);
    expect(ids(recentlyAdded(list, 2))).toEqual([`e${RECENT_LIMIT + 4}`, `e${RECENT_LIMIT + 3}`]);
    expect(recentlyAdded(list, 0)).toEqual([]);
    expect(recentlyAdded([])).toEqual([]);
  });
});

describe('Base Spirits and Ingredients', () => {
  const gin = tag('gin', 'Gin', 'BASE_SPIRIT');
  const rum = tag('rum', 'Rum', 'BASE_SPIRIT');
  const oldRye = tag('rye', 'Rye', 'BASE_SPIRIT', true);
  const lime = tag('lime', 'Lime', 'INGREDIENT');
  const mint = tag('mint', 'mint', 'INGREDIENT');
  const unused = tag('unused', 'Absinthe', 'BASE_SPIRIT');
  const tags = tagMap(gin, rum, oldRye, lime, mint, unused);
  const list = [
    makeEntry('a', '2026-01-01', 12, { baseSpiritTagIds: ['gin'], ingredientTagIds: ['lime'] }),
    makeEntry('b', '2026-02-01', 12, { baseSpiritTagIds: ['rum', 'gin'], ingredientTagIds: ['lime', 'mint'] }),
    makeEntry('c', '2026-03-01', 12, { baseSpiritTagIds: ['rye', 'ghost'], ingredientTagIds: ['mint', 'mint'] }),
    makeEntry('d', '2026-04-01'),
  ];

  it('maps the two tag collections to their tag category', () => {
    expect(isTagKind('spirits') && isTagKind('ingredients')).toBe(true);
    expect(isTagKind('favourites') || isTagKind('recent')).toBe(false);
    expect(tagCategoryOf('spirits')).toBe('BASE_SPIRIT');
    expect(tagCategoryOf('ingredients')).toBe('INGREDIENT');
  });

  it('lists the tags in use A to Z with their drink counts; archived tags stay, unused tags and unknown ids do not', () => {
    expect(tagCounts(list, tags, 'BASE_SPIRIT').map((row) => [row.tag.name, row.count])).toEqual([['Gin', 2], ['Rum', 1], ['Rye', 1]]);
    expect(tagCounts(list, tags, 'INGREDIENT').map((row) => [row.tag.name, row.count])).toEqual([['Lime', 2], ['mint', 2]]);
  });

  it('counts a drink once even if the same tag id is stored twice, and only reads the matching category', () => {
    const rows = tagCounts(list, tags, 'INGREDIENT');
    expect(rows.find((row) => row.tag.id === 'mint')?.count).toBe(2);
    expect(tagCounts([makeEntry('x', '2026-01-01', 12, { ingredientTagIds: ['gin'] })], tags, 'INGREDIENT')).toEqual([]);
    expect(tagCounts([], tags, 'BASE_SPIRIT')).toEqual([]);
  });

  it('lists the drinks of one tag, newest first, reading the right list for the category', () => {
    expect(ids(entriesWithTag(list, 'BASE_SPIRIT', 'gin'))).toEqual(['b', 'a']);
    expect(ids(entriesWithTag(list, 'INGREDIENT', 'lime'))).toEqual(['b', 'a']);
    expect(ids(entriesWithTag(list, 'INGREDIENT', 'gin'))).toEqual([]);
    expect(entriesWithTag(list, 'BASE_SPIRIT', 'absinthe')).toEqual([]);
  });
});

describe('parseCollectionKind', () => {
  it('accepts the four collections and nothing else', () => {
    expect(parseCollectionKind('spirits')).toBe('spirits');
    expect(parseCollectionKind('ingredients')).toBe('ingredients');
    expect(parseCollectionKind('favourites')).toBe('favourites');
    expect(parseCollectionKind('recent')).toBe('recent');
    expect(parseCollectionKind('tag')).toBeNull();
    expect(parseCollectionKind('')).toBeNull();
    expect(parseCollectionKind(undefined)).toBeNull();
  });
});
