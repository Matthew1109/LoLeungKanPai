import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENING_TIME, buildEntryInput, defaultTimeFor, emptyFields, fieldsFromEntry, formatTime, initialDayKey,
  parseDecimal, sameFields, toDateTimeIso,
} from '../src/features/add/entryFormModel';
import type { EntryDraftFields } from '../src/db/entryDraft';
import { at, makeEntry } from './helpers';

const DAY = '2026-05-07';
const NOW = new Date(2026, 4, 7, 9, 5); // local time, so every assertion is timezone-proof

const fields = (patch: Partial<EntryDraftFields> = {}): EntryDraftFields => ({ ...emptyFields(DAY, NOW), ...patch });
const problemFields = (result: ReturnType<typeof buildEntryInput>) =>
  (result.ok ? [] : result.problems.map((p) => `${p.field}:${p.code}`)).sort();

describe('defaults for a new entry (decision E4)', () => {
  it('formats a time as HH:mm', () => {
    expect(formatTime(new Date(2026, 4, 7, 9, 5))).toBe('09:05');
    expect(formatTime(new Date(2026, 4, 7, 23, 59))).toBe('23:59');
  });

  it('uses the current time when the day is today, otherwise 20:00', () => {
    expect(defaultTimeFor(DAY, NOW)).toBe('09:05');
    expect(defaultTimeFor('2026-05-06', NOW)).toBe(DEFAULT_EVENING_TIME);
    expect(defaultTimeFor('2026-05-08', NOW)).toBe('20:00');
  });

  it('takes ?date= only when it is a real day in the supported years, otherwise today', () => {
    expect(initialDayKey('2026-04-30', NOW)).toBe('2026-04-30');
    expect(initialDayKey('1900-01-01', NOW)).toBe('1900-01-01');
    expect(initialDayKey('2100-12-31', NOW)).toBe('2100-12-31');
    for (const bad of [null, '', 'garbage', '2026-02-31', '2026-13-01', '2026-5-7', '1899-12-31', '2101-01-01']) {
      expect(initialDayKey(bad, NOW)).toBe(DAY);
    }
  });

  it('starts empty, with today\'s time for today and 20:00 for another day', () => {
    expect(emptyFields(DAY, NOW)).toEqual({
      drinkName: '', category: null, date: DAY, time: '09:05', barName: '',
      alcoholPercentage: '', alcoholVolumeMl: '', notes: '', isFavourite: false,
    });
    expect(emptyFields('2026-04-01', NOW).time).toBe('20:00');
    expect(emptyFields('2026-04-01', NOW).date).toBe('2026-04-01');
  });
});

describe('fieldsFromEntry and sameFields', () => {
  const entry = makeEntry('a', DAY, 20, {
    drinkName: 'Negroni', category: 'COCKTAIL', barName: 'The Aviary', alcoholPercentage: 24.5, alcoholVolumeMl: 90,
    notes: 'bitter', isFavourite: true,
  });

  it('shows stored values as the user would have typed them, in LOCAL date and time', () => {
    expect(fieldsFromEntry(entry)).toEqual({
      drinkName: 'Negroni', category: 'COCKTAIL', date: DAY, time: '20:00', barName: 'The Aviary',
      alcoholPercentage: '24.5', alcoholVolumeMl: '90', notes: 'bitter', isFavourite: true,
    });
  });

  it('shows missing numbers as empty text', () => {
    const f = fieldsFromEntry(makeEntry('b', DAY, 8, { alcoholPercentage: null, alcoholVolumeMl: null, category: null }));
    expect(f.alcoholPercentage).toBe('');
    expect(f.alcoholVolumeMl).toBe('');
    expect(f.category).toBeNull();
    expect(f.time).toBe('08:00');
  });

  it('round-trips through buildEntryInput without changing anything the user can see', () => {
    const built = buildEntryInput(fieldsFromEntry(entry), { id: entry.id, existing: entry, now: NOW });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.entry).toEqual(entry);
    }
  });

  it('sameFields is true only when every field matches', () => {
    const base = fieldsFromEntry(entry);
    expect(sameFields(base, { ...base })).toBe(true);
    const changes: Partial<EntryDraftFields>[] = [
      { drinkName: 'x' }, { category: 'BEER' }, { category: null }, { date: '2026-05-08' }, { time: '21:00' },
      { barName: 'x' }, { alcoholPercentage: '1' }, { alcoholVolumeMl: '1' }, { notes: 'x' }, { isFavourite: false },
    ];
    for (const change of changes) expect(sameFields(base, { ...base, ...change })).toBe(false);
  });
});

