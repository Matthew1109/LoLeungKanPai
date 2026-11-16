import { DRINK_CATEGORIES } from '../db/schema';
import { isValidDayKey } from './dates';

/** Limits from the Phase 2 plan. */
export const ABV_MAX = 100;
export const VOLUME_MAX_ML = 5000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export type EntryProblemCode = 'REQUIRED' | 'WRONG_TYPE' | 'DATE_TIME_INVALID' | 'ABV_RANGE' | 'VOLUME_RANGE' | 'CATEGORY_INVALID';

export interface EntryProblem {
  field: string;
  code: EntryProblemCode;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A parseable date-time in a sane range (a drink journal does not need the year 275760). */
export function isValidDateTime(value: unknown): value is string {
  if (!isString(value)) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  const year = new Date(ms).getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Field-by-field check of a drink entry. Accepts `unknown` so the same function validates user input now
 * and entries read from a backup file in the restore step. Returns every problem found (empty = valid).
 * `stamps: true` additionally requires the derived fields (dayKey, createdAt, updatedAt), as a backup must have.
 */
export function validateEntry(value: unknown, opts: { stamps?: boolean } = {}): EntryProblem[] {
  if (typeof value !== 'object' || value === null) return [{ field: 'entry', code: 'WRONG_TYPE' }];
  const e = value as Record<string, unknown>;
  const problems: EntryProblem[] = [];
  const add = (field: string, code: EntryProblemCode) => problems.push({ field, code });

  if (!isString(e.id) || e.id.length === 0) add('id', 'REQUIRED');

  if (e.dateTime === undefined || e.dateTime === null || e.dateTime === '') add('dateTime', 'REQUIRED');
  else if (!isValidDateTime(e.dateTime)) add('dateTime', 'DATE_TIME_INVALID');

  for (const field of ['drinkName', 'barName', 'notes'] as const) {
    if (!isString(e[field])) add(field, 'WRONG_TYPE');
  }

  if (e.category !== null && !(isString(e.category) && (DRINK_CATEGORIES as readonly string[]).includes(e.category))) {
    add('category', 'CATEGORY_INVALID');
  }

  if (e.photoId !== null && !(isString(e.photoId) && e.photoId.length > 0)) add('photoId', 'WRONG_TYPE');

  for (const field of ['baseSpiritTagIds', 'ingredientTagIds'] as const) {
    if (!isStringArray(e[field])) add(field, 'WRONG_TYPE');
  }

  if (e.alcoholPercentage !== null) {
    if (!isFiniteNumber(e.alcoholPercentage)) add('alcoholPercentage', 'WRONG_TYPE');
    else if (e.alcoholPercentage < 0 || e.alcoholPercentage > ABV_MAX) add('alcoholPercentage', 'ABV_RANGE');
  }

  if (e.alcoholVolumeMl !== null) {
    if (!isFiniteNumber(e.alcoholVolumeMl)) add('alcoholVolumeMl', 'WRONG_TYPE');
    else if (e.alcoholVolumeMl <= 0 || e.alcoholVolumeMl > VOLUME_MAX_ML) add('alcoholVolumeMl', 'VOLUME_RANGE');
  }

  if (typeof e.isFavourite !== 'boolean') add('isFavourite', 'WRONG_TYPE');

  if (opts.stamps) {
    if (!isString(e.dayKey) || !isValidDayKey(e.dayKey)) add('dayKey', 'WRONG_TYPE');
    if (!isValidDateTime(e.createdAt)) add('createdAt', 'WRONG_TYPE');
    if (!isValidDateTime(e.updatedAt)) add('updatedAt', 'WRONG_TYPE');
  }
  return problems;
}
