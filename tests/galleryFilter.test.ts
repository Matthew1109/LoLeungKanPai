import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAG_MODE,
  availableYears,
  countActiveFilters,
  emptyFilters,
  filtersFromParams,
  filtersToParams,
  galleryEntries,
  matchesTags,
  removeFilter,
  type GalleryFilters,
} from '../src/features/gallery/galleryFilter';
import type { DrinkEntry } from '../src/db/schema';
import { makeEntry } from './helpers';

const shot = (id: string, day: string, hour = 12, patch: Partial<DrinkEntry> = {}): DrinkEntry =>
  makeEntry(id, day, hour, { photoId: `photo-${id}`, ...patch });
const withFilters = (patch: Partial<GalleryFilters>): GalleryFilters => ({ ...emptyFilters(), ...patch });
const ids = (list: DrinkEntry[]) => list.map((entry) => entry.id);

describe('galleryEntries: which drinks, in which order', () => {
  it('shows only drinks with a photograph, newest first', () => {
    const list = [
      shot('old', '2025-12-30'),
      makeEntry('noPhoto', '2026-03-03'),
      shot('lateMar', '2026-03-02', 20),
      shot('earlyMar', '2026-03-02', 9),
    ];
    expect(ids(galleryEntries(list, emptyFilters()))).toEqual(['lateMar', 'earlyMar', 'old']);
  });

  it('orders drinks with the same time by id, and does not change the input list', () => {
    const list = [shot('b', '2026-03-02'), shot('a', '2026-03-02')];
    expect(ids(galleryEntries(list, emptyFilters()))).toEqual(['a', 'b']);
    expect(ids(list)).toEqual(['b', 'a']);
  });

  it('returns nothing for an empty journal', () => {
    expect(galleryEntries([], emptyFilters())).toEqual([]);
  });
});

describe('galleryEntries: year, month and favourites', () => {
  const list = [
    shot('a', '2025-03-10', 12, { isFavourite: true }),
    shot('b', '2026-03-10'),
    shot('c', '2026-04-10', 12, { isFavourite: true }),
    shot('d', '2026-12-31', 23),
  ];

  it('filters by year', () => {
    expect(ids(galleryEntries(list, withFilters({ year: 2026 })))).toEqual(['d', 'c', 'b']);
  });

  it('filters by month in any year, or in one year when both are chosen', () => {
    expect(ids(galleryEntries(list, withFilters({ month: 3 })))).toEqual(['b', 'a']);
    expect(ids(galleryEntries(list, withFilters({ year: 2026, month: 3 })))).toEqual(['b']);
    expect(ids(galleryEntries(list, withFilters({ year: 2025, month: 4 })))).toEqual([]);
  });

  it('uses the local calendar day, so a late-night drink stays in its own month', () => {
    expect(ids(galleryEntries(list, withFilters({ month: 12 })))).toEqual(['d']);
  });

  it('keeps only favourites when asked', () => {
    expect(ids(galleryEntries(list, withFilters({ favouritesOnly: true })))).toEqual(['c', 'a']);
  });
});

describe('matchesTags', () => {
  it('no ticked tag means no constraint, even for a drink without tags', () => {
    expect(matchesTags([], [], 'ALL')).toBe(true);
    expect(matchesTags([], [], 'ANY')).toBe(true);
    expect(matchesTags(['x'], [], 'ALL')).toBe(true);
  });

  it('ANY needs at least one ticked tag', () => {
    expect(matchesTags(['gin'], ['gin', 'rum'], 'ANY')).toBe(true);
    expect(matchesTags(['vodka'], ['gin', 'rum'], 'ANY')).toBe(false);
    expect(matchesTags([], ['gin'], 'ANY')).toBe(false);
  });

  it('ALL needs every ticked tag, and extra tags on the drink do not matter', () => {
    expect(matchesTags(['gin', 'rum', 'vodka'], ['gin', 'rum'], 'ALL')).toBe(true);
    expect(matchesTags(['gin'], ['gin', 'rum'], 'ALL')).toBe(false);
    expect(matchesTags([], ['gin'], 'ALL')).toBe(false);
  });
});

