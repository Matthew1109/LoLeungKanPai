import { useEffect, useState } from 'react';
import { getEntriesInRange } from '../db/entryRepo';
import { getThumbs } from '../db/photoRepo';
import { monthBounds, formatMonthParam, type DayKey } from '../utils/dates';
import { resolveCoverEntry } from '../utils/cover';
import { useDataVersion } from './useDataVersion';
import { useUrlBag } from './useUrlBag';
import type { DrinkEntry } from '../db/schema';

export interface DayInfo {
  count: number;
  /** Object URL of the cover thumbnail; null => entries exist but none has a photograph. */
  coverUrl: string | null;
}

/** Calendar data for one month, derived from entries (there is no CalendarDay table). */
export function useMonthData(year: number, month: number) {
  const version = useDataVersion();
  const swapUrls = useUrlBag();
  const monthKey = formatMonthParam(year, month);
  const [state, setState] = useState<{ monthKey: string; days: Map<DayKey, DayInfo> } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { start, end } = monthBounds(year, month);
      const entries = await getEntriesInRange(start, end);
      const byDay = new Map<DayKey, DrinkEntry[]>();
      for (const e of entries) byDay.set(e.dayKey, [...(byDay.get(e.dayKey) ?? []), e]);

      const coverByDay = new Map<DayKey, DrinkEntry | undefined>();
      const photoIds: string[] = [];
      for (const [day, list] of byDay) {
        const cover = resolveCoverEntry(list);
        coverByDay.set(day, cover);
        if (cover?.photoId) photoIds.push(cover.photoId);
      }
      const thumbs = await getThumbs(photoIds);
      if (cancelled) return;

      const urls: string[] = [];
      const days = new Map<DayKey, DayInfo>();
      for (const [day, list] of byDay) {
        const pid = coverByDay.get(day)?.photoId;
        const blob = pid ? thumbs.get(pid) : undefined;
        let coverUrl: string | null = null;
        if (blob) {
          coverUrl = URL.createObjectURL(blob);
          urls.push(coverUrl);
        }
        days.set(day, { count: list.length, coverUrl });
      }
      swapUrls(urls);
      setState({ monthKey, days });
      setError(null);
    })().catch((e) => {
      if (!cancelled) setError(e);
    });
    return () => {
      cancelled = true;
    };
  }, [year, month, monthKey, version, swapUrls]);

  return { days: state && state.monthKey === monthKey ? state.days : null, error };
}
