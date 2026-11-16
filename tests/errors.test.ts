import { describe, expect, it } from 'vitest';
import { StorageFullError, isQuotaError, toWriteError, EntryValidationError } from '../src/db/errors';

describe('quota error classification', () => {
  it('recognises the common shapes', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('The quota has been exceeded'))).toBe(true);
    expect(isQuotaError(new Error('wrapped', { cause: new DOMException('x', 'QuotaExceededError') }))).toBe(true);
  });

  it('does not misclassify other failures', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(new DOMException('bad', 'DataCloneError'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
  });

  it('toWriteError maps quota to StorageFullError and leaves everything else alone', () => {
    const quota = toWriteError(new DOMException('full', 'QuotaExceededError'));
    expect(quota).toBeInstanceOf(StorageFullError);
    const other = new Error('boom');
    expect(toWriteError(other)).toBe(other);
    const validation = new EntryValidationError([{ field: 'dateTime', code: 'REQUIRED' }]);
    expect(toWriteError(validation)).toBe(validation);
  });
});
