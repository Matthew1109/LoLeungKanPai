import type { Bar, DrinkEntry } from '../db/schema';
import { nameKey } from './normalise';

/** Pure helpers of the Bar library (no storage, no React). */

/** The way a bar name is kept: trimmed, inner whitespace collapsed, the user's capitalisation unchanged. */
export function tidyBarName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

type DrinkAtBar = Pick<DrinkEntry, 'id' | 'barName' | 'dateTime'>;

/**
 * The bars that drinks already name. Drinks are read earliest first (ties by id), so when one bar was typed in
 * several spellings ("Bar Leone", "bar leone") the first spelling used becomes its name. Names are compared with
 * nameKey; blank names and keys in `known` are skipped. Each key appears once.
 */
export function impliedBars(drinks: readonly DrinkAtBar[], known: ReadonlySet<string> = new Set()): Array<{ key: string; name: string }> {
  const ordered = [...drinks].sort((a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const found = new Map<string, string>();
  for (const drink of ordered) {
    const key = nameKey(drink.barName);
    if (key === '' || known.has(key) || found.has(key)) continue;
    found.set(key, tidyBarName(drink.barName));
  }
  return [...found].map(([key, name]) => ({ key, name }));
}

/** New active Bar records for every bar name the drinks use that `known` does not cover yet. */
export function missingBars(drinks: readonly DrinkAtBar[], known: ReadonlySet<string>, makeId: () => string, at: string): Bar[] {
  return impliedBars(drinks, known).map(({ key, name }): Bar => ({ id: makeId(), name, nameKey: key, isArchived: false, createdAt: at, updatedAt: at }));
}
