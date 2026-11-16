/**
 * Backup-reminder bookkeeping (decision E6). Pure functions; storage is a single `meta` record written inside
 * the same transaction as every entry save, so the bookkeeping can never disagree with the data.
 */
export interface BackupState {
  /** When the last successful backup snapshot was taken (or the restored backup was created); null = never. */
  lastBackupAt: string | null;
  /** entry id -> time of its latest create/edit since the last backup. Its size is the "distinct entries changed". */
  changed: Record<string, string>;
}

export const EMPTY_BACKUP_STATE: BackupState = { lastBackupAt: null, changed: {} };

export const REMINDER_CHANGED_ENTRIES = 10;
export const REMINDER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Defensive read of the stored record (meta values are untyped). */
export function normaliseBackupState(raw: unknown): BackupState {
  if (typeof raw !== 'object' || raw === null) return { lastBackupAt: null, changed: {} };
  const r = raw as { lastBackupAt?: unknown; changed?: unknown };
  const changed: Record<string, string> = {};
  if (typeof r.changed === 'object' && r.changed !== null && !Array.isArray(r.changed)) {
    for (const [id, stamp] of Object.entries(r.changed as Record<string, unknown>)) {
      if (typeof stamp === 'string') changed[id] = stamp;
    }
  }
  return { lastBackupAt: typeof r.lastBackupAt === 'string' ? r.lastBackupAt : null, changed };
}

export function withEntryChanged(state: BackupState, entryId: string, at: string): BackupState {
  return { ...state, changed: { ...state.changed, [entryId]: at } };
}

/** A deleted entry has nothing left to protect. */
export function withEntryRemoved(state: BackupState, entryId: string): BackupState {
  if (!(entryId in state.changed)) return state;
  const changed = { ...state.changed };
  delete changed[entryId];
  return { ...state, changed };
}

/**
 * State after a backup whose snapshot was taken at `snapshotAt`. Only changes made at or before the snapshot are
 * cleared: an entry edited again while the file was being built is not in that file, so it stays "changed".
 */
export function afterBackup(state: BackupState, snapshotAt: string): BackupState {
  const changed: Record<string, string> = {};
  for (const [id, at] of Object.entries(state.changed)) if (at > snapshotAt) changed[id] = at;
  return { lastBackupAt: snapshotAt, changed };
}

export interface ReminderInput {
  state: BackupState;
  entryCount: number;
  /** createdAt of the oldest entry (the "first diary entry"); null when there are none. */
  firstEntryCreatedAt: string | null;
  now: Date;
}

export interface ReminderResult {
  due: boolean;
  reason: 'changes' | 'age' | null;
  changedCount: number;
  daysSinceReference: number | null;
}

/**
 * Due when 10 or more distinct entries were created/edited since the last backup, or 30 days have passed since the
 * last backup (for a journal never backed up: since its first entry), provided there is something unprotected.
 * A journal that was never backed up has every entry unprotected.
 */
export function evaluateBackupReminder({ state, entryCount, firstEntryCreatedAt, now }: ReminderInput): ReminderResult {
  const none: ReminderResult = { due: false, reason: null, changedCount: 0, daysSinceReference: null };
  if (entryCount <= 0) return none;

  const neverBackedUp = state.lastBackupAt === null;
  const changedCount = neverBackedUp ? entryCount : Object.keys(state.changed).length;
  const reference = neverBackedUp ? firstEntryCreatedAt : state.lastBackupAt;
  const refMs = reference ? Date.parse(reference) : NaN;
  const daysSinceReference = Number.isNaN(refMs) ? null : Math.floor((now.getTime() - refMs) / DAY_MS);

  if (changedCount >= REMINDER_CHANGED_ENTRIES) return { due: true, reason: 'changes', changedCount, daysSinceReference };
  if (changedCount > 0 && daysSinceReference !== null && daysSinceReference >= REMINDER_DAYS) {
    return { due: true, reason: 'age', changedCount, daysSinceReference };
  }
  return { due: false, reason: null, changedCount, daysSinceReference };
}
