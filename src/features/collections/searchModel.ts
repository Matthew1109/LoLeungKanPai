import type { DrinkEntry, Tag } from '../../db/schema';
import { newestFirst } from '../../utils/entrySort';
import { nameKey } from '../../utils/normalise';

/** Pure logic of the global search (no React, no storage): easy to test. */

/** The words of the query, lower-cased and width-normalised the same way as tag names. Empty for a blank query. */
export function searchTerms(query: string): string[] {
  const key = nameKey(query);
  return key === '' ? [] : key.split(' ');
}

/** Everything searchable about a drink: its name, bar, notes and the names of its tags (archived ones too). One field per line. */
export function searchHaystack(entry: DrinkEntry, tags: ReadonlyMap<string, Tag>): string {
  const tagNames = [...entry.baseSpiritTagIds, ...entry.ingredientTagIds].map((id) => tags.get(id)?.name ?? '');
  return [entry.drinkName, entry.barName, entry.notes, ...tagNames].map(nameKey).join('\n');
}

/**
 * Drinks that contain every word of the query (anywhere in the name, bar, notes or tags; ignoring case and width),
 * newest first. A blank query finds nothing.
 */
export function searchEntries(entries: readonly DrinkEntry[], tags: ReadonlyMap<string, Tag>, query: string): DrinkEntry[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return newestFirst(
    entries.filter((entry) => {
      const haystack = searchHaystack(entry, tags);
      return terms.every((term) => haystack.includes(term));
    }),
  );
}
