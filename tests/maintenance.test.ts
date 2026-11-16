import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db';
import { saveEntry } from '../src/db/entryRepo';
import { RestoreInProgressError } from '../src/db/errors';
import {
  planOrphans,
  retryAfterAbandonedRestore,
  sweepOrphanPhotos,
  sweepWhileLocked,
  type SweepResult,
} from '../src/db/maintenance';
import { MAINTENANCE_LOCK_NAME, assertLockHeld, isRestoreSupported, withMaintenanceLock, type LockHold } from '../src/db/locks';
import { META_KEYS } from '../src/db/metaRecords';
import {
  clearAll, hasRestoreSession, makeEntry, makePhoto, putRestoreSession, stagePhotos, storedPhotoKeys,
  stubNoWebLocks, stubWebLocks,
} from './helpers';

const DAY = '2026-05-07';
const NOT_HELD = 'The maintenance lock is not held';

beforeEach(clearAll);
afterEach(() => vi.unstubAllGlobals());

describe('planOrphans (pure)', () => {
  it('lists photo and thumbnail keys nobody references', () => {
    expect(planOrphans(new Set(['a']), ['a', 'b'], ['a', 'c'])).toEqual({ photos: ['b'], thumbs: ['c'] });
    expect(planOrphans(new Set(), [], [])).toEqual({ photos: [], thumbs: [] });
  });
});

