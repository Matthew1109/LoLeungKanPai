import { getDb } from './index';
import { notifyDataChanged } from './changeSignal';
import { EntryValidationError, RestoreInProgressError } from './errors';
import { META_KEYS, restoreSessionExists } from './metaRecords';
import { retryAfterAbandonedRestore } from './maintenance';
import { normaliseBackupState, withEntryChanged, withEntryRemoved } from './backupReminder';
import { runWriteTx, type WriteTx } from './tx';
import type { DrinkEntry, PhotoRecord } from './schema';
import { isValidDateTime, validateEntry, type EntryProblem } from '../utils/entryValidation';
import { toDayKey } from '../utils/dates';

export async function getEntriesInRange(startDayKey: string, endDayKey: string): Promise<DrinkEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('entries', 'dayKey', IDBKeyRange.bound(startDayKey, endDayKey));
}

/** Chronological (earliest first), as the Daily Journal requires. */
export async function getEntriesForDay(dayKey: string): Promise<DrinkEntry[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('entries', 'dayKey', dayKey);
  return rows.sort((a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0));
}

/** Every entry, in no particular order. The gallery, collections and search filter this in memory (personal-journal scale). */
export async function getAllEntries(): Promise<DrinkEntry[]> {
  const db = await getDb();
  return db.getAll('entries');
}

export async function getEntry(id: string): Promise<DrinkEntry | undefined> {
  const db = await getDb();
  return db.get('entries', id);
}

/** What the form did to the photograph. Editing never touches the photo unless this says so. */
export type PhotoChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace'; record: PhotoRecord; thumb: Blob };

export interface WriteOptions {
  /** Default true. Bulk callers (demo data, restore) pass false and notify once at the end. */
  notify?: boolean;
}

const KEEP_PHOTO: PhotoChange = { kind: 'keep' };

/**
 * Refuses edits while a restore-session record exists, whatever its age (checked inside the write transaction).
 * A record left by a restore whose page died is cleared by the retry in the public functions below, never by time.
 */
async function assertNoRestoreSession(tx: WriteTx): Promise<void> {
  const record = await tx.objectStore('meta').get(META_KEYS.restoreSession);
  if (restoreSessionExists(record)) throw new RestoreInProgressError();
}

/** Deletes a photo + thumbnail unless some entry still references it. Call after the referencing entry was updated. */
async function deletePhotoIfUnreferenced(tx: WriteTx, photoId: string): Promise<void> {
  const stillUsed = await tx.objectStore('entries').index('photoId').count(photoId);
  if (stillUsed > 0) return;
  await tx.objectStore('photos').delete(photoId);
  await tx.objectStore('thumbs').delete(photoId);
}

async function trackChange(tx: WriteTx, entryId: string, at: string): Promise<void> {
  const meta = tx.objectStore('meta');
  const state = normaliseBackupState((await meta.get(META_KEYS.backupState))?.value);
  await meta.put({ key: META_KEYS.backupState, value: withEntryChanged(state, entryId, at) });
}

async function trackRemoval(tx: WriteTx, entryId: string): Promise<void> {
  const meta = tx.objectStore('meta');
  const state = normaliseBackupState((await meta.get(META_KEYS.backupState))?.value);
  const next = withEntryRemoved(state, entryId);
  if (next !== state) await meta.put({ key: META_KEYS.backupState, value: next });
}

/** A form draft belongs to one entry id; once that entry is saved or deleted the draft must not survive. */
async function clearDraftFor(tx: WriteTx, entryId: string): Promise<void> {
  const meta = tx.objectStore('meta');
  const draft = await meta.get(META_KEYS.entryDraft);
  const draftEntryId = (draft?.value as { entryId?: unknown } | undefined)?.entryId;
  if (draftEntryId === entryId) await meta.delete(META_KEYS.entryDraft);
}

/**
 * Creates or updates an entry. Always `put` by id, so an edit (or a double tap) can never create a duplicate.
 *
 * One transaction, all or nothing: the entry, a new photo + thumbnail, removal of a replaced/removed photo
 * (unless another entry still uses it), the backup bookkeeping and removal of the matching form draft.
 *
 * The repository owns the derived fields: `dayKey` (local calendar day of `dateTime`), `createdAt` (kept from the
 * stored entry on edits), `updatedAt` (now) and `photoId` (taken from `photo`; for 'keep' the stored value).
 * Throws EntryValidationError (nothing written), RestoreInProgressError (a restore-session record exists and the lock
 * is held, so the restore may be alive), StorageFullError (nothing half-saved).
 * Returns the entry as stored.
 */
