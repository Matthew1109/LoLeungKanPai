import type { DBSchema } from 'idb';

export type TagCategory = 'BASE_SPIRIT' | 'INGREDIENT';

export const DRINK_CATEGORIES = ['COCKTAIL', 'BEER', 'WINE', 'WHISKY', 'OTHER_SPIRITS', 'OTHER'] as const;
export type DrinkCategory = (typeof DRINK_CATEGORIES)[number];

export interface DrinkEntry {
  id: string;
  drinkName: string;
  category: DrinkCategory | null;
  /** ISO 8601 (UTC) instant of the drink. */
  dateTime: string;
  /** Local calendar day (YYYY-MM-DD) derived from dateTime when saved. Used by the calendar index. */
  dayKey: string;
  barName: string;
  /** Reference to photos/thumbs records; null when the entry has no photograph. */
  photoId: string | null;
  baseSpiritTagIds: string[];
  ingredientTagIds: string[];
  alcoholPercentage: number | null;
  /** Volume in millilitres (decision D8). */
  alcoholVolumeMl: number | null;
  notes: string;
  isFavourite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  /** Lower-cased, whitespace-collapsed name. Unique together with category. */
  nameKey: string;
  category: TagCategory;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Full-size, optimised photograph (long edge <= 1600 px). Kept apart from thumbnails so lists never touch it. */
export interface PhotoRecord {
  id: string;
  blob: Blob;
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
}

/** Square 480 px thumbnail used by the calendar and gallery. Same id as its photo. */
export interface ThumbRecord {
  id: string;
  blob: Blob;
}

/**
 * RESERVED, UNUSED. Manual calendar-cover selection was dropped from scope (owner decision): the cover is always the
 * earliest photographed entry of the day, derived on the fly (see utils/cover.ts). The store stays in schema v1 so
 * no migration is needed; nothing reads or writes it.
 */
export interface DayCover {
  dayKey: string;
  entryId: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface LkpDB extends DBSchema {
  entries: {
    key: string;
    value: DrinkEntry;
    indexes: {
      dayKey: string;
      dateTime: string;
      createdAt: string;
      photoId: string;
      baseSpiritTagIds: string; // multiEntry
      ingredientTagIds: string; // multiEntry
    };
  };
  tags: {
    key: string;
    value: Tag;
    indexes: { categoryNameKey: [string, string]; category: string };
  };
  photos: { key: string; value: PhotoRecord };
  thumbs: { key: string; value: ThumbRecord };
  dayCovers: { key: string; value: DayCover };
  meta: { key: string; value: MetaRecord };
}

export const DB_NAME = 'loleungkanpai';
export const DB_VERSION = 1;