describe('every sweep takes the exclusive maintenance lock and keeps it until its work is finished', () => {
  it('asks for lkp-maintenance, exclusive + ifAvailable, and has deleted the orphans before the lock is released', async () => {
    const locks = stubWebLocks();
    await stagePhotos('orphan');
    const seenAtRelease: Array<{ photos: string[]; thumbs: string[] }> = [];
    locks.beforeRelease = async () => {
      seenAtRelease.push(await storedPhotoKeys()); // the lock is still ours here
    };

    const result = await sweepOrphanPhotos();

    expect(locks.calls).toEqual([{ name: MAINTENANCE_LOCK_NAME, options: { mode: 'exclusive', ifAvailable: true } }]);
    expect(MAINTENANCE_LOCK_NAME).toBe('lkp-maintenance');
    expect(locks.events).toEqual(['acquired', 'released']);
    expect(result.removedPhotos).toBe(1);
    expect(seenAtRelease).toEqual([{ photos: [], thumbs: [] }]);
    expect(locks.isHeld()).toBe(false);
  });

  it('withMaintenanceLock holds the lock for the whole of its (async) work and releases it afterwards, even on error', async () => {
    const locks = stubWebLocks();
    const seen: boolean[] = [];
    const outcome = await withMaintenanceLock(async (hold) => {
      seen.push(locks.isHeld());
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(locks.isHeld());
      return hold.authoritative;
    });
    expect(outcome).toEqual({ acquired: true, authoritative: true, value: true });
    expect(seen).toEqual([true, true]);
    expect(locks.isHeld()).toBe(false);

    await expect(withMaintenanceLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(locks.isHeld()).toBe(false);
  });

  it('a sweep requested while another holder (a restore, or another sweep) has the lock is skipped, not run alongside', async () => {
    const locks = stubWebLocks();
    const inner: SweepResult[] = [];
    await withMaintenanceLock(async () => {
      inner.push(await sweepOrphanPhotos());
    });
    expect(inner.map((r) => r.skipped)).toEqual([true]);
    expect(locks.calls).toHaveLength(2);

    const both = await Promise.all([sweepOrphanPhotos(), sweepOrphanPhotos()]);
    expect(both.map((r) => r.skipped).sort()).toEqual([false, true]);
  });

  it('sweepWhileLocked refuses a forged hold (nobody holds the lock) and touches nothing', async () => {
    stubWebLocks();
    await stagePhotos('staged');
    await putRestoreSession();
    const forged = { authoritative: true } as unknown as LockHold;
    await expect(sweepWhileLocked(forged)).rejects.toThrow(NOT_HELD);
    expect(() => assertLockHeld(forged)).toThrow(NOT_HELD);
    expect(await storedPhotoKeys()).toEqual({ photos: ['staged'], thumbs: ['staged'] });
    expect(await hasRestoreSession()).toBe(true);
  });

  it('sweepWhileLocked refuses a hold that outlived its lock', async () => {
    stubWebLocks();
    const kept: LockHold[] = [];
    await withMaintenanceLock(async (hold) => {
      kept.push(hold);
      assertLockHeld(hold); // valid while the lock is held
      await sweepWhileLocked(hold);
    });
    expect(kept).toHaveLength(1);
    await stagePhotos('staged');
    await expect(sweepWhileLocked(kept[0])).rejects.toThrow(NOT_HELD);
    expect(await storedPhotoKeys()).toEqual({ photos: ['staged'], thumbs: ['staged'] });
  });

  it('rejects junk passed as a hold', async () => {
    await expect(sweepWhileLocked(null as unknown as LockHold)).rejects.toThrow(NOT_HELD);
    await expect(sweepWhileLocked(undefined as unknown as LockHold)).rejects.toThrow(NOT_HELD);
    await expect(sweepWhileLocked('hold' as unknown as LockHold)).rejects.toThrow(NOT_HELD);
  });

  it('isRestoreSupported reports whether the Web Locks API exists', () => {
    stubWebLocks();
    expect(isRestoreSupported()).toBe(true);
    stubNoWebLocks();
    expect(isRestoreSupported()).toBe(false);
    vi.stubGlobal('navigator', { locks: {} }); // an object without request()
    expect(isRestoreSupported()).toBe(false);
  });
});

describe('sweepOrphanPhotos', () => {
  it('removes unreferenced photos and thumbnails (including half-orphans) and keeps referenced ones', async () => {
    stubWebLocks();
    await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('keep') });
    await stagePhotos('orphan1', 'orphan2');
    const db = await getDb();
    await db.put('thumbs', { id: 'thumb-only', blob: new Blob(['x']) });
    await db.put('photos', makePhoto('photo-only').record);

    const result = await sweepOrphanPhotos();
    expect(result.skipped).toBe(false);
    expect(result.removedPhotos).toBe(3);
    expect(result.removedThumbs).toBe(3);
    expect(result.clearedRestoreSession).toBe(false);
    expect(await storedPhotoKeys()).toEqual({ photos: ['keep'], thumbs: ['keep'] });
  });

  it('lock held by a restore (live or merely suspended): skipped, staged photos and the session record stay', async () => {
    stubWebLocks({ heldElsewhere: true });
    await stagePhotos('staged');
    await putRestoreSession();
    const result = await sweepOrphanPhotos();
    expect(result.skipped).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: ['staged'], thumbs: ['staged'] });
    expect(await hasRestoreSession()).toBe(true);
  });

  it('lock held and no session record yet: still skipped (the restore may be about to write one)', async () => {
    stubWebLocks({ heldElsewhere: true });
    await stagePhotos('maybe-staged');
    expect((await sweepOrphanPhotos()).skipped).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: ['maybe-staged'], thumbs: ['maybe-staged'] });
  });

  it('lock free: the restore is dead, so its session record AND staged photos are cleaned, whatever the record says about time', async () => {
    stubWebLocks();
    await putRestoreSession(new Date().toISOString()); // looks brand new; only the free lock matters
    await stagePhotos('s1', 's2');
    const result = await sweepOrphanPhotos();
    expect(result.skipped).toBe(false);
    expect(result.clearedRestoreSession).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
    expect(await hasRestoreSession()).toBe(false);
  });

  it('a suspended restore keeps its photos for as long as it holds the lock, and loses them when its page dies', async () => {
    const locks = stubWebLocks({ heldElsewhere: true });
    await putRestoreSession(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()); // days old: irrelevant
    await stagePhotos('s1');

    expect((await sweepOrphanPhotos()).skipped).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: ['s1'], thumbs: ['s1'] });
    expect(await hasRestoreSession()).toBe(true);

    locks.setHeldElsewhere(false); // the browser released the lock because that page was destroyed
    const result = await sweepOrphanPhotos();
    expect(result.clearedRestoreSession).toBe(true);
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
    expect(await hasRestoreSession()).toBe(false);
  });

  it('without Web Locks and with a session record: skipped, and the record is never deleted, whatever its age', async () => {
    stubNoWebLocks();
    for (const startedAt of [new Date().toISOString(), '2000-01-01T00:00:00.000Z']) {
      await putRestoreSession(startedAt);
      await stagePhotos('s1');
      const result = await sweepOrphanPhotos();
      expect(result.skipped).toBe(true);
      expect(await storedPhotoKeys()).toEqual({ photos: ['s1'], thumbs: ['s1'] });
      expect(await hasRestoreSession()).toBe(true);
    }
  });

  it('without Web Locks and without a session record: the normal orphan sweep runs', async () => {
    stubNoWebLocks();
    await saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('keep') });
    await stagePhotos('orphan');
    const result = await sweepOrphanPhotos();
    expect(result.skipped).toBe(false);
    expect(result.clearedRestoreSession).toBe(false);
    expect(await storedPhotoKeys()).toEqual({ photos: ['keep'], thumbs: ['keep'] });
  });

  it('a junk value under the session key counts as a session (fails closed) and is cleared only by an authoritative sweep', async () => {
    stubNoWebLocks();
    const db = await getDb();
    await db.put('meta', { key: META_KEYS.restoreSession, value: 'garbage' });
    await stagePhotos('s1');
    expect((await sweepOrphanPhotos()).skipped).toBe(true);
    expect(await hasRestoreSession()).toBe(true);

    stubWebLocks();
    expect((await sweepOrphanPhotos()).clearedRestoreSession).toBe(true);
    expect(await hasRestoreSession()).toBe(false);
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
  });

  it('never touches photos of entries saved while the sweep runs (same transaction scope serialises them)', async () => {
    stubWebLocks();
    const saving = saveEntry(makeEntry('a', DAY, 20), { kind: 'replace', ...makePhoto('new') });
    const sweeping = sweepOrphanPhotos();
    await Promise.all([saving, sweeping]);
    expect(await storedPhotoKeys()).toEqual({ photos: ['new'], thumbs: ['new'] });
  });
});

