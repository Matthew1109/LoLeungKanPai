import type { EntryProblem } from '../utils/entryValidation';

/** The entry failed validation; nothing was written. `problems` lists every field at fault. */
export class EntryValidationError extends Error {
  readonly problems: EntryProblem[];
  constructor(problems: EntryProblem[]) {
    super(`Invalid entry: ${problems.map((p) => `${p.field}:${p.code}`).join(', ')}`);
    this.name = 'EntryValidationError';
    this.problems = problems;
  }
}

/** A restore is rewriting the journal; edits are refused until it finishes (or is found abandoned). */
export class RestoreInProgressError extends Error {
  constructor() {
    super('A restore is in progress');
    this.name = 'RestoreInProgressError';
  }
}

/** The device ran out of storage. The transaction was aborted, so nothing was half-saved. */
export class StorageFullError extends Error {
  constructor(cause: unknown) {
    super('Not enough storage on this device', { cause });
    this.name = 'StorageFullError';
  }
}

/** True for the many shapes browsers use to say "out of space" (Safari/Chrome/Firefox, wrapped or not). */
export function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22 || e.code === 1014) return true; // legacy DOMException codes for quota
  if (typeof e.message === 'string' && /quota/i.test(e.message)) return true;
  return e.cause !== undefined && isQuotaError(e.cause);
}

/** Maps low-level write failures to the errors the UI knows how to explain. Unknown errors pass through unchanged. */
export function toWriteError(err: unknown): unknown {
  if (err instanceof EntryValidationError || err instanceof RestoreInProgressError || err instanceof StorageFullError) return err;
  return isQuotaError(err) ? new StorageFullError(err) : err;
}
