import type { DrinkEntry } from '../db/schema';

const ms = (iso: string): number => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

const byId = (a: DrinkEntry, b: DrinkEntry): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Newest drink first (by when it was drunk). Identical times keep a stable order by id. Never mutates the input. */
export function newestFirst(entries: readonly DrinkEntry[]): DrinkEntry[] {
  return [...entries].sort((a, b) => ms(b.dateTime) - ms(a.dateTime) || byId(a, b));
}

/** Most recently recorded first (by `createdAt`, not by the date of the drink). Ties: by id. Never mutates the input. */
export function recentlyAddedFirst(entries: readonly DrinkEntry[]): DrinkEntry[] {
  return [...entries].sort((a, b) => ms(b.createdAt) - ms(a.createdAt) || byId(a, b));
}
