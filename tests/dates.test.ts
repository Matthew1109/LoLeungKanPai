import { describe, expect, it } from 'vitest';
import {
  addMonths, buildMonthGrid, fallbackWeekStart, isValidDayKey, monthBounds, parseDayKey, parseMonthParam, toDayKey, weekdayOrder,
} from '../src/utils/dates';

describe('dayKey', () => {
  it('round-trips local dates', () => {
    expect(toDayKey(new Date(2026, 4, 9, 23, 59))).toBe('2026-05-09');
    expect(toDayKey(parseDayKey('2026-01-31'))).toBe('2026-01-31');
  });
  it('rejects impossible dates', () => {
    expect(isValidDayKey('2026-02-30')).toBe(false);
    expect(isValidDayKey('2026-13-01')).toBe(false);
    expect(isValidDayKey('hello')).toBe(false);
    expect(isValidDayKey('2028-02-29')).toBe(true);
  });
});

describe('months', () => {
  it('adds months across year boundaries', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths(2026, 5, -17)).toEqual({ year: 2025, month: 0 });
  });
  it('gives inclusive bounds', () => {
    expect(monthBounds(2026, 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthBounds(2028, 1).end).toBe('2028-02-29');
  });
  it('parses the month URL param', () => {
    expect(parseMonthParam('2026-05')).toEqual({ year: 2026, month: 4 });
    expect(parseMonthParam('2026-13')).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });
});

describe('month grid', () => {
  // May 2026 starts on a Friday.
  it('aligns to a Sunday week start', () => {
    const g = buildMonthGrid(2026, 4, 0);
    expect(g.indexOf('2026-05-01')).toBe(5);
    expect(g.length % 7).toBe(0);
    expect(g.filter(Boolean)).toHaveLength(31);
  });
  it('aligns to a Monday week start', () => {
    const g = buildMonthGrid(2026, 4, 1);
    expect(g.indexOf('2026-05-01')).toBe(4);
  });
  it('needs no leading blanks when the month starts on the week start', () => {
    // Feb 2026 starts on a Sunday and has 28 days: exactly four rows.
    const g = buildMonthGrid(2026, 1, 0);
    expect(g[0]).toBe('2026-02-01');
    expect(g).toHaveLength(28);
  });
  it('orders weekdays from the week start', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('week start fallback', () => {
  it('is Monday for Hong Kong, Sunday otherwise', () => {
    expect(fallbackWeekStart('zh-HK')).toBe(1);
    expect(fallbackWeekStart('en-HK')).toBe(1);
    expect(fallbackWeekStart('en-US')).toBe(0);
    expect(fallbackWeekStart('en')).toBe(0);
  });
});
