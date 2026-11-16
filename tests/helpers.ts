import { vi } from 'vitest';
import { getDb } from '../src/db';
import { META_KEYS, type RestoreSession } from '../src/db/metaRecords';
import type { DrinkEntry, PhotoRecord } from '../src/db/schema';

/** Local calendar day + local time -> ISO instant. Using local times keeps dayKey derivation timezone-proof. */
export function at(dayKey: string, hour = 12, minute = 0): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

export function makeEntry(id: string, dayKey: string, hour = 12, patch: Partial<DrinkEntry> = {}): DrinkEntry {
  const dateTime = at(dayKey, hour);
  return {
    id, drinkName: id, category: 'COCKTAIL', dateTime, dayKey, barName: '', photoId: null,
    baseSpiritTagIds: [], ingredientTagIds: [], alcoholPercentage: null, alcoholVolumeMl: null, notes: '',
    isFavourite: false, createdAt: dateTime, updatedAt: dateTime, ...patch,
  };
}

export function makePhoto(id: string): { record: PhotoRecord; thumb: Blob } {
  const blob = new Blob([`photo-${id}`], { type: 'image/jpeg' });
  return {
    record: { id, blob, mime: 'image/jpeg', size: blob.size, width: 100, height: 100, createdAt: new Date().toISOString() },
    thumb: new Blob([`thumb-${id}`], { type: 'image/jpeg' }),
  };
}

const ALL_STORES = ['entries', 'tags', 'bars', 'photos', 'thumbs', 'dayCovers', 'meta'] as const;

/** Empties every store (call in beforeEach). */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([...ALL_STORES], 'readwrite');
  await Promise.all(ALL_STORES.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}

/** Sorted keys currently in the photos and thumbs stores. */
export async function storedPhotoKeys(): Promise<{ photos: string[]; thumbs: string[] }> {
  const db = await getDb();
  return { photos: (await db.getAllKeys('photos')).sort(), thumbs: (await db.getAllKeys('thumbs')).sort() };
}

/** Writes photos/thumbs that no entry references: what a restore stages before its commit. */
export async function stagePhotos(...ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) {
    const p = makePhoto(id);
    await db.put('photos', p.record);
    await db.put('thumbs', { id, blob: p.thumb });
  }
}

/** A restore-session record, as a restore writes it before staging. Its age is irrelevant to the app. */
export const restoreSessionRecord = (startedAt: string = new Date().toISOString()): RestoreSession => ({
  sessionId: 's1',
  startedAt,
  phase: 'staging',
});

export async function putRestoreSession(startedAt?: string): Promise<void> {
  await (await getDb()).put('meta', { key: META_KEYS.restoreSession, value: restoreSessionRecord(startedAt) });
}

export async function hasRestoreSession(): Promise<boolean> {
  return (await (await getDb()).get('meta', META_KEYS.restoreSession)) !== undefined;
}

/* ---- navigator.locks stand-ins (call vi.unstubAllGlobals() in afterEach) ---- */

export interface FakeLocks {
  /** Every navigator.locks.request call, in order. */
  calls: Array<{ name: string; options: { mode?: string; ifAvailable?: boolean } }>;
  /** 'acquired' / 'released', one pair per grant, in order. */
  events: string[];
  /** Runs while the lock is still held, right after the callback finished and just before it is released. */
  beforeRelease: (() => Promise<void>) | undefined;
  /** Simulates another page (for instance the tab that is restoring) holding or releasing the lock. */
  setHeldElsewhere(held: boolean): void;
  isHeld(): boolean;
}

type LockCallback = (lock: unknown) => Promise<unknown>;

/**
 * A faithful stand-in for exclusive Web Locks: a held lock makes `ifAvailable` requests call back with `null`,
 * other requests wait their turn. The lock is released when the callback's promise settles, as in browsers.
 */
export function stubWebLocks(opts: { heldElsewhere?: boolean } = {}): FakeLocks {
  let heldElsewhere = opts.heldElsewhere === true;
  let heldHere = false;
  const waiters: Array<() => void> = [];
  const fake: FakeLocks = {
    calls: [],
    events: [],
    beforeRelease: undefined,
    setHeldElsewhere: (held) => {
      heldElsewhere = held;
    },
    isHeld: () => heldElsewhere || heldHere,
  };
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, options: { mode?: string; ifAvailable?: boolean }, callback: LockCallback) => {
        fake.calls.push({ name, options: { ...options } });
        if (fake.isHeld()) {
          if (options.ifAvailable) return callback(null);
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        heldHere = true;
        fake.events.push('acquired');
        try {
          return await callback({ name });
        } finally {
          if (fake.beforeRelease) await fake.beforeRelease();
          fake.events.push('released');
          heldHere = false;
          const next = waiters.shift();
          if (next) next();
        }
      },
    },
  });
  return fake;
}

/** A browser without the Web Locks API (older Safari): the in-page fallback lock is used. */
export function stubNoWebLocks(): void {
  vi.stubGlobal('navigator', {});
}