describe('parseDecimal', () => {
  it('accepts plain numbers, a comma or a point as separator, and half-typed numbers', () => {
    expect(parseDecimal('12')).toEqual({ kind: 'number', value: 12 });
    expect(parseDecimal('12.5')).toEqual({ kind: 'number', value: 12.5 });
    expect(parseDecimal('12,5')).toEqual({ kind: 'number', value: 12.5 });
    expect(parseDecimal('.5')).toEqual({ kind: 'number', value: 0.5 });
    expect(parseDecimal('12.')).toEqual({ kind: 'number', value: 12 });
    expect(parseDecimal('0')).toEqual({ kind: 'number', value: 0 });
    expect(parseDecimal('  7 ')).toEqual({ kind: 'number', value: 7 });
  });

  it('treats blank as empty', () => {
    expect(parseDecimal('')).toEqual({ kind: 'empty' });
    expect(parseDecimal('   ')).toEqual({ kind: 'empty' });
  });

  it('rejects signs, exponents, text and lone separators', () => {
    for (const bad of ['-1', '+5', '1e3', 'abc', '.', ',', '1.2.3', '1,2,3', '12 5', '0x10', 'Infinity', 'NaN']) {
      expect(parseDecimal(bad)).toEqual({ kind: 'invalid' });
    }
  });
});

describe('toDateTimeIso', () => {
  it('turns local date + time into the matching instant', () => {
    expect(toDateTimeIso(DAY, '20:30')).toBe(at(DAY, 20, 30));
    expect(toDateTimeIso('2026-01-01', '00:00')).toBe(at('2026-01-01', 0, 0));
    expect(toDateTimeIso('2026-12-31', '23:59')).toBe(at('2026-12-31', 23, 59));
  });

  it('returns null for malformed input', () => {
    expect(toDateTimeIso('', '20:00')).toBeNull();
    expect(toDateTimeIso(DAY, '')).toBeNull();
    expect(toDateTimeIso('2026-02-31', '20:00')).toBeNull();
    expect(toDateTimeIso(DAY, '24:00')).toBeNull();
    expect(toDateTimeIso(DAY, '20:60')).toBeNull();
    expect(toDateTimeIso(DAY, '7:00')).toBeNull();
    expect(toDateTimeIso(DAY, '20:00:00')).toBeNull();
  });
});

