import { getDb } from './index';
import { notifyDataChanged } from './changeSignal';
import { META_KEYS } from './metaRecords';
import { afterBackup, evaluateBackupReminder, normaliseBackupState, type ReminderResult } from './backupReminder';
import { runWriteTx } from './tx';
import type { DrinkEntry, Tag } from './schema';

/** Consistent copy of entries and tags, plus the instant it stands for (see createBackup). */
export interface Snapshot {
  at: string;
  entries: DrinkEntry[];
  tags: Tag[];
}

/**
 * `at` is taken BEFORE the read and then one millisecond is allowed to pass, so every change stamped at or before
 * `at` was committed before this read started and is in the snapshot; a change stamped later stays "changed" even
 * if it happens to be in the file as well (the safe side).
 */
export async function takeSnapshot(): Promise<Snapshot> {
  const at = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const db = await getDb();
  const tx = db.transaction(['entries', 'tags'], 'readonly');
  const [entries, tags] = await Promise.all([tx.objectStore('entries').getAll(), tx.objectStore('tags').getAll()]);
  await tx.done;
  return { at, entries, tags };
}

/** The backup file was handed to the share sheet / download: changes up to its snapshot are now protected. */
export async function recordBackupMade(snapshotAt: string): Promise<void> {
  await runWriteTx(async (tx) => {
    const meta = tx.objectStore('meta');
    const state = normaliseBackupState((await meta.get(META_KEYS.backupState))?.value);
    await meta.put({ key: META_KEYS.backupState, value: afterBackup(state, snapshotAt) });
  });
  notifyDataChanged();
}

export interface BackupStatus {
  lastBackupAt: string | null;
  entryCount: number;
  photoCount: number;
  reminder: ReminderResult;
}

export async function getBackupStatus(now: Date = new Date()): Promise<BackupStatus> {
  const db = await getDb();
  const tx = db.transaction(['entries', 'meta'], 'readonly');
  const [entries, stateRecord, snooze] = await Promise.all([
    tx.objectStore('entries').getAll(),
    tx.objectStore('meta').get(META_KEYS.backupState),
    tx.objectStore('meta').get(META_KEYS.reminderSnoozeUntil),
  ]);
  await tx.done;
  const state = normaliseBackupState(stateRecord?.value);
  const first = entries.reduce<string | null>((min, e) => (min === null || e.createdAt < min ? e.createdAt : min), null);
  const reminder = evaluateBackupReminder({ state, entryCount: entries.length, firstEntryCreatedAt: first, now });
  const until = typeof snooze?.value === 'string' ? Date.parse(snooze.value) : NaN;
  if (reminder.due && !Number.isNaN(until) && until > now.getTime()) reminder.due = false;
  return {
    lastBackupAt: state.lastBackupAt,
    entryCount: entries.length,
    photoCount: new Set(entries.flatMap((e) => (e.photoId ? [e.photoId] : []))).size,
    reminder,
  };
}

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Dismissing the reminder hides it for 24 hours. */
export async function snoozeReminder(now: Date = new Date()): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: META_KEYS.reminderSnoozeUntil, value: new Date(now.getTime() + SNOOZE_MS).toISOString() });
  notifyDataChanged();
}
