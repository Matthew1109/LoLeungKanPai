import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { LkpDB } from './schema';

type UpgradeTx = IDBPTransaction<LkpDB, StoreNames<LkpDB>[], 'versionchange'>;

/**
 * Versioned, additive migrations. Never edit a past step; add a new `if (oldVersion < N)` block and bump DB_VERSION.
 * Note: booleans are not valid IndexedDB keys, so isFavourite is intentionally not indexed (filtered in memory).
 */
export function upgrade(db: IDBPDatabase<LkpDB>, oldVersion: number, _newVersion: number | null, _tx: UpgradeTx): void {
  if (oldVersion < 1) {
    const entries = db.createObjectStore('entries', { keyPath: 'id' });
    entries.createIndex('dayKey', 'dayKey');
    entries.createIndex('dateTime', 'dateTime');
    entries.createIndex('createdAt', 'createdAt');
    entries.createIndex('photoId', 'photoId');
    entries.createIndex('baseSpiritTagIds', 'baseSpiritTagIds', { multiEntry: true });
    entries.createIndex('ingredientTagIds', 'ingredientTagIds', { multiEntry: true });

    const tags = db.createObjectStore('tags', { keyPath: 'id' });
    tags.createIndex('categoryNameKey', ['category', 'nameKey'], { unique: true });
    tags.createIndex('category', 'category');

    db.createObjectStore('photos', { keyPath: 'id' });
    db.createObjectStore('thumbs', { keyPath: 'id' });
    db.createObjectStore('dayCovers', { keyPath: 'dayKey' });
    db.createObjectStore('meta', { keyPath: 'key' });
  }
}
