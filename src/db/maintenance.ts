import { runWriteTx } from './tx';
import { RestoreInProgressError } from './errors';
import { assertLockHeld, withMaintenanceLock, type LockHold } from './locks';
import { META_KEYS, restoreSessionExists } from './metaRecords';

export interface SweepResult {
  /** True when nothing was examined because a restore holds the lock / may still be alive. */
  skipped: boolean;
  removedPhotos: number;
  removedThumbs: number;
  /** An abandoned restore's session record (and so its staged photos) was cleaned up. */
  clearedRestoreSession: boolean;
}

const SKIPPED: SweepResult = { skipped: true, removedPhotos: 0, removedThumbs: 0, clearedRestoreSession: false };

/** Pure: which stored photo / thumbnail keys are not referenced by any entry. */
export function planOrphans(
  referenced: ReadonlySet<string>,
  photoKeys: readonly string[],
  thumbKeys: readonly string[],
): { photos: string[]; thumbs: string[] } {
  return {
    photos: photoKeys.filter((key) => !referenced.has(key)),
    thumbs: thumbKeys.filter((key) => !referenced.has(key)),
  };
}

/**
 * The sweep proper. It needs a `LockHold`, which only `withMaintenanceLock` can issue: EVERY sweep therefore runs
 * under the exclusive `lkp-maintenance` lock, held from before the first read until after the last delete. (A
 * restore calls this directly with its own hold before it starts and after its commit, never between writing its
 * session record and committing.)
 *
 * ONE transaction reads which photos entries reference and deletes everything else, so it is consistent with
 * concurrent entry saves (IndexedDB serialises them). Staged photos of a restore are unreferenced until its
 * commit, which is why this may only delete them when no restore can be alive:
 *  - Web Locks available (authoritative hold): we own the lock, so no restore is alive, whatever the record's age.
 *    A leftover restoreSession is abandoned and is deleted together with the staged photos.
 *  - No Web Locks (hold only covers this page): a restoreSession might belong to a restore in another tab, and
 *    nothing can prove otherwise, so the sweep does nothing and never deletes the record.
 */
export async function sweepWhileLocked(hold: LockHold): Promise<SweepResult> {
  assertLockHeld(hold);
  return runWriteTx(async (tx) => {
    const meta = tx.objectStore('meta');
    const session = await meta.get(META_KEYS.restoreSession);
    const hasSession = restoreSessionExists(session);
    if (hasSession && !hold.authoritative) return SKIPPED;

    const referenced = new Set<string>();
    for (const entry of await tx.objectStore('entries').getAll()) if (entry.photoId) referenced.add(entry.photoId);

    const photos = tx.objectStore('photos');
    const thumbs = tx.objectStore('thumbs');
    const orphans = planOrphans(referenced, await photos.getAllKeys(), await thumbs.getAllKeys());
    await Promise.all([...orphans.photos.map((key) => photos.delete(key)), ...orphans.thumbs.map((key) => thumbs.delete(key))]);

    if (hasSession) await meta.delete(META_KEYS.restoreSession);
    return {
      skipped: false,
      removedPhotos: orphans.photos.length,
      removedThumbs: orphans.thumbs.length,
      clearedRestoreSession: hasSession,
    };
  });
}

/**
 * Orphan clean-up: removes photos/thumbnails no entry references (left behind by an abandoned restore, an
 * interrupted save in an older build, ...). Runs at startup. It asks for the exclusive maintenance lock with
 * `ifAvailable`: if a restore (live or merely suspended) holds it, it does nothing and says so.
 */
export async function sweepOrphanPhotos(): Promise<SweepResult> {
  const outcome = await withMaintenanceLock((hold) => sweepWhileLocked(hold), { ifAvailable: true });
  return outcome.acquired ? outcome.value : SKIPPED;
}

/**
 * Entry writes are refused while a restore-session record exists, whatever its age. If that record is a leftover
 * from a restore whose page died, the refused tab gets ONE chance to clean up: it asks for the lock with
 * `ifAvailable` (sweep), and if the sweep ran (the lock was free, so the restore is dead) the write is retried
 * once. If the lock is held the refusal stands ("A restore is in progress"). Only RestoreInProgressError triggers
 * this; any other error passes through untouched.
 */
export async function retryAfterAbandonedRestore<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!(err instanceof RestoreInProgressError)) throw err;
    let swept: SweepResult;
    try {
      swept = await sweepOrphanPhotos();
    } catch {
      throw err; // the refusal is the more useful message than a clean-up failure
    }
    if (swept.skipped) throw err;
    return write();
  }
}
