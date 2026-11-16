/**
 * Mutual exclusion between work that must never overlap: the orphan sweep and a restore.
 *
 * Primary mechanism: the Web Locks API (Safari 15.4+). The browser keeps a lock while a page is merely suspended
 * (a backgrounded iOS tab can sleep for minutes) and releases it automatically when the page is destroyed. So
 * "the lock is free" really means "nobody is restoring right now", even after a crash, and "the lock is held"
 * means "a restore may still wake up". That is what makes it safe to clean up an abandoned restore, and why
 * nothing in this app is ever decided by a timeout or by the age of a record.
 *
 * Fallback without the API: a flag that only protects this page. Such a hold is NOT authoritative: it proves
 * nothing about other tabs. A restore is therefore not offered at all on those browsers (isRestoreSupported),
 * and the sweep there never deletes a restore-session record.
 */
export const MAINTENANCE_LOCK_NAME = 'lkp-maintenance';

declare const holdBrand: unique symbol;

/**
 * Proof that the maintenance lock is held. It can only be obtained inside `withMaintenanceLock`, and it stops
 * being valid when the lock is released. Everything that sweeps takes one as a parameter, so a sweep that does
 * not hold the lock cannot be written without an explicit (and reviewable) cast, and `assertLockHeld` rejects
 * such a forgery or a token kept past its lock at run time.
 */
export interface LockHold {
  /** True when backed by the Web Locks API: proves no other page or tab is restoring, and survives crashes. */
  readonly authoritative: boolean;
  readonly [holdBrand]: true;
}

export type LockOutcome<T> = { acquired: true; authoritative: boolean; value: T } | { acquired: false };

const liveHolds = new WeakSet<object>();

function issueHold(authoritative: boolean): LockHold {
  const hold = { authoritative } as LockHold;
  liveHolds.add(hold);
  return hold;
}

/** Throws unless `hold` was issued by `withMaintenanceLock` and that call is still running. */
export function assertLockHeld(hold: LockHold): void {
  if (typeof hold !== 'object' || hold === null || !liveHolds.has(hold)) {
    throw new Error('The maintenance lock is not held');
  }
}

function getLockManager(): LockManager | undefined {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks && typeof locks.request === 'function' ? locks : undefined;
}

/** Restore needs the Web Locks API (see above). Backup export does not. */
export function isRestoreSupported(): boolean {
  return getLockManager() !== undefined;
}

let localBusy = false;
const localWaiters: Array<() => void> = [];

async function acquireLocal(ifAvailable: boolean): Promise<boolean> {
  if (!localBusy) {
    localBusy = true;
    return true;
  }
  if (ifAvailable) return false;
  await new Promise<void>((resolve) => localWaiters.push(resolve)); // ownership is handed over; localBusy stays true
  return true;
}

function releaseLocal(): void {
  const next = localWaiters.shift();
  if (next) next();
  else localBusy = false;
}

/**
 * Runs `work` while holding the exclusive maintenance lock.
 * - `ifAvailable: true`: if somebody else holds it, `work` is not run and `{ acquired: false }` is returned.
 * - otherwise: waits for the lock.
 * The lock is held for the whole of `work`, including everything it awaits, and released afterwards even on error.
 */
export async function withMaintenanceLock<T>(
  work: (hold: LockHold) => Promise<T>,
  opts: { ifAvailable?: boolean } = {},
): Promise<LockOutcome<T>> {
  const ifAvailable = opts.ifAvailable === true;
  const locks = getLockManager();

  if (locks) {
    return locks.request(MAINTENANCE_LOCK_NAME, { mode: 'exclusive', ifAvailable }, async (lock) => {
      if (!lock) return { acquired: false } as LockOutcome<T>;
      const hold = issueHold(true);
      try {
        const value = await work(hold);
        return { acquired: true, authoritative: true, value } as LockOutcome<T>;
      } finally {
        liveHolds.delete(hold);
      }
    });
  }

  if (!(await acquireLocal(ifAvailable))) return { acquired: false };
  const hold = issueHold(false);
  try {
    const value = await work(hold);
    return { acquired: true, authoritative: false, value };
  } finally {
    liveHolds.delete(hold);
    releaseLocal();
  }
}
