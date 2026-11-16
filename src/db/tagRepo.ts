import { getDb } from './index';
import { notifyDataChanged } from './changeSignal';
import { RestoreInProgressError, TagError } from './errors';
import { retryAfterAbandonedRestore } from './maintenance';
import { META_KEYS, restoreSessionExists } from './metaRecords';
import type { Tag, TagCategory } from './schema';
import { runTagTx, type TagTx } from './tx';
import { newId } from '../utils/id';
import { nameKey } from '../utils/normalise';

export const DEFAULT_BASE_SPIRITS = [
  'Gin', 'Vodka', 'White Rum', 'Dark Rum', 'Tequila', 'Mezcal',
  'Whisky', 'Bourbon', 'Rye', 'Brandy', 'Cognac', 'Sake',
];
export const DEFAULT_INGREDIENTS = [
  'Lime', 'Lemon', 'Mint', 'Espresso', 'Coffee', 'Elderflower', 'Passionfruit',
  'Angostura Bitters', 'Vermouth', 'Tonic Water', 'Ginger Beer', 'Simple Syrup', 'Sugar', 'Soda Water',
];

const SEEDED_KEY = 'defaultTagsSeeded';

/** Adds the suggested libraries exactly once (a meta flag, so tags the user later deletes never come back). */
export async function seedDefaultTags(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tags', 'meta'], 'readwrite');
  if (await tx.objectStore('meta').get(SEEDED_KEY)) {
    await tx.done;
    return;
  }
  const now = new Date().toISOString();
  const add = (name: string, category: TagCategory) =>
    tx.objectStore('tags').add({
      id: newId(), name, nameKey: nameKey(name), category, isArchived: false, createdAt: now, updatedAt: now,
    });
  await Promise.all([
    ...DEFAULT_BASE_SPIRITS.map((n) => add(n, 'BASE_SPIRIT')),
    ...DEFAULT_INGREDIENTS.map((n) => add(n, 'INGREDIENT')),
    tx.objectStore('meta').put({ key: SEEDED_KEY, value: true }),
  ]);
  await tx.done;
}

export async function listTags(category: TagCategory, opts: { includeArchived?: boolean } = {}): Promise<Tag[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('tags', 'category', category);
  return all
    .filter((t) => opts.includeArchived || !t.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** Includes archived tags: historical entries must keep showing them. */
export async function getTagsByIds(ids: string[]): Promise<Tag[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await Promise.all(ids.map((id) => db.get('tags', id)));
  return rows.filter((t): t is Tag => Boolean(t));
}

/* ---------- Tag management (Phase 3) ---------- */

export const TAG_NAME_MAX = 40;

/** A tag with the number of drinks that use it (archived tags included: they stay on the drinks that have them). */
export interface TagWithCount extends Tag {
  entryCount: number;
}

/** Trims and collapses inner whitespace; the user's capitalisation is kept. Throws TagError EMPTY / TOO_LONG. */
export function cleanTagName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0) throw new TagError('EMPTY');
  if ([...name].length > TAG_NAME_MAX) throw new TagError('TOO_LONG');
  return name;
}

/** Like entry writes, tag edits are refused while a restore-session record exists (checked inside the transaction). */
async function assertNoRestoreSession(tx: TagTx): Promise<void> {
  const record = await tx.objectStore('meta').get(META_KEYS.restoreSession);
  if (restoreSessionExists(record)) throw new RestoreInProgressError();
}

/** One committed tag transaction (with the abandoned-restore retry the entry writes use), then tell open screens. */
async function writeTags<T>(work: (tx: TagTx) => Promise<T>): Promise<T> {
  const value = await retryAfterAbandonedRestore(() =>
    runTagTx(async (tx) => {
      await assertNoRestoreSession(tx);
      return work(tx);
    }),
  );
  notifyDataChanged();
  return value;
}

const findByKey = (tx: TagTx, category: TagCategory, key: string) =>
  tx.objectStore('tags').index('categoryNameKey').get([category, key]);

