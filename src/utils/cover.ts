import type { DrinkEntry } from '../db/schema';

/**
 * Chooses the entry whose photograph represents a day in the calendar (decision D12, revised by the owner):
 * always the EARLIEST entry of the day that has a photo, by recorded date/time (ties: createdAt, then id).
 * There is no manual selection. The cover is derived, never stored, so it moves by itself when the cover entry is
 * deleted, re-dated, loses its photo, or when an earlier photographed drink is added or back-dated.
 * Returns undefined when no entry on the day has a photo (the tile then shows a placeholder).
 */
export function resolveCoverEntry(dayEntries: DrinkEntry[]): DrinkEntry | undefined {
  const compare = (a: DrinkEntry, b: DrinkEntry) =>
    a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1
      : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return dayEntries.filter((e) => e.photoId).sort(compare)[0];
}
