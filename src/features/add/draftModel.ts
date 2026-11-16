import type { DrinkEntry } from '../../db/schema';
import type { EntryDraft, EntryDraftFields } from '../../db/entryDraft';

/** Pure decisions about the form draft (decision E5). */

export type DraftDecision = { kind: 'none' } | { kind: 'discard' } | { kind: 'offer'; draft: EntryDraft };

/**
 * Opening /add. A draft is never applied silently: usable ones are offered. An edit draft is only usable while its
 * entry still exists with the updatedAt the form had when it opened (`storedUpdatedAt`, undefined = entry gone).
 */
export function decideDraftForAdd(draft: EntryDraft | undefined, storedUpdatedAt: string | undefined): DraftDecision {
  if (!draft) return { kind: 'none' };
  if (draft.mode === 'new') return { kind: 'offer', draft };
  if (storedUpdatedAt === undefined || draft.baseUpdatedAt !== storedUpdatedAt) return { kind: 'discard' };
  return { kind: 'offer', draft };
}

/** Opening the edit form of `entry`. Drafts of other entries are not ours to judge or delete. */
export function decideDraftForEdit(draft: EntryDraft | undefined, entry: DrinkEntry): DraftDecision {
  if (!draft || draft.entryId !== entry.id) return { kind: 'none' };
  if (draft.mode !== 'edit' || draft.baseUpdatedAt !== entry.updatedAt) return { kind: 'discard' };
  return { kind: 'offer', draft };
}

export function makeDraft(args: {
  entryId: string;
  mode: 'new' | 'edit';
  baseUpdatedAt: string | null;
  fields: EntryDraftFields;
  now: Date;
}): EntryDraft {
  return {
    entryId: args.entryId,
    mode: args.mode,
    baseUpdatedAt: args.baseUpdatedAt,
    savedAt: args.now.toISOString(),
    fields: { ...args.fields },
  };
}

/** Human date for "draft from ...". Empty string when the stored stamp is unusable (Intl would throw). */
export function formatDraftTime(iso: string, locale: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}
