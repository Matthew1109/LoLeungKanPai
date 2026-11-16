import { getDb } from './index';
import type { Tag, TagCategory } from './schema';
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
