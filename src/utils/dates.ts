/** Local calendar-day helpers. A "dayKey" is a local-date string: YYYY-MM-DD. Month is 0-based like JS Date. */
export type DayKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return toDayKey(parseDayKey(key)) === key; // rejects 2026-02-31 etc.
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Inclusive first/last dayKey of a month, for IndexedDB range queries. */
export function monthBounds(year: number, month: number): { start: DayKey; end: DayKey } {
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(daysInMonth(year, month))}`,
  };
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${pad(month + 1)}`;
}

export function parseMonthParam(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year: Number(m[1]), month };
}

/**
 * First day of the week for the device locale, as a JS weekday (0 = Sunday ... 6 = Saturday).
 * Uses Intl.Locale week info where the browser provides it (Safari support is partial).
 * Fallback (decision D11): Monday for Hong Kong, otherwise Sunday.
 */
export function getWeekStart(locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en'): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (info && typeof info.firstDay === 'number') return info.firstDay % 7; // ISO 1..7 (7 = Sunday) -> 0..6
  } catch {
    /* fall through to the fallback */
  }
  return fallbackWeekStart(locale);
}

export function fallbackWeekStart(locale: string): number {
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).region;
  } catch {
    /* ignore */
  }
  if (!region && /[-_]HK\b/i.test(locale)) region = 'HK';
  return region?.toUpperCase() === 'HK' ? 1 : 0;
}

/** Cells for a month grid: leading/trailing nulls pad to whole weeks. */
export function buildMonthGrid(year: number, month: number, weekStart: number): (DayKey | null)[] {
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  const total = daysInMonth(year, month);
  const cells: (DayKey | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= total; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Weekday indices (0 = Sunday) in display order. */
export function weekdayOrder(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}
