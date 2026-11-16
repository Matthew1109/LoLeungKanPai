import { useEffect, useState } from 'react';
import { getEntry } from '../db/entryRepo';
import { getPhotos } from '../db/photoRepo';
import { getTagsByIds } from '../db/tagRepo';
import type { DrinkEntry, Tag } from '../db/schema';
import { useDataVersion } from './useDataVersion';
import { useUrlBag } from './useUrlBag';

export type EntryDetailState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; entry: DrinkEntry; photoUrl: string | null; baseSpirits: Tag[]; ingredients: Tag[] };

const LOADING: EntryDetailState = { status: 'loading' };

/** One entry with its photo and tags. Refetches whenever stored data changes (favourite toggled, edited, deleted). */
export function useEntryDetail(id: string): EntryDetailState {
  const version = useDataVersion();
  const swapUrls = useUrlBag();
  const [loaded, setLoaded] = useState<{ id: string; value: EntryDetailState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entry = await getEntry(id);
      if (!entry) {
        if (!cancelled) setLoaded({ id, value: { status: 'missing' } });
        return;
      }
      const [tags, photos] = await Promise.all([
        getTagsByIds([...entry.baseSpiritTagIds, ...entry.ingredientTagIds]),
        getPhotos(entry.photoId ? [entry.photoId] : []),
      ]);
      if (cancelled) return;

      const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
      const pick = (ids: string[]) => ids.map((tagId) => tagMap.get(tagId)).filter((tag): tag is Tag => Boolean(tag));
      const record = entry.photoId ? photos.get(entry.photoId) : undefined;
      const photoUrl = record ? URL.createObjectURL(record.blob) : null;
      swapUrls(photoUrl ? [photoUrl] : []);
      setLoaded({
        id,
        value: { status: 'ready', entry, photoUrl, baseSpirits: pick(entry.baseSpiritTagIds), ingredients: pick(entry.ingredientTagIds) },
      });
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setLoaded({ id, value: { status: 'error' } });
    });
    return () => {
      cancelled = true;
    };
  }, [id, version, swapUrls]);

  return loaded && loaded.id === id ? loaded.value : LOADING;
}
