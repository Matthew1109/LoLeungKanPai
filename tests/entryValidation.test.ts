import { describe, expect, it } from 'vitest';
import { validateEntry, isValidDateTime, ABV_MAX, VOLUME_MAX_ML } from '../src/utils/entryValidation';
import { makeEntry } from './helpers';

const base = () => makeEntry('a', '2026-05-07', 20);
const codes = (v: unknown, opts?: { stamps?: boolean }) => validateEntry(v, opts).map((p) => `${p.field}:${p.code}`);

describe('validateEntry', () => {
  it('accepts a complete valid entry and one with every optional field empty', () => {
    expect(validateEntry(base())).toEqual([]);
    expect(validateEntry({ ...base(), category: null, alcoholPercentage: null, alcoholVolumeMl: null, photoId: null })).toEqual([]);
  });

  it('requires a date-time and rejects unparseable ones', () => {
    expect(codes({ ...base(), dateTime: '' })).toEqual(['dateTime:REQUIRED']);
    expect(codes({ ...base(), dateTime: 'not a date' })).toEqual(['dateTime:DATE_TIME_INVALID']);
    expect(codes({ ...base(), dateTime: '1500-01-01T00:00:00.000Z' })).toEqual(['dateTime:DATE_TIME_INVALID']);
    expect(isValidDateTime('2026-05-07T20:00:00.000Z')).toBe(true);
  });

  it('accepts ABV 0 to 100 inclusive and rejects outside / non-numbers', () => {
    expect(validateEntry({ ...base(), alcoholPercentage: 0 })).toEqual([]);
    expect(validateEntry({ ...base(), alcoholPercentage: ABV_MAX })).toEqual([]);
    expect(codes({ ...base(), alcoholPercentage: -0.1 })).toEqual(['alcoholPercentage:ABV_RANGE']);
    expect(codes({ ...base(), alcoholPercentage: 100.1 })).toEqual(['alcoholPercentage:ABV_RANGE']);
    expect(codes({ ...base(), alcoholPercentage: NaN })).toEqual(['alcoholPercentage:WRONG_TYPE']);
    expect(codes({ ...base(), alcoholPercentage: '5' })).toEqual(['alcoholPercentage:WRONG_TYPE']);
  });

  it('accepts volume > 0 and <= 5000 ml and rejects 0, negatives, too large', () => {
    expect(validateEntry({ ...base(), alcoholVolumeMl: 0.5 })).toEqual([]);
    expect(validateEntry({ ...base(), alcoholVolumeMl: VOLUME_MAX_ML })).toEqual([]);
    expect(codes({ ...base(), alcoholVolumeMl: 0 })).toEqual(['alcoholVolumeMl:VOLUME_RANGE']);
    expect(codes({ ...base(), alcoholVolumeMl: -5 })).toEqual(['alcoholVolumeMl:VOLUME_RANGE']);
    expect(codes({ ...base(), alcoholVolumeMl: 5001 })).toEqual(['alcoholVolumeMl:VOLUME_RANGE']);
    expect(codes({ ...base(), alcoholVolumeMl: Infinity })).toEqual(['alcoholVolumeMl:WRONG_TYPE']);
  });

  it('checks category, field types and reports all problems at once', () => {
    expect(codes({ ...base(), category: 'SODA' })).toEqual(['category:CATEGORY_INVALID']);
    expect(codes({ ...base(), drinkName: 5, baseSpiritTagIds: 'gin', isFavourite: 'yes' })).toEqual([
      'drinkName:WRONG_TYPE',
      'baseSpiritTagIds:WRONG_TYPE',
      'isFavourite:WRONG_TYPE',
    ]);
    expect(codes(null)).toEqual(['entry:WRONG_TYPE']);
  });

  it('with stamps: requires dayKey, createdAt and updatedAt (what a backup entry must carry)', () => {
    expect(validateEntry(base(), { stamps: true })).toEqual([]);
    expect(codes({ ...base(), dayKey: '2026-02-31' }, { stamps: true })).toEqual(['dayKey:WRONG_TYPE']);
    expect(codes({ ...base(), createdAt: undefined, updatedAt: 'x' }, { stamps: true })).toEqual(['createdAt:WRONG_TYPE', 'updatedAt:WRONG_TYPE']);
  });
});
