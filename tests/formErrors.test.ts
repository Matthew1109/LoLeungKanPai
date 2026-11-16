import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en';
import { CATEGORY_LABEL_KEYS, fieldErrors, writeErrorKey } from '../src/features/add/formErrors';
import { RestoreInProgressError, StorageFullError } from '../src/db/errors';
import { DRINK_CATEGORIES } from '../src/db/schema';
import type { EntryProblem } from '../src/utils/entryValidation';

const problem = (field: string, code: EntryProblem['code']): EntryProblem => ({ field, code });
const hasKey = (key: string | undefined) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(en, key);

describe('fieldErrors', () => {
  it('no problems, no messages', () => {
    expect(fieldErrors([])).toEqual({});
  });

  it('maps each field to its own message', () => {
    expect(fieldErrors([problem('dateTime', 'REQUIRED')])).toEqual({ dateTime: 'error.field.dateTime.required' });
    expect(fieldErrors([problem('dateTime', 'DATE_TIME_INVALID')])).toEqual({ dateTime: 'error.field.dateTime.invalid' });
    expect(fieldErrors([problem('alcoholPercentage', 'ABV_RANGE')])).toEqual({ alcoholPercentage: 'error.field.abv' });
    expect(fieldErrors([problem('alcoholPercentage', 'WRONG_TYPE')])).toEqual({ alcoholPercentage: 'error.field.abv' });
    expect(fieldErrors([problem('alcoholVolumeMl', 'VOLUME_RANGE')])).toEqual({ alcoholVolumeMl: 'error.field.volume' });
    expect(fieldErrors([problem('category', 'CATEGORY_INVALID')])).toEqual({ category: 'error.field.category' });
  });

  it('anything else becomes the generic form-level message', () => {
    expect(fieldErrors([problem('drinkName', 'WRONG_TYPE')])).toEqual({ form: 'error.field.generic' });
    expect(fieldErrors([problem('entry', 'WRONG_TYPE')])).toEqual({ form: 'error.field.generic' });
  });

  it('several problems give several messages at once', () => {
    const result = fieldErrors([problem('dateTime', 'REQUIRED'), problem('alcoholVolumeMl', 'VOLUME_RANGE'), problem('alcoholPercentage', 'ABV_RANGE')]);
    expect(Object.keys(result).sort()).toEqual(['alcoholPercentage', 'alcoholVolumeMl', 'dateTime']);
  });

  it('only returns keys that exist in the catalogue', () => {
    const all: EntryProblem[] = [
      problem('dateTime', 'REQUIRED'), problem('dateTime', 'DATE_TIME_INVALID'), problem('alcoholPercentage', 'ABV_RANGE'),
      problem('alcoholVolumeMl', 'VOLUME_RANGE'), problem('category', 'CATEGORY_INVALID'), problem('notes', 'WRONG_TYPE'),
    ];
    for (const p of all) for (const key of Object.values(fieldErrors([p]))) expect(hasKey(key)).toBe(true);
  });
});

describe('writeErrorKey', () => {
  it('explains a full device', () => {
    expect(writeErrorKey(new StorageFullError(new Error('quota')))).toBe('error.storageFull');
    expect(writeErrorKey(new StorageFullError(null), 'error.deleteFailed')).toBe('error.storageFull');
  });

  it('explains a restore in progress', () => {
    expect(writeErrorKey(new RestoreInProgressError())).toBe('error.restoreInProgress');
    expect(writeErrorKey(new RestoreInProgressError(), 'error.updateFailed')).toBe('error.restoreInProgress');
  });

  it('anything else gets the generic "nothing was changed" message, or the caller\'s own', () => {
    expect(writeErrorKey(new Error('boom'))).toBe('error.saveFailed');
    expect(writeErrorKey('a string')).toBe('error.saveFailed');
    expect(writeErrorKey(null)).toBe('error.saveFailed');
    expect(writeErrorKey(undefined)).toBe('error.saveFailed');
    expect(writeErrorKey(new Error('boom'), 'error.deleteFailed')).toBe('error.deleteFailed');
    expect(writeErrorKey(new Error('boom'), 'error.updateFailed')).toBe('error.updateFailed');
  });

  it('all the keys it can return exist in the catalogue', () => {
    for (const key of ['error.storageFull', 'error.restoreInProgress', 'error.saveFailed', 'error.deleteFailed', 'error.updateFailed']) {
      expect(hasKey(key)).toBe(true);
    }
  });
});

describe('CATEGORY_LABEL_KEYS', () => {
  it('has a label for exactly the categories the data model allows, each present in the catalogue', () => {
    expect(Object.keys(CATEGORY_LABEL_KEYS).sort()).toEqual([...DRINK_CATEGORIES].sort());
    for (const category of DRINK_CATEGORIES) {
      expect(hasKey(CATEGORY_LABEL_KEYS[category])).toBe(true);
    }
  });
});
