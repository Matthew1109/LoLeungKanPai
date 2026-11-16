import { BACKUP_APP, BACKUP_FORMAT_VERSION, photoFileName, type BackupData, type BackupManifest } from '../src/backup/backupFormat';
import { ZipWriter } from '../src/backup/zip';
import { getDb } from '../src/db';
import { saveEntry } from '../src/db/entryRepo';
import { DB_VERSION, type DrinkEntry, type PhotoRecord, type Tag } from '../src/db/schema';
import { at, makeEntry } from './helpers';

/** Bytes that look like a JPEG to the backup reader (the real decode is injected in restore tests). */
export function jpegBytes(label: string, extra = 40): Uint8Array {
  const text = new TextEncoder().encode(`jpeg:${label}:`);
  const out = new Uint8Array(4 + text.length + extra);
  out.set([0xff, 0xd8, 0xff, 0xe0], 0);
  out.set(text, 4);
  for (let i = 0; i < extra; i++) out[4 + text.length + i] = (i * 31 + label.length) & 0xff;
  return out;
}

export interface BackupParts {
  manifest: BackupManifest;
  data: BackupData;
  photos: Record<string, Uint8Array>;
}

export const tag = (id: string, name: string, category: Tag['category'], patch: Partial<Tag> = {}): Tag => ({
  id, name, nameKey: name.toLowerCase(), category, isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...patch,
});

/** A small, valid backup: 3 entries (two with photos), 3 tags (one archived), photo ids p1 and p2. */
export function sampleParts(): BackupParts {
  const entries: DrinkEntry[] = [
    makeEntry('e1', '2026-05-01', 20, { drinkName: 'Negroni — 好 🍸', photoId: 'p1', baseSpiritTagIds: ['t-gin'], ingredientTagIds: ['t-lime'], isFavourite: true, notes: 'a\nb' }),
    makeEntry('e2', '2026-05-02', 21, { drinkName: 'Old Fashioned', category: 'COCKTAIL', photoId: 'p2', alcoholPercentage: 32.5, alcoholVolumeMl: 60 }),
    makeEntry('e3', '2026-05-03', 22, { drinkName: 'Pilsner', category: null, barName: 'Pub', baseSpiritTagIds: ['t-old'] }),
  ];
  const tags: Tag[] = [tag('t-gin', 'Gin', 'BASE_SPIRIT'), tag('t-old', 'Old tag', 'BASE_SPIRIT', { isArchived: true }), tag('t-lime', 'Lime', 'INGREDIENT')];
  const photos = { p1: jpegBytes('p1'), p2: jpegBytes('p2', 5000) };
  const data: BackupData = {
    entries, tags,
    photos: Object.entries(photos).map(([id, bytes]) => ({ id, mime: 'image/jpeg', size: bytes.length, width: 40, height: 30, createdAt: at('2026-05-01', 20) })),
  };
  const manifest: BackupManifest = {
    app: BACKUP_APP, formatVersion: BACKUP_FORMAT_VERSION, dbSchemaVersion: DB_VERSION, appVersion: 'test',
    createdAt: '2026-05-10T09:00:00.000Z',
    counts: { entries: entries.length, tags: tags.length, photos: Object.keys(photos).length },
    dateRange: { first: entries[0].dateTime, last: entries[2].dateTime },
  };
  return { manifest, data, photos };
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

export interface BackupOptions {
  rawManifest?: Uint8Array;
  rawData?: Uint8Array;
  omit?: string[];
  extra?: Record<string, Uint8Array>;
  /** Prepended to every name (a backup re-zipped inside a folder). */
  folder?: string;
}

/** Builds a backup ZIP from parts, with knobs to break it. */
export function backupBlob(parts: BackupParts, options: BackupOptions = {}): Blob {
  const zip = new ZipWriter();
  const folder = options.folder ?? '';
  const files: Array<[string, Uint8Array]> = [];
  for (const [id, bytes] of Object.entries(parts.photos)) files.push([photoFileName(id), bytes]);
  files.push(['data.json', options.rawData ?? json(parts.data)]);
  files.push(['manifest.json', options.rawManifest ?? json(parts.manifest)]);
  for (const [name, bytes] of Object.entries(options.extra ?? {})) files.push([name, bytes]);
  for (const [name, bytes] of files) if (!(options.omit ?? []).includes(name)) zip.add(folder + name, bytes);
  return zip.finish();
}

export const cloneParts = (parts: BackupParts): BackupParts => ({
  manifest: structuredClone(parts.manifest),
  data: structuredClone(parts.data),
  photos: { ...parts.photos },
});

/** A stored photo whose bytes pass the backup reader's JPEG check. */
export function jpegPhoto(id: string, extra = 40): { record: PhotoRecord; thumb: Blob } {
  const blob = new Blob([jpegBytes(id, extra)], { type: 'image/jpeg' });
  return {
    record: { id, blob, mime: 'image/jpeg', size: blob.size, width: 40, height: 30, createdAt: '2026-05-01T20:00:00.000Z' },
    thumb: new Blob([`thumb-${id}`], { type: 'image/jpeg' }),
  };
}

/** Puts the sample journal (tags, 3 entries, photos p1 and p2) into the database through the real repositories. */
export async function seedSampleJournal(): Promise<void> {
  const db = await getDb();
  for (const t of sampleParts().data.tags) await db.put('tags', t);
  const { entries } = sampleParts().data;
  await saveEntry(entries[0], { kind: 'replace', ...jpegPhoto('p1') });
  await saveEntry(entries[1], { kind: 'replace', ...jpegPhoto('p2', 5000) });
  await saveEntry(entries[2]);
}