describe('galleryEntries: tags (D4: AND between kinds, ALL/ANY inside a kind)', () => {
  const list = [
    shot('gimlet', '2026-05-01', 12, { baseSpiritTagIds: ['gin'], ingredientTagIds: ['lime'] }),
    shot('daiquiri', '2026-05-02', 12, { baseSpiritTagIds: ['rum'], ingredientTagIds: ['lime', 'sugar'] }),
    shot('mojito', '2026-05-03', 12, { baseSpiritTagIds: ['rum'], ingredientTagIds: ['lime', 'mint', 'sugar'] }),
    shot('lli', '2026-05-04', 12, { baseSpiritTagIds: ['gin', 'rum', 'vodka'], ingredientTagIds: ['lemon'] }),
    shot('wine', '2026-05-05', 12),
  ];

  it('base spirits ANY: gin or rum', () => {
    const f = withFilters({ spiritIds: ['gin', 'rum'], spiritMode: 'ANY' });
    expect(ids(galleryEntries(list, f))).toEqual(['lli', 'mojito', 'daiquiri', 'gimlet']);
  });

  it('base spirits ALL: gin and rum', () => {
    const f = withFilters({ spiritIds: ['gin', 'rum'], spiritMode: 'ALL' });
    expect(ids(galleryEntries(list, f))).toEqual(['lli']);
  });

  it('ingredients ALL: lime and sugar; ANY: mint or lemon', () => {
    expect(ids(galleryEntries(list, withFilters({ ingredientIds: ['lime', 'sugar'], ingredientMode: 'ALL' })))).toEqual(['mojito', 'daiquiri']);
    expect(ids(galleryEntries(list, withFilters({ ingredientIds: ['mint', 'lemon'], ingredientMode: 'ANY' })))).toEqual(['lli', 'mojito']);
  });

  it('each kind has its own mode', () => {
    const f = withFilters({ spiritIds: ['gin', 'rum'], spiritMode: 'ANY', ingredientIds: ['lime', 'sugar'], ingredientMode: 'ALL' });
    expect(ids(galleryEntries(list, f))).toEqual(['mojito', 'daiquiri']);
  });

  it('kinds are combined with AND: a spirit match is not enough when the ingredient does not match', () => {
    const f = withFilters({ spiritIds: ['rum'], ingredientIds: ['mint'] });
    expect(ids(galleryEntries(list, f))).toEqual(['mojito']);
    expect(ids(galleryEntries(list, withFilters({ spiritIds: ['gin'], ingredientIds: ['mint'] })))).toEqual([]);
  });

  it('tags are combined with year, month and favourites with AND too', () => {
    const more = [...list, shot('oldMojito', '2025-05-03', 12, { baseSpiritTagIds: ['rum'], isFavourite: true })];
    const f = withFilters({ year: 2026, month: 5, favouritesOnly: false, spiritIds: ['rum'] });
    expect(ids(galleryEntries(more, f))).toEqual(['lli', 'mojito', 'daiquiri']);
    expect(ids(galleryEntries(more, withFilters({ spiritIds: ['rum'], favouritesOnly: true })))).toEqual(['oldMojito']);
  });

  it('a spirit id never matches an ingredient list and the other way round', () => {
    expect(galleryEntries(list, withFilters({ spiritIds: ['lime'] }))).toEqual([]);
    expect(galleryEntries(list, withFilters({ ingredientIds: ['gin'] }))).toEqual([]);
  });
});

describe('availableYears', () => {
  it('lists each year once, newest first', () => {
    const list = [shot('a', '2024-01-01'), shot('b', '2026-06-01'), shot('c', '2024-08-08'), shot('d', '2025-02-02')];
    expect(availableYears(list)).toEqual([2026, 2025, 2024]);
    expect(availableYears([])).toEqual([]);
  });
});

describe('filter items', () => {
  const f = withFilters({ year: 2026, month: 3, favouritesOnly: true, spiritIds: ['gin', 'rum'], ingredientIds: ['lime'], ingredientMode: 'ALL' });

  it('counts each ticked item once and ignores the ALL/ANY switches', () => {
    expect(countActiveFilters(emptyFilters())).toBe(0);
    expect(countActiveFilters(withFilters({ spiritMode: 'ALL', ingredientMode: 'ALL' }))).toBe(0);
    expect(countActiveFilters(f)).toBe(6);
  });

  it('removeFilter drops exactly one item and keeps the rest', () => {
    expect(removeFilter(f, { kind: 'year' })).toEqual({ ...f, year: null });
    expect(removeFilter(f, { kind: 'month' })).toEqual({ ...f, month: null });
    expect(removeFilter(f, { kind: 'favourites' })).toEqual({ ...f, favouritesOnly: false });
    expect(removeFilter(f, { kind: 'spirit', id: 'gin' }).spiritIds).toEqual(['rum']);
    expect(removeFilter(f, { kind: 'ingredient', id: 'lime' }).ingredientIds).toEqual([]);
    expect(removeFilter(f, { kind: 'ingredient', id: 'lime' }).ingredientMode).toBe('ALL');
    expect(f.spiritIds).toEqual(['gin', 'rum']);
  });
});

describe('filters in the address', () => {
  it('round-trips every filter, including ids that need escaping', () => {
    const f = withFilters({
      year: 2026,
      month: 11,
      favouritesOnly: true,
      spiritIds: ['a-1', 'b&c=d'],
      spiritMode: 'ALL',
      ingredientIds: ['x y'],
      ingredientMode: 'ANY',
    });
    const text = filtersToParams(f).toString();
    expect(filtersFromParams(new URLSearchParams(text))).toEqual(f);
  });

  it('writes nothing for the empty filters and leaves the default mode out', () => {
    expect(filtersToParams(emptyFilters()).toString()).toBe('');
    expect(DEFAULT_TAG_MODE).toBe('ANY');
    expect(filtersToParams(withFilters({ spiritIds: ['g'] })).toString()).toBe('spirit=g');
    expect(filtersToParams(withFilters({ spiritMode: 'ALL' })).toString()).toBe('spiritMode=all');
  });

  it('ignores unreadable values instead of failing', () => {
    const f = filtersFromParams(new URLSearchParams('year=abc&month=13&fav=yes&spirit=&spirit=g&spirit=g&spiritMode=sometimes&ingredientMode=ALL'));
    expect(f).toEqual(withFilters({ spiritIds: ['g'], ingredientMode: 'ALL' }));
    expect(filtersFromParams(new URLSearchParams('year=99&month=0')).year).toBeNull();
    expect(filtersFromParams(new URLSearchParams('month=0')).month).toBeNull();
    expect(filtersFromParams(new URLSearchParams('')).year).toBeNull();
  });
});