describe('buildEntryInput', () => {
  it('builds a valid new entry: trimmed text, numbers parsed, dayKey from the local day, nothing attached yet', () => {
    const result = buildEntryInput(
      fields({
        drinkName: '  Negroni ', category: 'COCKTAIL', date: DAY, time: '21:15', barName: ' The Aviary  ',
        alcoholPercentage: '24,5', alcoholVolumeMl: '90', notes: '  bitter and bright \n', isFavourite: true,
      }),
      { id: 'new-1', existing: undefined, now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual({
      id: 'new-1', drinkName: 'Negroni', category: 'COCKTAIL', dateTime: at(DAY, 21, 15), dayKey: DAY,
      barName: 'The Aviary', photoId: null, baseSpiritTagIds: [], ingredientTagIds: [],
      alcoholPercentage: 24.5, alcoholVolumeMl: 90, notes: 'bitter and bright', isFavourite: true,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
  });

  it('a name is optional, and so are category and both numbers', () => {
    const result = buildEntryInput(fields({ time: '10:00' }), { id: 'n', existing: undefined, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.drinkName).toBe('');
    expect(result.entry.category).toBeNull();
    expect(result.entry.alcoholPercentage).toBeNull();
    expect(result.entry.alcoholVolumeMl).toBeNull();
  });

  it('an edit carries tag ids, photoId and createdAt through unchanged (the form has no tag picker yet)', () => {
    const existing = makeEntry('a', DAY, 20, {
      baseSpiritTagIds: ['t1', 't2'], ingredientTagIds: ['t3'], photoId: 'p1', createdAt: '2026-01-01T10:00:00.000Z',
    });
    const result = buildEntryInput(fieldsFromEntry(existing), { id: 'a', existing, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.baseSpiritTagIds).toEqual(['t1', 't2']);
    expect(result.entry.ingredientTagIds).toEqual(['t3']);
    expect(result.entry.photoId).toBe('p1');
    expect(result.entry.createdAt).toBe('2026-01-01T10:00:00.000Z');
    expect(result.entry.baseSpiritTagIds).not.toBe(existing.baseSpiritTagIds); // copied, not shared
  });

  it('changing the date or time of an edit changes dateTime and dayKey', () => {
    const existing = makeEntry('a', DAY, 20);
    const result = buildEntryInput({ ...fieldsFromEntry(existing), date: '2026-05-09', time: '07:30' }, { id: 'a', existing, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.dateTime).toBe(at('2026-05-09', 7, 30));
    expect(result.entry.dayKey).toBe('2026-05-09');
  });

  it('reports every problem at once', () => {
    const result = buildEntryInput(
      fields({ date: '', alcoholPercentage: 'abc', alcoholVolumeMl: '-1' }),
      { id: 'n', existing: undefined, now: NOW },
    );
    expect(result.ok).toBe(false);
    expect(problemFields(result)).toEqual(['alcoholPercentage:WRONG_TYPE', 'alcoholVolumeMl:WRONG_TYPE', 'dateTime:REQUIRED']);
  });

  it('an empty date or an empty time is REQUIRED; a malformed one is invalid', () => {
    expect(problemFields(buildEntryInput(fields({ date: '' }), { id: 'n', existing: undefined, now: NOW }))).toEqual(['dateTime:REQUIRED']);
    expect(problemFields(buildEntryInput(fields({ time: '' }), { id: 'n', existing: undefined, now: NOW }))).toEqual(['dateTime:REQUIRED']);
    expect(problemFields(buildEntryInput(fields({ time: '25:00' }), { id: 'n', existing: undefined, now: NOW }))).toEqual(['dateTime:DATE_TIME_INVALID']);
    expect(problemFields(buildEntryInput(fields({ date: '2026-02-31' }), { id: 'n', existing: undefined, now: NOW }))).toEqual(['dateTime:DATE_TIME_INVALID']);
    expect(problemFields(buildEntryInput(fields({ date: '1899-06-15' }), { id: 'n', existing: undefined, now: NOW }))).toEqual(['dateTime:DATE_TIME_INVALID']);
  });

  it('enforces the numeric ranges', () => {
    const build = (patch: Partial<EntryDraftFields>) => problemFields(buildEntryInput(fields(patch), { id: 'n', existing: undefined, now: NOW }));
    expect(build({ alcoholPercentage: '101' })).toEqual(['alcoholPercentage:ABV_RANGE']);
    expect(build({ alcoholPercentage: '100' })).toEqual([]);
    expect(build({ alcoholPercentage: '0' })).toEqual([]);
    expect(build({ alcoholVolumeMl: '0' })).toEqual(['alcoholVolumeMl:VOLUME_RANGE']);
    expect(build({ alcoholVolumeMl: '5001' })).toEqual(['alcoholVolumeMl:VOLUME_RANGE']);
    expect(build({ alcoholVolumeMl: '5000' })).toEqual([]);
    expect(build({ alcoholVolumeMl: '0.5' })).toEqual([]);
  });
});
