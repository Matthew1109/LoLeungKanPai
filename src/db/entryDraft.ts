import { DRINK_CATEGORIES, type DrinkCategory } from './schema';

/** Text-field state of the Add/Edit form, exactly as typed (numbers stay strings until Save). Photos are not drafted. */
export interface EntryDraftFields {
  drinkName: string;
  category: DrinkCategory | null;
  /** YYYY-MM-DD, local */
  date: string;
  /** HH:mm, local */
  time: string;
  barName: string;
  alcoholPercentage: string;
  alcoholVolumeMl: string;
  notes: string;
  isFavourite: boolean;
}

export interface EntryDraft {
  /** The entry this draft belongs to: the id reserved for a NEW entry, or the id of the entry being edited. */
  entryId: string;
  mode: 'new' | 'edit';
  /** Edit drafts: the entry's updatedAt when the form opened. If the entry changed since, the draft is stale. */
  baseUpdatedAt: string | null;
  savedAt: string;
  fields: EntryDraftFields;
}

/** Strict, defensive read of a stored draft. Anything malformed is treated as "no draft". */
export function parseEntryDraft(raw: unknown): EntryDraft | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const d = raw as Record<string, unknown>;
  if (typeof d.entryId !== 'string' || d.entryId.length === 0) return undefined;
  if (d.mode !== 'new' && d.mode !== 'edit') return undefined;
  if (d.baseUpdatedAt !== null && typeof d.baseUpdatedAt !== 'string') return undefined;
  if (typeof d.savedAt !== 'string') return undefined;
  if (typeof d.fields !== 'object' || d.fields === null) return undefined;
  const f = d.fields as Record<string, unknown>;

  const category = f.category;
  const categoryOk = category === null || (typeof category === 'string' && (DRINK_CATEGORIES as readonly string[]).includes(category));
  if (!categoryOk) return undefined;
  for (const key of ['drinkName', 'date', 'time', 'barName', 'alcoholPercentage', 'alcoholVolumeMl', 'notes'] as const) {
    if (typeof f[key] !== 'string') return undefined;
  }
  if (typeof f.isFavourite !== 'boolean') return undefined;

  return {
    entryId: d.entryId as string,
    mode: d.mode as 'new' | 'edit',
    baseUpdatedAt: d.baseUpdatedAt as string | null,
    savedAt: d.savedAt as string,
    fields: {
      drinkName: f.drinkName as string,
      category: category as DrinkCategory | null,
      date: f.date as string,
      time: f.time as string,
      barName: f.barName as string,
      alcoholPercentage: f.alcoholPercentage as string,
      alcoholVolumeMl: f.alcoholVolumeMl as string,
      notes: f.notes as string,
      isFavourite: f.isFavourite as boolean,
    },
  };
}
