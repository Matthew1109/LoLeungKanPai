import { getDb } from './index';
import { META_KEYS } from './metaRecords';
import { parseEntryDraft, type EntryDraft } from './entryDraft';

/**
 * Draft of the Add/Edit form (decision E5). One draft at a time, in `meta`. A draft is also removed inside the
 * transaction of saveEntry/deleteEntry for the same entry id, so it cannot outlive the save it belongs to.
 */
export async function getEntryDraft(): Promise<EntryDraft | undefined> {
  const db = await getDb();
  return parseEntryDraft((await db.get('meta', META_KEYS.entryDraft))?.value);
}

export async function saveEntryDraft(draft: EntryDraft): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key: META_KEYS.entryDraft, value: draft });
}

export async function clearEntryDraft(): Promise<void> {
  const db = await getDb();
  await db.delete('meta', META_KEYS.entryDraft);
}

/**
 * Removes the stored draft only if it belongs to `entryId`. A form that never wrote a draft (or whose draft was
 * since replaced by another form's) must not delete somebody else's.
 */
export async function clearEntryDraftFor(entryId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('meta', 'readwrite');
  const stored = parseEntryDraft((await tx.store.get(META_KEYS.entryDraft))?.value);
  if (stored && stored.entryId === entryId) await tx.store.delete(META_KEYS.entryDraft);
  await tx.done;
}
