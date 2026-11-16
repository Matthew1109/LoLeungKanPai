import { getDb } from '../db';
import { takeSnapshot } from '../db/backupRepo';
import { DB_VERSION } from '../db/schema';
import { toDayKey } from '../utils/dates';
import { BACKUP_APP, BACKUP_FORMAT_VERSION, photoFileName, type BackupData, type BackupManifest } from './backupFormat';
import { ZipWriter } from './zip';

/** An entry's photo vanished while the file was being built: the journal changed under us. Nothing was written. */
export class JournalChangedError extends Error {
  constructor() {
    super('The journal changed while the backup was being made');
    this.name = 'JournalChangedError';
  }
}

export interface CreatedBackup {
  blob: Blob;
  fileName: string;
  /** The instant the backup stands for; pass it to recordBackupMade once the file has been handed over. */
  snapshotAt: string;
  counts: BackupManifest['counts'];
}

export const backupFileName = (d: Date): string => `LoLeungKanPai-backup-${toDayKey(d)}.zip`;

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

/**
 * Builds the backup in memory-bounded steps: entries, tags and bars are snapshotted in one read, then photos are read one
 * at a time. Thumbnails are not exported (they are regenerated on restore). Does not touch the journal.
 */
export async function createBackup(
  appVersion: string,
  onProgress?: (done: number, total: number) => void | Promise<void>,
  now: Date = new Date(),
): Promise<CreatedBackup> {
  const snapshot = await takeSnapshot();
  const photoIds = [...new Set(snapshot.entries.flatMap((e) => (e.photoId ? [e.photoId] : [])))];
  const times = snapshot.entries.map((e) => e.dateTime).sort();
  const counts = { entries: snapshot.entries.length, tags: snapshot.tags.length, photos: photoIds.length };
  const db = await getDb();

  // Photos go in first, one at a time (data.json needs their metadata). Readers use the ZIP directory, so the
  // order of files inside the archive does not matter.
  const zip = new ZipWriter(now);
  const photoMeta: BackupData['photos'] = [];
  for (let i = 0; i < photoIds.length; i++) {
    const record = await db.get('photos', photoIds[i]);
    if (!record) throw new JournalChangedError();
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    photoMeta.push({ id: record.id, mime: 'image/jpeg', size: bytes.length, width: record.width, height: record.height, createdAt: record.createdAt });
    zip.add(photoFileName(record.id), bytes);
    await onProgress?.(i + 1, photoIds.length);
  }

  const manifest: BackupManifest = {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    dbSchemaVersion: DB_VERSION,
    appVersion,
    createdAt: snapshot.at,
    counts,
    dateRange: { first: times[0] ?? null, last: times[times.length - 1] ?? null },
  };
  const data: BackupData = { entries: snapshot.entries, tags: snapshot.tags, bars: snapshot.bars, photos: photoMeta };
  zip.add('data.json', json(data));
  zip.add('manifest.json', json(manifest));
  return { blob: zip.finish(), fileName: backupFileName(now), snapshotAt: snapshot.at, counts };
}
