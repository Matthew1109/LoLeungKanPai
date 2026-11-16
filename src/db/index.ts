import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, type LkpDB } from './schema';
import { upgrade } from './migrations';

let dbPromise: Promise<IDBPDatabase<LkpDB>> | null = null;

/** Single shared connection. Components never call this; they go through the repositories. */
export function getDb(): Promise<IDBPDatabase<LkpDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LkpDB>(DB_NAME, DB_VERSION, {
      upgrade,
      blocking() {
        // Another tab/version wants to upgrade: release our connection so it can proceed.
        dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null; // browser killed the connection (e.g. storage pressure); reopen on next use
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return (await db.get('meta', key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value });
}
