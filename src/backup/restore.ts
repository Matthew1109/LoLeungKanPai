import { notifyDataChanged } from '../db/changeSignal';
import { StorageFullError, toWriteError } from '../db/errors';
import { assertLockHeld, isRestoreSupported, withMaintenanceLock, type LockHold } from '../db/locks';
import { sweepWhileLocked } from '../db/maintenance';
import { META_KEYS, restoreSessionExists, type RestoreSession } from '../db/metaRecords';
import type { Bar, DrinkEntry, PhotoRecord } from '../db/schema';
import { runCommitTx, runWriteTx, type CommitTx } from '../db/tx';
import { missingBars } from '../utils/bars';
import { newId } from '../utils/id';
import type { OpenedBackup } from './backupFormat';

/** The restore cannot start here (no Web Locks, so abandoned restores could not be told from live ones). */
export class RestoreUnsupportedError extends Error {
  constructor() {
    super('Restore needs a browser with Web Locks');
    this.name = 'RestoreUnsupportedError';
  }
}

/**
 * The commit's own checks failed (our session record is gone, or a staged photo/thumbnail is missing). Raised
 * inside the commit transaction before the first write, so the diary is untouched.
 */
export class RestoreAbortedError extends Error {
  constructor(readonly reason: 'SESSION_LOST' | 'STAGED_PHOTO_MISSING') {
    super(`Restore aborted before committing: ${reason}`);
    this.name = 'RestoreAbortedError';
  }
}

export type RestoreStep = 'preparing' | 'staging' | 'committing' | 'cleaning';
export interface RestoreProgress {
  step: RestoreStep;
  done: number;
  total: number;
}

export interface RestoreDeps {
  /** Decodes a JPEG (this proves it is a real image) and returns its thumbnail and pixel size. */
  makeThumb(jpeg: Blob): Promise<{ thumb: Blob; width: number; height: number }>;
  newId(): string;
  now(): Date;
  /** Free bytes on the device, or null when the browser cannot say. */
  freeBytes(): Promise<number | null>;
}

export const defaultRestoreDeps = (makeThumb: RestoreDeps['makeThumb']): RestoreDeps => ({
  makeThumb,
  newId,
  now: () => new Date(),
  freeBytes: async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      return est && typeof est.quota === 'number' && typeof est.usage === 'number' ? est.quota - est.usage : null;
    } catch {
      return null;
    }
  },
});

export interface RestoreResult {
  entries: number;
  tags: number;
  photos: number;
  /** The old photos could not be swept right now; the next start does it. */
  cleanupPending: boolean;
}

/** Everything the commit writes, prepared in memory beforehand (old photo id -> new photo id already applied). */
export interface CommitPlan {
  sessionId: string;
  entries: DrinkEntry[];
  tags: OpenedBackup['data']['tags'];
  bars: Bar[];
  stagedIds: string[];
  backupCreatedAt: string;
  at: string;
}

/**
 * Issues one put per item and waits for all of them. `put` can throw synchronously (the value cannot be stored,
 * for example a quota or clone error). The requests already issued are then abandoned with the transaction, and
 * their AbortError rejections are expected, so they are consumed here; the ORIGINAL error is what propagates.
 */
async function putAll<V>(items: readonly V[], put: (item: V) => Promise<unknown>): Promise<void> {
  const requests: Promise<unknown>[] = [];
  try {
    for (const item of items) requests.push(put(item));
  } catch (err) {
    for (const request of requests) request.catch(() => undefined);
    throw err;
  }
  await Promise.all(requests);
}

/**
 * The atomic commit (E3 v3, section 9 step 7). Runs inside ONE transaction over entries, tags, bars, meta (written) and
 * photos, thumbs (only read). Before anything is cleared it checks that
 *  - this restore's own session record is still there (same sessionId), and
 *  - every staged photo and thumbnail exists.
 * If a check fails it throws before the first write; runCommitTx aborts, and the diary is exactly as it was.
 */
export async function commitRestore(plan: CommitPlan): Promise<void> {
  await runCommitTx(async (tx: CommitTx) => {
    const meta = tx.objectStore('meta');
    const session = (await meta.get(META_KEYS.restoreSession))?.value as Partial<RestoreSession> | undefined;
    if (!restoreSessionExists(session) || session?.sessionId !== plan.sessionId) throw new RestoreAbortedError('SESSION_LOST');
    const photos = tx.objectStore('photos');
    const thumbs = tx.objectStore('thumbs');
    for (const id of plan.stagedIds) {
      const [p, t] = await Promise.all([photos.count(id), thumbs.count(id)]);
      if (p !== 1 || t !== 1) throw new RestoreAbortedError('STAGED_PHOTO_MISSING');
    }

    const entries = tx.objectStore('entries');
    const tags = tx.objectStore('tags');
    const bars = tx.objectStore('bars');
    await Promise.all([entries.clear(), tags.clear(), bars.clear()]);
    await putAll(plan.tags, (tag) => tags.put(tag));
    await putAll(plan.bars, (bar) => bars.put(bar));
    await putAll(plan.entries, (entry) => entries.put(entry));
    await meta.delete(META_KEYS.restoreSession);
    await meta.delete(META_KEYS.entryDraft); // a draft belongs to an entry of the old diary
    await meta.put({ key: META_KEYS.backupState, value: { lastBackupAt: plan.backupCreatedAt, changed: {} } });
    await meta.put({
      key: META_KEYS.lastRestore,
      value: { at: plan.at, backupCreatedAt: plan.backupCreatedAt, entries: plan.entries.length, tags: plan.tags.length, photos: plan.stagedIds.length },
    });
  });
}

