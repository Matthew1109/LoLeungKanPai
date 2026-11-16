import { BarError, RestoreInProgressError, StorageFullError, type BarErrorCode } from '../../db/errors';
import type { MessageKey } from '../../i18n/locales/en';

const BAR_ERROR_KEYS: Record<BarErrorCode, MessageKey> = {
  EMPTY: 'bars.error.empty',
  TOO_LONG: 'bars.error.tooLong',
  DUPLICATE: 'bars.error.duplicate',
  NOT_FOUND: 'bars.error.notFound',
};

/** A failed bar change -> the message to show. Unknown failures get the generic "nothing was changed". */
export function barErrorKey(err: unknown): MessageKey {
  if (err instanceof BarError) return BAR_ERROR_KEYS[err.code];
  if (err instanceof StorageFullError) return 'error.storageFull';
  if (err instanceof RestoreInProgressError) return 'error.restoreInProgress';
  return 'bars.error.generic';
}
