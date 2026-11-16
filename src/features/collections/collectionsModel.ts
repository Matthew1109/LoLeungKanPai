import type { DrinkEntry, Tag, TagCategory } from '../../db/schema';
import type { MessageKey } from '../../i18n/locales/en';
import { newestFirst, recentlyAddedFirst } from '../../utils/entrySort';

/** Pure logic of the Collections screens (no React, no storage): easy to test. */

export type CollectionKind = 'spirits' | 'ingredients' | 'favourites' | 'recent';
/** The two collections that list tags first and drinks second. */
export type TagKind = 'spirits' | 'ingredients';

/** "Recently Added" shows this many drinks. */
export const RECENT_LIMIT = 30;

export const COLLECTION_KINDS: readonly CollectionKind[] = ['spirits', 'ingredients', 'favourites', 'recent'];

export const COLLECTION_TITLE_KEYS: Record<CollectionKind, MessageKey> = {
  spirits: 'collections.spirits',
  ingredients: 'collections.ingredients',
  favourites: 'collections.favourites',
  recent: 'collections.recent',
};

export const COLLECTION_HINT_KEYS: Record<CollectionKind, MessageKey> = {
  spirits: 'collections.spirits.hint',
  ingredients: 'collections.ingredients.hint',
  favourites: 'collections.favourites.hint',
  recent: 'collections.recent.hint',
};

export const COLLECTION_EMPTY_KEYS: Record<CollectionKind, MessageKey> = {
  spirits: 'collections.empty.tags',
  ingredients: 'collections.empty.tags',
  favourites: 'collections.empty.favourites',
  recent: 'collections.empty.recent',
};

export function parseCollectionKind(value: string | undefined): CollectionKind | null {
  return COLLECTION_KINDS.find((kind) => kind === value) ?? null;
}

export function isTagKind(kind: CollectionKind): kind is TagKind {
  return kind === 'spirits' || kind === 'ingredients';
}

export function tagCategoryOf(kind: TagKind): TagCategory {
  return kind === 'spirits' ? 'BASE_SPIRIT' : 'INGREDIENT';
}

const tagIdsOf = (entry: DrinkEntry, category: TagCategory): string[] =>
  category === 'BASE_SPIRIT' ? entry.baseSpiritTagIds : entry.ingredientTagIds;

/** Drinks marked with the heart, newest first. */
export function favouriteEntries(entries: readonly DrinkEntry[]): DrinkEntry[] {
  return newestFirst(entries.filter((entry) => entry.isFavourite));
}

/** The drinks most recently added to the journal (by when they were recorded), newest record first. */
export function recentlyAdded(entries: readonly DrinkEntry[], limit: number = RECENT_LIMIT): DrinkEntry[] {
  return recentlyAddedFirst(entries).slice(0, Math.max(0, limit));
}

/** Drinks that use the tag, newest first. The category decides which of the drink's two tag lists is read. */
export function entriesWithTag(entries: readonly DrinkEntry[], category: TagCategory, tagId: string): DrinkEntry[] {
  return newestFirst(entries.filter((entry) => tagIdsOf(entry, category).includes(tagId)));
}

export interface TagCount {
  tag: Tag;
  /** Number of the given drinks that use the tag (a drink counts once). */
  count: number;
}

/**
 * Tags of one category that at least one of the given drinks uses, with how many drinks use each, A to Z.
 * Archived tags are included (the drinks still have them); tags nothing uses, and ids with no tag record, are not.
 */
export function tagCounts(entries: readonly DrinkEntry[], tags: ReadonlyMap<string, Tag>, category: TagCategory): TagCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const id of new Set(tagIdsOf(entry, category))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: TagCount[] = [];
  for (const [id, count] of counts) {
    const tag = tags.get(id);
    if (tag && tag.category === category) out.push({ tag, count });
  }
  return out.sort((a, b) => a.tag.name.localeCompare(b.tag.name, 'en', { sensitivity: 'base' }) || (a.tag.id < b.tag.id ? -1 : 1));
}