export async function saveEntry(input: DrinkEntry, photo: PhotoChange = KEEP_PHOTO, options: WriteOptions = {}): Promise<DrinkEntry> {
  const problems: EntryProblem[] = validateEntry(input);
  if (photo.kind === 'replace' && (typeof photo.record.id !== 'string' || photo.record.id.length === 0)) {
    problems.push({ field: 'photo', code: 'REQUIRED' });
  }
  if (problems.length > 0) throw new EntryValidationError(problems);

  const stored = await retryAfterAbandonedRestore(() => runWriteTx(async (tx) => {
    await assertNoRestoreSession(tx);
    const entries = tx.objectStore('entries');
    const existing = await entries.get(input.id);

    const stamp = new Date().toISOString();
    const dateTime = new Date(input.dateTime).toISOString();
    const photoId =
      photo.kind === 'replace' ? photo.record.id : photo.kind === 'remove' ? null : existing ? existing.photoId : input.photoId;
    const next: DrinkEntry = {
      id: input.id,
      drinkName: input.drinkName,
      category: input.category,
      dateTime,
      dayKey: toDayKey(new Date(dateTime)),
      barName: input.barName,
      photoId,
      baseSpiritTagIds: [...input.baseSpiritTagIds],
      ingredientTagIds: [...input.ingredientTagIds],
      alcoholPercentage: input.alcoholPercentage,
      alcoholVolumeMl: input.alcoholVolumeMl,
      notes: input.notes,
      isFavourite: input.isFavourite,
      createdAt: existing?.createdAt ?? (isValidDateTime(input.createdAt) ? new Date(input.createdAt).toISOString() : stamp),
      updatedAt: stamp,
    };

    await entries.put(next);
    if (photo.kind === 'replace') {
      await tx.objectStore('photos').put(photo.record);
      await tx.objectStore('thumbs').put({ id: photo.record.id, blob: photo.thumb });
    }
    const previousPhotoId = existing?.photoId ?? null;
    if (previousPhotoId && previousPhotoId !== photoId) await deletePhotoIfUnreferenced(tx, previousPhotoId);
    await trackChange(tx, next.id, stamp);
    await clearDraftFor(tx, next.id);
    return next;
  }));

  if (options.notify !== false) notifyDataChanged();
  return stored;
}

/**
 * Toggles the favourite flag in place (the heart on a journal card). Counts as an edit: bumps `updatedAt` and the
 * backup bookkeeping. Returns false when the entry no longer exists.
 */
export async function setEntryFavourite(id: string, isFavourite: boolean, options: WriteOptions = {}): Promise<boolean> {
  const changed = await retryAfterAbandonedRestore(() => runWriteTx(async (tx) => {
    await assertNoRestoreSession(tx);
    const entries = tx.objectStore('entries');
    const existing = await entries.get(id);
    if (!existing) return false;
    const stamp = new Date().toISOString();
    await entries.put({ ...existing, isFavourite, updatedAt: stamp });
    await trackChange(tx, id, stamp);
    return true;
  }));
  if (changed && options.notify !== false) notifyDataChanged();
  return changed;
}

/**
 * Deletes an entry and, in the same transaction, its photo + thumbnail (unless another entry still references the
 * photo). Returns false when there was nothing to delete. Confirmation is the UI's job.
 */
export async function deleteEntry(id: string, options: WriteOptions = {}): Promise<boolean> {
  const removed = await retryAfterAbandonedRestore(() => runWriteTx(async (tx) => {
    await assertNoRestoreSession(tx);
    const entries = tx.objectStore('entries');
    const existing = await entries.get(id);
    if (!existing) return false;
    await entries.delete(id);
    if (existing.photoId) await deletePhotoIfUnreferenced(tx, existing.photoId);
    await trackRemoval(tx, id);
    await clearDraftFor(tx, id);
    return true;
  }));
  if (removed && options.notify !== false) notifyDataChanged();
  return removed;
}
