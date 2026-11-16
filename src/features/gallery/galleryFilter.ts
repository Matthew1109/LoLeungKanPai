import type { DrinkEntry } from '../../db/schema';
import { newestFirst } from '../../utils/entrySort';

/** Pure logic of the gallery filters (no React, no storage): easy to test. */

/** Within one kind of tag: ALL = the drink has every ticked tag, ANY = it has at least one. */
export type TagMode = 'ALL' | 'ANY';

/** Used until the user flips the toggle. */
export const DEFAULT_TAG_MODE: TagMode = 'ANY';

export interface GalleryFilters {
  year: number | null;
  /** 1 to 12. */
  month: number | null;
  favouritesOnly: boolean;
  spiritIds: string[];
  spiritMode: TagMode;
  ingredientIds: string[];
  ingredientMode: TagMode;
}

export function emptyFilters(): GalleryFilters {
  return {
    year: null,
    month: null,
    favouritesOnly: false,
    spiritIds: [],
    spiritMode: DEFAULT_TAG_MODE,
    ingredientIds: [],
    ingredientMode: DEFAULT_TAG_MODE,
  };
}

/** How many single filters are on (each year, month, favourites switch and ticked tag counts once; the ALL/ANY toggles do not). */
export function countActiveFilters(f: GalleryFilters): number {
  return (f.year !== null ? 1 : 0) + (f.month !== null ? 1 : 0) + (f.favouritesOnly ? 1 : 0) + f.spiritIds.length + f.ingredientIds.length;
}

/** Calendar year of the drink: the LOCAL day the repository derived (the same day the calendar shows). */
export function entryYear(entry: Pick<DrinkEntry, 'dayKey'>): number {
  return Number(entry.dayKey.slice(0, 4));
}

/** Calendar month of the drink, 1 to 12 (local day, like entryYear). */
export function entryMonth(entry: Pick<DrinkEntry, 'dayKey'>): number {
  return Number(entry.dayKey.slice(5, 7));
}

/** Nothing ticked means no constraint. Otherwise ALL: every ticked id is present; ANY: at least one is. */
export function matchesTags(have: readonly string[], wanted: readonly string[], mode: TagMode): boolean {
  if (wanted.length === 0) return true;
  return mode === 'ALL' ? wanted.every((id) => have.includes(id)) : wanted.some((id) => have.includes(id));
}

/** Decision D4: every kind of filter must match (AND); ALL/ANY applies only inside base spirits and inside ingredients. */
export function matchesFilters(entry: DrinkEntry, f: GalleryFilters): boolean {
  if (f.year !== null && entryYear(entry) !== f.year) return false;
  if (f.month !== null && entryMonth(entry) !== f.month) return false;
  if (f.favouritesOnly && !entry.isFavourite) return false;
  if (!matchesTags(entry.baseSpiritTagIds, f.spiritIds, f.spiritMode)) return false;
  if (!matchesTags(entry.ingredientTagIds, f.ingredientIds, f.ingredientMode)) return false;
  return true;
}

export const hasPhoto = (entry: DrinkEntry): boolean => Boolean(entry.photoId);

/** What the gallery shows: drinks that have a photograph and pass every filter, newest first. */
export function galleryEntries(entries: readonly DrinkEntry[], f: GalleryFilters): DrinkEntry[] {
  return newestFirst(entries.filter((entry) => hasPhoto(entry) && matchesFilters(entry, f)));
}

/** Distinct years of the given drinks, newest first. */
export function availableYears(entries: readonly Pick<DrinkEntry, 'dayKey'>[]): number[] {
  return [...new Set(entries.map(entryYear))].filter((year) => Number.isFinite(year)).sort((a, b) => b - a);
}

/** One removable filter (a chip). */
export type FilterRef =
  | { kind: 'year' }
  | { kind: 'month' }
  | { kind: 'favourites' }
  | { kind: 'spirit'; id: string }
  | { kind: 'ingredient'; id: string };

/** The filters without that one item. Never mutates the input. */
export function removeFilter(f: GalleryFilters, ref: FilterRef): GalleryFilters {
  switch (ref.kind) {
    case 'year':
      return { ...f, year: null };
    case 'month':
      return { ...f, month: null };
    case 'favourites':
      return { ...f, favouritesOnly: false };
    case 'spirit':
      return { ...f, spiritIds: f.spiritIds.filter((id) => id !== ref.id) };
    case 'ingredient':
      return { ...f, ingredientIds: f.ingredientIds.filter((id) => id !== ref.id) };
  }
}

/* ---- The filters live in the address (#/gallery?year=2026&spirit=...), so Back from a drink returns to the same view. ---- */

export function filtersToParams(f: GalleryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.year !== null) p.set('year', String(f.year));
  if (f.month !== null) p.set('month', String(f.month));
  if (f.favouritesOnly) p.set('fav', '1');
  f.spiritIds.forEach((id) => p.append('spirit', id));
  if (f.spiritMode !== DEFAULT_TAG_MODE) p.set('spiritMode', f.spiritMode.toLowerCase());
  f.ingredientIds.forEach((id) => p.append('ingredient', id));
  if (f.ingredientMode !== DEFAULT_TAG_MODE) p.set('ingredientMode', f.ingredientMode.toLowerCase());
  return p;
}

function intParam(p: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = p.get(key);
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

function idsParam(p: URLSearchParams, key: string): string[] {
  return [...new Set(p.getAll(key).filter((id) => id !== ''))];
}

function modeParam(p: URLSearchParams, key: string): TagMode {
  const value = p.get(key)?.toLowerCase();
  return value === 'all' ? 'ALL' : value === 'any' ? 'ANY' : DEFAULT_TAG_MODE;
}

/** Reads the filters back; anything unreadable is ignored rather than breaking the screen. */
export function filtersFromParams(p: URLSearchParams): GalleryFilters {
  return {
    year: intParam(p, 'year', 1000, 9999),
    month: intParam(p, 'month', 1, 12),
    favouritesOnly: p.get('fav') === '1',
    spiritIds: idsParam(p, 'spirit'),
    spiritMode: modeParam(p, 'spiritMode'),
    ingredientIds: idsParam(p, 'ingredient'),
    ingredientMode: modeParam(p, 'ingredientMode'),
  };
}