/** Deletes what a failed restore staged and its session record. Never throws: a leftover is swept at next start. */
async function abandon(sessionId: string, stagedIds: readonly string[]): Promise<void> {
  try {
    await runWriteTx(async (tx) => {
      const meta = tx.objectStore('meta');
      const session = (await meta.get(META_KEYS.restoreSession))?.value as Partial<RestoreSession> | undefined;
      if (session?.sessionId !== sessionId) return; // not ours (any more): leave it to the sweep
      for (const id of stagedIds) {
        await tx.objectStore('photos').delete(id);
        await tx.objectStore('thumbs').delete(id);
      }
      await meta.delete(META_KEYS.restoreSession);
    });
  } catch (err) {
    console.warn('Could not remove a failed restore; the next start will', err);
  }
}

async function runRestore(hold: LockHold, backup: OpenedBackup, deps: RestoreDeps, report: (p: RestoreProgress) => void): Promise<RestoreResult> {
  assertLockHeld(hold);
  if (!hold.authoritative) throw new RestoreUnsupportedError();

  // 1. Clean baseline (own hold). Only BEFORE the session record exists, and again after the commit: a sweep in
  //    between would treat the staged photos as orphans.
  report({ step: 'preparing', done: 0, total: 1 });
  await sweepWhileLocked(hold);

  const used = [...new Set(backup.data.entries.flatMap((e) => (e.photoId ? [e.photoId] : [])))];
  const free = await deps.freeBytes();
  if (free !== null && free < backup.photoBytes * 1.5 + 5_000_000) throw new StorageFullError(new Error('not enough free space for the restore'));

  // 2. Session record, then staging under NEW ids (old id -> new id), `add` only: nothing existing can be overwritten.
  const session: RestoreSession = { sessionId: deps.newId(), startedAt: deps.now().toISOString(), phase: 'staging' };
  await runWriteTx((tx) => tx.objectStore('meta').put({ key: META_KEYS.restoreSession, value: session }));
  const idMap = new Map(used.map((oldId) => [oldId, deps.newId()] as const));
  const metaById = new Map(backup.data.photos.map((p) => [p.id, p]));
  const staged: string[] = [];
  try {
    for (let i = 0; i < used.length; i++) {
      report({ step: 'staging', done: i, total: used.length });
      const oldId = used[i];
      const id = idMap.get(oldId) as string;
      const jpeg = new Blob([await backup.readPhoto(oldId)], { type: 'image/jpeg' });
      const { thumb, width, height } = await deps.makeThumb(jpeg); // decoding validates the image
      const record: PhotoRecord = {
        id, blob: jpeg, mime: 'image/jpeg', size: jpeg.size, width, height,
        createdAt: metaById.get(oldId)?.createdAt ?? deps.now().toISOString(),
      };
      await runWriteTx(async (tx) => {
        await tx.objectStore('photos').add(record);
        await tx.objectStore('thumbs').add({ id, blob: thumb });
      });
      staged.push(id);
    }

    // 3. Commit: one transaction, with its own pre-commit checks.
    report({ step: 'committing', done: 0, total: 1 });
    const entries = backup.data.entries.map((e) => ({ ...e, photoId: e.photoId === null ? null : (idMap.get(e.photoId) as string) }));
    const at = deps.now().toISOString();
    // The backup's own bars, plus a bar for every bar name its drinks use that the list lacks (a backup made
    // before the Bar library has no bars at all, so the library is rebuilt from the drinks).
    const known = new Set(backup.data.bars.map((bar) => bar.nameKey));
    await commitRestore({
      sessionId: session.sessionId,
      entries,
      tags: backup.data.tags,
      bars: [...backup.data.bars, ...missingBars(entries, known, deps.newId, at)],
      stagedIds: staged,
      backupCreatedAt: backup.manifest.createdAt,
      at,
    });
  } catch (err) {
    await abandon(session.sessionId, staged); // nothing existing was changed; remove what we added
    throw toWriteError(err);
  }

  // 4. The new diary is live. The old photos are orphans: sweep them while still holding the lock.
  notifyDataChanged();
  report({ step: 'cleaning', done: 0, total: 1 });
  let cleanupPending = false;
  try {
    await sweepWhileLocked(hold);
  } catch (err) {
    console.warn('Clean-up after restore failed; the next start will do it', err);
    cleanupPending = true;
  }
  return { entries: backup.data.entries.length, tags: backup.data.tags.length, photos: staged.length, cleanupPending };
}

export async function restoreBackup(backup: OpenedBackup, deps: RestoreDeps, report: (p: RestoreProgress) => void = () => undefined): Promise<RestoreResult> {
  if (!isRestoreSupported()) throw new RestoreUnsupportedError();
  const outcome = await withMaintenanceLock((hold) => runRestore(hold, backup, deps, report));
  if (!outcome.acquired) throw new RestoreUnsupportedError();
  return outcome.value;
}
