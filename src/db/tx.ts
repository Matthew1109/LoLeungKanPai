import type { IDBPDatabase } from 'idb';
import { getDb } from './index';
import { toWriteError } from './errors';
import type { LkpDB } from './schema';

/**
 * Every journal write (entry save/delete, orphan sweep) uses one readwrite transaction over these five stores,
 * so an entry, its photo and thumbnail, its bar, the backup bookkeeping and the draft either all change or none do.
 */
const WRITE_STORES = ['entries', 'photos', 'thumbs', 'meta', 'bars'] as const;

function openWriteTx(db: IDBPDatabase<LkpDB>) {
  return db.transaction([...WRITE_STORES], 'readwrite');
}

export type WriteTx = ReturnType<typeof openWriteTx>;

function abortQuietly(tx: { done: Promise<void>; abort(): void }): void {
  tx.done.catch(() => undefined); // the abort below rejects `done`; that rejection is expected, not an error
  try {
    tx.abort();
  } catch {
    /* already finished */
  }
}

/**
 * Runs `work` inside one write transaction and resolves once it has COMMITTED.
 * If `work` throws, the transaction is explicitly aborted: IndexedDB does not roll back by itself when our own
 * code throws, it would commit whatever was written so far. Rule for `work`: await only IndexedDB requests
 * (any other await lets the transaction auto-commit early).
 * Quota errors are translated to StorageFullError.
 */
export async function runWriteTx<T>(work: (tx: WriteTx) => Promise<T>): Promise<T> {
  const db = await getDb();
  const tx = openWriteTx(db);
  try {
    const value = await work(tx);
    await tx.done;
    return value;
  } catch (err) {
    abortQuietly(tx);
    throw toWriteError(err);
  }
}

/**
 * Tag management (create, rename, archive, delete) uses one transaction over the tags, the entries (to see which
 * tags drinks use) and the meta store (the restore guard), so a rule check and its write can never be split.
 */
const TAG_STORES = ['tags', 'entries', 'meta'] as const;

function openTagTx(db: IDBPDatabase<LkpDB>) {
  return db.transaction([...TAG_STORES], 'readwrite');
}

export type TagTx = ReturnType<typeof openTagTx>;

/** Same contract as runWriteTx: resolves once COMMITTED, aborts if `work` throws, await only IndexedDB requests. */
export async function runTagTx<T>(work: (tx: TagTx) => Promise<T>): Promise<T> {
  const db = await getDb();
  const tx = openTagTx(db);
  try {
    const value = await work(tx);
    await tx.done;
    return value;
  } catch (err) {
    abortQuietly(tx);
    throw toWriteError(err);
  }
}

/**
 * Bar management (create, rename, archive, start-up sync) uses one transaction over the bars, the entries (a rename
 * moves the drinks of that bar to the new name, and the sync reads them) and the meta store (the restore guard and
 * the backup bookkeeping), so a rule check and every write it causes can never be split.
 */
const BAR_STORES = ['bars', 'entries', 'meta'] as const;

function openBarTx(db: IDBPDatabase<LkpDB>) {
  return db.transaction([...BAR_STORES], 'readwrite');
}

export type BarTx = ReturnType<typeof openBarTx>;

/** Same contract as runWriteTx: resolves once COMMITTED, aborts if `work` throws, await only IndexedDB requests. */
export async function runBarTx<T>(work: (tx: BarTx) => Promise<T>): Promise<T> {
  const db = await getDb();
  const tx = openBarTx(db);
  try {
    const value = await work(tx);
    await tx.done;
    return value;
  } catch (err) {
    abortQuietly(tx);
    throw toWriteError(err);
  }
}

/**
 * The restore commit's stores. `photos` and `thumbs` are in the transaction only so the commit can VERIFY the staged
 * photos inside it (read-only use: the commit never writes to them). Same abort-on-throw rule as runWriteTx.
 */
const COMMIT_STORES = ['entries', 'tags', 'bars', 'meta', 'photos', 'thumbs'] as const;

function openCommitTx(db: IDBPDatabase<LkpDB>) {
  return db.transaction([...COMMIT_STORES], 'readwrite');
}

export type CommitTx = ReturnType<typeof openCommitTx>;

export async function runCommitTx<T>(work: (tx: CommitTx) => Promise<T>): Promise<T> {
  const db = await getDb();
  const tx = openCommitTx(db);
  try {
    const value = await work(tx);
    await tx.done;
    return value;
  } catch (err) {
    abortQuietly(tx);
    throw toWriteError(err);
  }
}
