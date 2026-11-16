import type { DrinkEntry } from '../../db/schema';
import type { EntryDraftFields } from '../../db/entryDraft';
import { isValidDayKey, toDayKey } from '../../utils/dates';
import { validateEntry, type EntryProblem } from '../../utils/entryValidation';

/** Pure logic of the Add/Edit form (no React, no storage): easy to test. */

const pad = (n: number) => String(n).padStart(2, '0');
export const DEFAULT_EVENING_TIME = '20:00';
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Decision E4: now if the date is today, otherwise 20:00. */
export function defaultTimeFor(dayKey: string, now: Date): string {
  return dayKey === toDayKey(now) ? formatTime(now) : DEFAULT_EVENING_TIME;
}

/** The `?date=` parameter when it is a real day in the supported range, otherwise today. */
export function initialDayKey(param: string | null, now: Date): string {
  if (param && isValidDayKey(param)) {
    const year = Number(param.slice(0, 4));
    if (year >= MIN_YEAR && year <= MAX_YEAR) return param;
  }
  return toDayKey(now);
}

export function emptyFields(dayKey: string, now: Date): EntryDraftFields {
  return {
    drinkName: '', category: null, date: dayKey, time: defaultTimeFor(dayKey, now),
    barName: '', alcoholPercentage: '', alcoholVolumeMl: '', notes: '', isFavourite: false,
  };
}

export function fieldsFromEntry(entry: DrinkEntry): EntryDraftFields {
  const when = new Date(entry.dateTime);
  return {
    drinkName: entry.drinkName,
    category: entry.category,
    date: toDayKey(when),
    time: formatTime(when),
    barName: entry.barName,
    alcoholPercentage: entry.alcoholPercentage === null ? '' : String(entry.alcoholPercentage),
    alcoholVolumeMl: entry.alcoholVolumeMl === null ? '' : String(entry.alcoholVolumeMl),
    notes: entry.notes,
    isFavourite: entry.isFavourite,
  };
}

export function sameFields(a: EntryDraftFields, b: EntryDraftFields): boolean {
  return (
    a.drinkName === b.drinkName && a.category === b.category && a.date === b.date && a.time === b.time &&
    a.barName === b.barName && a.alcoholPercentage === b.alcoholPercentage &&
    a.alcoholVolumeMl === b.alcoholVolumeMl && a.notes === b.notes && a.isFavourite === b.isFavourite
  );
}

/** The tags chosen in the form. Like the photo, they are not part of the text draft. */
export interface TagSelection {
  baseSpiritTagIds: string[];
  ingredientTagIds: string[];
}

export function tagSelectionFromEntry(entry: DrinkEntry | undefined): TagSelection {
  return entry
    ? { baseSpiritTagIds: [...entry.baseSpiritTagIds], ingredientTagIds: [...entry.ingredientTagIds] }
    : { baseSpiritTagIds: [], ingredientTagIds: [] };
}

const sameIdSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Same tags, in any order. */
export function sameTagSelection(a: TagSelection, b: TagSelection): boolean {
  return sameIdSet(a.baseSpiritTagIds, b.baseSpiritTagIds) && sameIdSet(a.ingredientTagIds, b.ingredientTagIds);
}

export type ParsedNumber = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'invalid' };

/** "12", "12.5", "12,5", ".5", "12." are numbers; blank is empty; everything else (signs, exponents, text) is invalid. */
export function parseDecimal(text: string): ParsedNumber {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!/^\d*[.,]?\d*$/.test(trimmed) || !/\d/.test(trimmed)) return { kind: 'invalid' };
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
}

/** Local date + local time -> ISO instant, or null when either is malformed. */
export function toDateTimeIso(date: string, time: string): string | null {
  if (!isValidDayKey(date)) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const when = new Date(y, mo - 1, d, Number(m[1]), Number(m[2]));
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

export type BuildResult = { ok: true; entry: DrinkEntry } | { ok: false; problems: EntryProblem[] };

/**
 * Form text -> the DrinkEntry handed to saveEntry. Reports every problem at once. Tag ids come from `ctx.tags`
 * (what the form's pickers hold); without it an edit carries the stored entry's tags through unchanged.
 * photoId and createdAt come from the stored entry.
 * The repository re-derives dayKey, createdAt, updatedAt and photoId itself.
 */
export function buildEntryInput(
  fields: EntryDraftFields,
  ctx: { id: string; existing: DrinkEntry | undefined; now: Date; tags?: TagSelection },
): BuildResult {
  const problems: EntryProblem[] = [];
  const iso = toDateTimeIso(fields.date, fields.time);
  const abv = parseDecimal(fields.alcoholPercentage);
  const volume = parseDecimal(fields.alcoholVolumeMl);
  if (abv.kind === 'invalid') problems.push({ field: 'alcoholPercentage', code: 'WRONG_TYPE' });
  if (volume.kind === 'invalid') problems.push({ field: 'alcoholVolumeMl', code: 'WRONG_TYPE' });

  const stamp = ctx.now.toISOString();
  const existing = ctx.existing;
  const tags = ctx.tags ?? tagSelectionFromEntry(existing);
  const candidate: DrinkEntry = {
    id: ctx.id,
    drinkName: fields.drinkName.trim(),
    category: fields.category,
    dateTime: iso ?? (fields.date === '' || fields.time === '' ? '' : 'invalid'),
    dayKey: iso ? toDayKey(new Date(iso)) : '',
    barName: fields.barName.trim(),
    photoId: existing ? existing.photoId : null,
    baseSpiritTagIds: [...tags.baseSpiritTagIds],
    ingredientTagIds: [...tags.ingredientTagIds],
    alcoholPercentage: abv.kind === 'number' ? abv.value : null,
    alcoholVolumeMl: volume.kind === 'number' ? volume.value : null,
    notes: fields.notes.trim(),
    isFavourite: fields.isFavourite,
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: existing ? existing.updatedAt : stamp,
  };
  problems.push(...validateEntry(candidate));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, entry: candidate };
}
