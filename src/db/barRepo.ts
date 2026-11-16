import { getDb } from './index';
import { notifyDataChanged } from './changeSignal';
import { normaliseBackupState, withEntryChanged } from './backupReminder';
import { BarError, RestoreInProgressError } from './errors';
import { retryAfterAbandonedRestore } from './maintenance';
import { META_KEYS, restoreSessionExists } from './metaRecords';
import type { Bar } from './schema';
import { runBarTx, type BarTx } from './tx';
import { missingBars, tidyBarName } from '../utils/bars';
import { newId } from '../utils/id';
import { nameKey } from '../utils/normalise';

/**
 * The reusable Bar library. A drink keeps its bar as plain text (`barName`) and belongs to the bar whose nameKey
 * equals nameKey(barName); this file never changes that text except in renameBar, which moves every drink of the
 * bar to the new name in the same transaction. There is no delete: a bar that is no longer wanted is archived.
 */

export const BAR_NAME_MAX = 60;

/** A bar with the number of drinks that name it (archived bars included: they stay on their drinks). */
export interface BarWithCount extends Bar {
  entryCount: number;
}

const byName = (a: Bar, b: Bar): number => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** Trims and collapses inner whitespace; the user's capitalisation is kept. Throws BarError EMPTY / TOO_LONG. */
export function cleanBarName(raw: string): string {
  const name = tidyBarName(raw);
  if (name.length === 0) throw new BarError('EMPTY');
  if ([...name].length > BAR_NAME_MAX) throw new BarError('TOO_LONG');
  return name;
}

/** Bars A to Z. Archived ones only on request (the drink form's suggestions never show them). */
export async function listBars(opts: { includeArchived?: boolean } = {}): Promise<Bar[]> {
  const db = await getDb();
  const all = await db.getAll('bars');
  return all.filter((bar) => opts.includeArchived || !bar.isArchived).sort(byName);
}

/** Every bar, archived included, with how many drinks name it. One consistent read. Sorted A to Z. */
export async function listBarsWithCounts(): Promise<BarWithCount[]> {
  const db = await getDb();
  const tx = db.transaction(['bars', 'entries'], 'readonly');
  const [bars, entries] = await Promise.all([tx.objectStore('bars').getAll(), tx.objectStore('entries').getAll()]);
  await tx.done;
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = nameKey(entry.barName);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return bars.sort(byName).map((bar) => ({ ...bar, entryCount: counts.get(bar.nameKey) ?? 0 }));
}

/** Like entry and tag writes, bar edits are refused while a restore-session record exists (checked inside the transaction). */
async function assertNoRestoreSession(tx: BarTx): Promise<void> {
  const record = await tx.objectStore('meta').get(META_KEYS.restoreSession);
  if (restoreSessionExists(record)) throw new RestoreInProgressError();
}

/** One committed bar transaction (with the abandoned-restore retry the entry writes use), then tell open screens. */
async function writeBars<T>(work: (tx: BarTx) => Promise<T>): Promise<T> {
  const value = await retryAfterAbandonedRestore(() =>
    runBarTx(async (tx) => {
      await assertNoRestoreSession(tx);
      return work(tx);
    }),
  );
  notifyDataChanged();
  return value;
}

const findByKey = (tx: BarTx, key: string) => tx.objectStore('bars').index('nameKey').get(key);

/** Adds a bar. Throws BarError DUPLICATE when a bar already has that name (any capitalisation or spacing, archived or not). */
export async function createBar(rawName: string): Promise<Bar> {
  const name = cleanBarName(rawName);
  const key = nameKey(name);
  return writeBars(async (tx) => {
    if (await findByKey(tx, key)) throw new BarError('DUPLICATE');
    const now = new Date().toISOString();
    const bar: Bar = { id: newId(), name, nameKey: key, isArchived: false, createdAt: now, updatedAt: now };
    await tx.objectStore('bars').add(bar);
    return bar;
  });
}

/**
 * Renames a bar (DUPLICATE when another bar has the name; changing only the capitalisation is fine). Drinks link to
 * a bar by its name, so in the SAME transaction every drink at the old name is moved to the new one: its `barName`
 * and `updatedAt` change, and it counts as changed for the backup reminder. All or nothing.
 */
export async function renameBar(id: string, rawName: string): Promise<Bar> {
  const name = cleanBarName(rawName);
  const key = nameKey(name);
  return writeBars(async (tx) => {
    const bars = tx.objectStore('bars');
    const bar = await bars.get(id);
    if (!bar) throw new BarError('NOT_FOUND');
    const clash = await findByKey(tx, key);
    if (clash && clash.id !== id) throw new BarError('DUPLICATE');

    const stamp = new Date().toISOString();
    const renamed: Bar = { ...bar, name, nameKey: key, updatedAt: stamp };
    await bars.put(renamed);

    const entries = tx.objectStore('entries');
    const meta = tx.objectStore('meta');
    let state = normaliseBackupState((await meta.get(META_KEYS.backupState))?.value);
    let moved = 0;
    for (const entry of await entries.getAll()) {
      if (nameKey(entry.barName) !== bar.nameKey || entry.barName === name) continue;
      await entries.put({ ...entry, barName: name, updatedAt: stamp });
      state = withEntryChanged(state, entry.id, stamp);
      moved++;
    }
    if (moved > 0) await meta.put({ key: META_KEYS.backupState, value: state });
    return renamed;
  });
}

/** Archived bars are no longer suggested for new drinks but stay on the drinks that already have them. */
export async function setBarArchived(id: string, archived: boolean): Promise<Bar> {
  return writeBars(async (tx) => {
    const bar = await tx.objectStore('bars').get(id);
    if (!bar) throw new BarError('NOT_FOUND');
    if (bar.isArchived === archived) return bar;
    const next: Bar = { ...bar, isArchived: archived, updatedAt: new Date().toISOString() };
    await tx.objectStore('bars').put(next);
    return next;
  });
}

/**
 * Start-up: adds a bar for every bar name the existing drinks already use (this is how the library fills itself the
 * first time after the update, and after a restore of an older backup). Only ever ADDS bars: drinks are not touched,
 * names are matched with nameKey, so each bar appears once. Returns how many bars were added.
 */
export async function syncBarsFromEntries(): Promise<number> {
  const added = await runBarTx(async (tx) => {
    const bars = tx.objectStore('bars');
    const known = new Set((await bars.getAll()).map((bar) => bar.nameKey));
    const missing = missingBars(await tx.objectStore('entries').getAll(), known, newId, new Date().toISOString());
    for (const bar of missing) await bars.add(bar);
    return missing.length;
  });
  if (added > 0) notifyDataChanged();
  return added;
}
