import type { DrinkCategory } from '../../db/schema';
import { RestoreInProgressError, StorageFullError } from '../../db/errors';
import type { EntryProblem } from '../../utils/entryValidation';
import type { MessageKey } from '../../i18n/locales/en';

export type FieldName = 'dateTime' | 'alcoholPercentage' | 'alcoholVolumeMl' | 'category' | 'form';

/** Validation problems -> one message per form field. */
export function fieldErrors(problems: readonly EntryProblem[]): Partial<Record<FieldName, MessageKey>> {
  const out: Partial<Record<FieldName, MessageKey>> = {};
  for (const p of problems) {
    if (p.field === 'dateTime') out.dateTime = p.code === 'REQUIRED' ? 'error.field.dateTime.required' : 'error.field.dateTime.invalid';
    else if (p.field === 'alcoholPercentage') out.alcoholPercentage = 'error.field.abv';
    else if (p.field === 'alcoholVolumeMl') out.alcoholVolumeMl = 'error.field.volume';
    else if (p.field === 'category') out.category = 'error.field.category';
    else out.form = 'error.field.generic';
  }
  return out;
}

/** A failed write -> the message to show. Unknown failures get the generic "nothing was changed". */
export function writeErrorKey(err: unknown, fallback: MessageKey = 'error.saveFailed'): MessageKey {
  if (err instanceof StorageFullError) return 'error.storageFull';
  if (err instanceof RestoreInProgressError) return 'error.restoreInProgress';
  return fallback;
}

export const CATEGORY_LABEL_KEYS: Record<DrinkCategory, MessageKey> = {
  COCKTAIL: 'category.COCKTAIL',
  BEER: 'category.BEER',
  WINE: 'category.WINE',
  WHISKY: 'category.WHISKY',
  OTHER_SPIRITS: 'category.OTHER_SPIRITS',
  OTHER: 'category.OTHER',
};
