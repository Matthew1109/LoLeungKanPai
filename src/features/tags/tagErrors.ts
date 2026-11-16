import { RestoreInProgressError, StorageFullError, TagError, type TagErrorCode } from '../../db/errors';
import type { MessageKey } from '../../i18n/locales/en';

const TAG_ERROR_KEYS: Record<TagErrorCode, MessageKey> = {
  EMPTY: 'tags.error.empty',
  TOO_LONG: 'tags.error.tooLong',
  DUPLICATE: 'tags.error.duplicate',
  IN_USE: 'tags.error.inUse',
  NOT_FOUND: 'tags.error.notFound',
};

/** A failed tag change -> the message to show. Unknown failures get the generic "nothing was changed". */
export function tagErrorKey(err: unknown): MessageKey {
  if (err instanceof TagError) return TAG_ERROR_KEYS[err.code];
  if (err instanceof StorageFullError) return 'error.storageFull';
  if (err instanceof RestoreInProgressError) return 'error.restoreInProgress';
  return 'tags.error.generic';
}