describe('retryAfterAbandonedRestore', () => {
  it('returns the result of a write that works, without any sweep', async () => {
    const locks = stubWebLocks();
    expect(await retryAfterAbandonedRestore(async () => 42)).toBe(42);
    expect(locks.calls).toHaveLength(0);
  });

  it('passes every other error through untouched and never sweeps', async () => {
    const locks = stubWebLocks();
    const boom = new Error('boom');
    await expect(retryAfterAbandonedRestore(async () => { throw boom; })).rejects.toBe(boom);
    expect(locks.calls).toHaveLength(0);
  });

  it('refusal + lock free (restore dead): sweeps once, clears the leftovers and runs the write again exactly once', async () => {
    const locks = stubWebLocks();
    await putRestoreSession();
    await stagePhotos('s1');
    let attempts = 0;
    const result = await retryAfterAbandonedRestore(async () => {
      attempts++;
      if (await hasRestoreSession()) throw new RestoreInProgressError();
      return 'saved';
    });
    expect(result).toBe('saved');
    expect(attempts).toBe(2);
    expect(locks.calls).toHaveLength(1);
    expect(await storedPhotoKeys()).toEqual({ photos: [], thumbs: [] });
  });

  it('refusal + lock held (restore alive): the original refusal is rethrown and nothing is retried', async () => {
    stubWebLocks({ heldElsewhere: true });
    await putRestoreSession();
    const refusal = new RestoreInProgressError();
    let attempts = 0;
    await expect(retryAfterAbandonedRestore(async () => { attempts++; throw refusal; })).rejects.toBe(refusal);
    expect(attempts).toBe(1);
    expect(await hasRestoreSession()).toBe(true);
  });

  it('a second refusal after the clean-up is not retried again', async () => {
    stubWebLocks();
    let attempts = 0;
    await expect(retryAfterAbandonedRestore(async () => { attempts++; throw new RestoreInProgressError(); })).rejects.toBeInstanceOf(RestoreInProgressError);
    expect(attempts).toBe(2);
  });

  it('if the clean-up itself fails, the refusal (the more useful message) is what the caller sees', async () => {
    vi.stubGlobal('navigator', { locks: { request: async () => { throw new Error('locks are broken'); } } });
    const refusal = new RestoreInProgressError();
    await expect(retryAfterAbandonedRestore(async () => { throw refusal; })).rejects.toBe(refusal);
  });

  it('without Web Locks a refusal stands (the sweep skips, the record is kept)', async () => {
    stubNoWebLocks();
    await putRestoreSession();
    const refusal = new RestoreInProgressError();
    await expect(retryAfterAbandonedRestore(async () => { throw refusal; })).rejects.toBe(refusal);
    expect(await hasRestoreSession()).toBe(true);
  });
});

describe('withMaintenanceLock fallback (no Web Locks)', () => {
  it('lets an ifAvailable caller skip while this page holds the lock, and queues a waiting caller', async () => {
    stubNoWebLocks();
    const order: string[] = [];
    const queued: Array<Promise<unknown>> = [];
    await withMaintenanceLock(async () => {
      order.push('first:start');
      const inner = await withMaintenanceLock(async () => 'never', { ifAvailable: true });
      order.push(inner.acquired ? 'inner:acquired' : 'inner:skipped');
      queued.push(withMaintenanceLock(async () => order.push('queued:ran'))); // must wait: never await it in here (deadlock)
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first:end');
    });
    await Promise.all(queued);
    expect(order).toEqual(['first:start', 'inner:skipped', 'first:end', 'queued:ran']);
    const after = await withMaintenanceLock(async () => 'free', { ifAvailable: true });
    expect(after.acquired).toBe(true);
  });

  it('its hold is not authoritative', async () => {
    stubNoWebLocks();
    const outcome = await withMaintenanceLock(async (hold) => hold.authoritative);
    expect(outcome).toEqual({ acquired: true, authoritative: false, value: false });
  });

  it('releases the lock even when the work throws', async () => {
    stubNoWebLocks();
    await expect(withMaintenanceLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const after = await withMaintenanceLock(async () => 'free', { ifAvailable: true });
    expect(after.acquired).toBe(true);
  });
});