/** Adds a tag. Throws TagError DUPLICATE when the category already has that name (any capitalisation, archived or not). */
export async function createTag(rawName: string, category: TagCategory): Promise<Tag> {
  const name = cleanTagName(rawName);
  const key = nameKey(name);
  return writeTags(async (tx) => {
    if (await findByKey(tx, category, key)) throw new TagError('DUPLICATE');
    const now = new Date().toISOString();
    const tag: Tag = { id: newId(), name, nameKey: key, category, isArchived: false, createdAt: now, updatedAt: now };
    await tx.objectStore('tags').add(tag);
    return tag;
  });
}

/**
 * "Use this name": returns the active tag with that name, brings an archived one back, or creates it.
 * Used by the drink form's picker, where typing a name and choosing it should never fail on a clash.
 */
export async function ensureTag(rawName: string, category: TagCategory): Promise<Tag> {
  const name = cleanTagName(rawName);
  const key = nameKey(name);
  return writeTags(async (tx) => {
    const existing = await findByKey(tx, category, key);
    const now = new Date().toISOString();
    if (existing) {
      if (!existing.isArchived) return existing;
      const restored: Tag = { ...existing, isArchived: false, updatedAt: now };
      await tx.objectStore('tags').put(restored);
      return restored;
    }
    const tag: Tag = { id: newId(), name, nameKey: key, category, isArchived: false, createdAt: now, updatedAt: now };
    await tx.objectStore('tags').add(tag);
    return tag;
  });
}

/** Changes the name only. The id stays, so every drink that has the tag shows the new name. DUPLICATE on a clash. */
export async function renameTag(id: string, rawName: string): Promise<Tag> {
  const name = cleanTagName(rawName);
  const key = nameKey(name);
  return writeTags(async (tx) => {
    const tag = await tx.objectStore('tags').get(id);
    if (!tag) throw new TagError('NOT_FOUND');
    const clash = await findByKey(tx, tag.category, key);
    if (clash && clash.id !== id) throw new TagError('DUPLICATE'); // changing only the capitalisation is fine
    const renamed: Tag = { ...tag, name, nameKey: key, updatedAt: new Date().toISOString() };
    await tx.objectStore('tags').put(renamed);
    return renamed;
  });
}

/** Archived tags are no longer offered for new drinks but stay on the drinks that already have them. */
export async function setTagArchived(id: string, archived: boolean): Promise<Tag> {
  return writeTags(async (tx) => {
    const tag = await tx.objectStore('tags').get(id);
    if (!tag) throw new TagError('NOT_FOUND');
    if (tag.isArchived === archived) return tag;
    const next: Tag = { ...tag, isArchived: archived, updatedAt: new Date().toISOString() };
    await tx.objectStore('tags').put(next);
    return next;
  });
}

/** Permanent. Refused (IN_USE) while any drink has the tag: archive it instead. */
export async function deleteTag(id: string): Promise<void> {
  await writeTags(async (tx) => {
    if (!(await tx.objectStore('tags').get(id))) throw new TagError('NOT_FOUND');
    const entries = tx.objectStore('entries');
    const uses = (await entries.index('baseSpiritTagIds').count(id)) + (await entries.index('ingredientTagIds').count(id));
    if (uses > 0) throw new TagError('IN_USE');
    await tx.objectStore('tags').delete(id);
  });
}

/** Every tag of the category, archived included, with how many drinks use it. Sorted by name. */
export async function listTagsWithCounts(category: TagCategory): Promise<TagWithCount[]> {
  const db = await getDb();
  const tags = await listTags(category, { includeArchived: true });
  const count = (id: string) =>
    category === 'BASE_SPIRIT'
      ? db.countFromIndex('entries', 'baseSpiritTagIds', id)
      : db.countFromIndex('entries', 'ingredientTagIds', id);
  return Promise.all(tags.map(async (tag) => ({ ...tag, entryCount: await count(tag.id) })));
}
