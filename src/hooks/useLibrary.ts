import { useEffect, useState } from 'react';
import { getAllEntries } from '../db/entryRepo';
import { getThumbs } from '../db/photoRepo';
import { listTags } from '../db/tagRepo';
import type { DrinkEntry, Tag } from '../db/schema';
import { newestFirst } from '../utils/entrySort';
import { useDataVersion } from './useDataVersion';
import { useUrlBag } from './useUrlBag';

/** The whole journal as the gallery, the collections and the search see it. */
export interface Library {
  /** Every drink, newest first. */
  entries: DrinkEntry[];
  /** Every tag (archived ones too), by id. */
  tags: Map<string, Tag>;
  /** Photo id -> object URL of its small thumbnail (full-size photographs are never read here). */
  thumbs: Map<string, string>;
}

/**
 * Loads all drinks, tags and thumbnails, and again whenever stored data changes. `library` stays the previous value
 * while a refresh is running, so lists never flash empty. Filtering and searching happen in memory (personal-journal
 * scale); thumbnails are blob handles and the browser decodes only the images near the screen.
 */
export function useLibrary(): { library: Library | null; failed: boolean } {
  const version = useDataVersion();
  const swapUrls = useUrlBag();
  const [library, setLibrary] = useState<Library | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [entries, spirits, ingredients] = await Promise.all([
        getAllEntries(),
        listTags('BASE_SPIRIT', { includeArchived: true }),
        listTags('INGREDIENT', { includeArchived: true }),
      ]);
      const photoIds = entries.map((entry) => entry.photoId).filter((id): id is string => Boolean(id));
      const blobs = await getThumbs(photoIds);
      if (cancelled) return;

      const urls: string[] = [];
      const thumbs = new Map<string, string>();
      for (const [id, blob] of blobs) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        thumbs.set(id, url);
      }
      swapUrls(urls);
      setLibrary({
        entries: newestFirst(entries),
        tags: new Map([...spirits, ...ingredients].map((tag): [string, Tag] => [tag.id, tag])),
        thumbs,
      });
      setFailed(false);
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [version, swapUrls]);

  return { library, failed };
}
