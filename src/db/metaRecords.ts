/**
 * Records kept in the existing `meta` store (key/value). They are plain data, not schema: adding them needs
 * no migration, and the database stays at version 1.
 */
export const META_KEYS = {
  /** Present only while a restore is staging or committing, or after one was interrupted. */
  restoreSession: 'restoreSession',
  /** What changed since the last backup (drives the backup reminder). */
  backupState: 'backupState',
  /** Unsaved text of the Add/Edit form (one draft at a time). */
  entryDraft: 'entryDraft',
  /** When the last restore finished, and from which backup. */
  lastRestore: 'lastRestore',
  /** The backup reminder banner is hidden until this instant (24 h after it was dismissed). */
  reminderSnoozeUntil: 'reminderSnoozeUntil',
} as const;

/**
 * Written by a restore before it stages anything; deleted by its commit. Deliberately tiny: NOTHING about it is
 * judged by age or elapsed time. Whether the restore is still alive is decided only by the maintenance
 * Web Lock, which the browser holds while the restoring page is merely suspended and releases exactly when that
 * page is destroyed. Photo ids are NOT listed: staged photos are ordinary unreferenced photos, cleaned up by the
 * orphan sweep once the session is abandoned. See docs/PHASE2_PLAN.md, section 9.
 */
export interface RestoreSession {
  sessionId: string;
  startedAt: string;
  phase: 'staging' | 'committing';
}

/**
 * True when ANY record is stored under the restore-session key, whatever it contains and however old it is.
 * Failing closed on junk is deliberate: a record we cannot read must still block edits until a sweep that holds
 * the maintenance lock (so no restore is alive) clears it.
 */
export function restoreSessionExists(record: unknown): boolean {
  return record !== undefined && record !== null;
}
