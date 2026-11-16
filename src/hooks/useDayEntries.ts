import { useEffect, useState } from 'react';
import { getEntriesForDay } from '../db/entryRepo';
import { getPhotos } from '../db/photoRepo';
import { getTagsByIds } from '../db/tagRepo';
import type { DrinkEntry, Tag } from '../db/schema';
import { useDataVersion } from './useDataVersion';
import { useUrlBag } from './useUrlBag';

export interface DayEntryView {
  entry: DrinkEntry;
  photoUrl: string | null;
  baseSpirits: Tag[];
  ingredients: Tag[];
}

export function useDayEntries(dayKey: string) {
  const version = useDataVersion();
  const swapUrls = useUrlBag();
  const [state, setState] = useState<{ dayKey: string; items: DayEntryView[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await getEntriesForDay(dayKey);
      const tagIds = [...new Set(entries.flatMap((e) => [...e.baseSpiritTagIds, ...e.ingredientTagIds]))];
      const photoIds = entries.map((e) => e.photoId).filter((id): id is string => Boolean(id));
      const [tags, photos] = await Promise.all([getTagsByIds(tagIds), getPhotos(photoIds)]);
      if (cancelled) return;

      const tagMap = new Map(tags.map((t) => [t.id, t]));
      const pick = (ids: string[]) => ids.map((id) => tagMap.get(id)).filter((t): t is Tag => Boolean(t));
      const urls: string[] = [];
      const items = entries.map((entry) => {
        let photoUrl: string | null = null;
        const rec = entry.photoId ? photos.get(entry.photoId) : undefined;
        if (rec) {
          photoUrl = URL.createObjectURL(rec.blob);
          urls.push(photoUrl);
        }
        return { entry, photoUrl, baseSpirits: pick(entry.baseSpiritTagIds), ingredients: pick(entry.ingredientTagIds) };
      });
      swapUrls(urls);
      setState({ dayKey, items });
      setError(null);
    })().catch((e) => {
      if (!cancelled) setError(e);
    });
    return () => {
      cancelled = true;
    };
  }, [dayKey, version, swapUrls]);

  return { items: state && state.dayKey === dayKey ? state.items : null, error };
}
