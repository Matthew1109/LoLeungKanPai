import { BackupFormatError, type BackupErrorCode } from '../../backup/backupFormat';
import { JournalChangedError } from '../../backup/exportBackup';
import { RestoreAbortedError, RestoreUnsupportedError } from '../../backup/restore';
import { ZipError } from '../../backup/zip';
import { RestoreInProgressError, StorageFullError } from '../../db/errors';
import type { MessageKey } from '../../i18n/locales/en';
import { PhotoProcessingError } from '../../services/imageProcessing';

const FORMAT_KEYS: Record<BackupErrorCode, MessageKey> = {
  NOT_A_BACKUP: 'restore.error.notBackup',
  UNREADABLE: 'restore.error.unreadable',
  NEWER_VERSION: 'restore.error.newer',
  DAMAGED: 'restore.error.damaged',
  INVALID: 'restore.error.invalid',
  MISSING_PHOTO: 'restore.error.missingPhoto',
};

/** Why a restore (or the check before it) failed. In every case the journal was not changed. */
export function restoreErrorKey(err: unknown): MessageKey {
  if (err instanceof BackupFormatError) return FORMAT_KEYS[err.code];
  if (err instanceof StorageFullError) return 'restore.error.storageFull';
  if (err instanceof RestoreUnsupportedError) return 'restore.unsupported';
  if (err instanceof RestoreInProgressError) return 'error.restoreInProgress';
  if (err instanceof RestoreAbortedError) return 'restore.error.aborted';
  if (err instanceof PhotoProcessingError) return 'restore.error.photo';
  return 'restore.error.generic';
}

/** Why creating a backup failed. The journal is never touched by this. */
export function backupErrorKey(err: unknown): MessageKey {
  if (err instanceof JournalChangedError) return 'backup.error.changed';
  if (err instanceof ZipError && err.code === 'TOO_LARGE') return 'backup.error.tooLarge';
  return 'backup.error.generic';
}
