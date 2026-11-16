import { describe, expect, it } from 'vitest';
import { BackupFormatError, listBackupFiles, openBackup, type BackupErrorCode } from '../src/backup/backupFormat';
import { ZipReader, ZipWriter } from '../src/backup/zip';
import { FLAT_BACKUP_BASE64, PYTHON_JPEG_LENGTH, WRAPPED_BACKUP_BASE64, fromBase64 } from './fixtures/pythonZips';
import { backupBlob, cloneParts, jpegBytes, sampleParts, tag, type BackupParts } from './backupHelpers';
import { makeEntry } from './helpers';

async function expectBackupError(blob: Blob, code: BackupErrorCode): Promise<void> {
  try {
    await openBackup(blob);
  } catch (err) {
    expect(err).toBeInstanceOf(BackupFormatError);
    expect((err as BackupFormatError).code).toBe(code);
    return;
  }
  throw new Error(`expected BackupFormatError ${code}, but the backup was accepted`);
}

/** Opens a backup built from sample parts after `edit` changed them. */
async function expectInvalid(edit: (p: BackupParts) => void, code: BackupErrorCode = 'INVALID'): Promise<void> {
  const parts = cloneParts(sampleParts());
  edit(parts);
  await expectBackupError(backupBlob(parts), code);
}

describe('openBackup: valid backups', () => {
  it('opens a backup made by this app and verifies every photo', async () => {
    const parts = sampleParts();
    const seen: Array<[number, number]> = [];
    const opened = await openBackup(backupBlob(parts), (done, total) => seen.push([done, total]));
    expect(opened.data.entries).toEqual(parts.data.entries);
    expect(opened.data.tags).toEqual(parts.data.tags);
    expect(opened.manifest.counts).toEqual({ entries: 3, tags: 3, photos: 2 });
    expect(seen).toEqual([[1, 2], [2, 2]]);
    expect(opened.photoBytes).toBe(parts.photos.p1.length + parts.photos.p2.length);
    expect(await opened.readPhoto('p2')).toEqual(parts.photos.p2);
  });

  it('opens a backup of an empty journal', async () => {
    const parts = sampleParts();
    parts.data = { entries: [], tags: [], photos: [] };
    parts.photos = {};
    parts.manifest.counts = { entries: 0, tags: 0, photos: 0 };
    parts.manifest.dateRange = { first: null, last: null };
    const opened = await openBackup(backupBlob(parts));
    expect(opened.data.entries).toEqual([]);
    expect(opened.photoBytes).toBe(0);
  });

  it('reads a backup re-zipped by another tool (deflated, data descriptors), Unicode intact', async () => {
    const opened = await openBackup(new Blob([fromBase64(FLAT_BACKUP_BASE64)]));
    expect(opened.data.entries).toHaveLength(1);
    expect(opened.data.entries[0].drinkName).toBe('Negroní — 好 🍸');
    expect(opened.data.entries[0].notes).toBe('line 1\nline 2');
    expect(opened.data.tags[0].name).toBe('Gin');
    expect((await opened.readPhoto('p1')).length).toBe(PYTHON_JPEG_LENGTH);
  });

  it('reads a backup inside a wrapping folder next to Finder junk (__MACOSX, .DS_Store)', async () => {
    const opened = await openBackup(new Blob([fromBase64(WRAPPED_BACKUP_BASE64)]));
    expect(opened.data.entries[0].id).toBe('e1');
    expect((await opened.readPhoto('p1')).length).toBe(PYTHON_JPEG_LENGTH);
  });

  it('reads this app\'s own backup inside a wrapping folder too', async () => {
    const opened = await openBackup(backupBlob(sampleParts(), { folder: 'My backup/' }));
    expect(opened.data.entries).toHaveLength(3);
  });

  it('ignores a photo no entry uses, even if its file is missing', async () => {
    const parts = cloneParts(sampleParts());
    parts.data.photos.push({ id: 'unused', mime: 'image/jpeg', size: 1, width: 1, height: 1, createdAt: '2026-05-01T00:00:00.000Z' });
    parts.manifest.counts.photos = 3;
    const opened = await openBackup(backupBlob(parts));
    expect(opened.photoBytes).toBe(parts.photos.p1.length + parts.photos.p2.length);
  });
});

describe('listBackupFiles', () => {
  const entry = (name: string) => ({ name, method: 0, crc: 0, compressedSize: 0, size: 0, localOffset: 0 });
  const names = (list: string[]) => [...listBackupFiles(list.map(entry)).keys()];

  it('keeps names as they are when manifest.json is at the top', () => {
    expect(names(['manifest.json', 'data.json', 'photos/a.jpg'])).toEqual(['manifest.json', 'data.json', 'photos/a.jpg']);
  });
  it('strips exactly one wrapping folder and drops directory entries and junk', () => {
    expect(names(['B/', 'B/manifest.json', 'B/data.json', 'B/photos/a.jpg', 'B/.DS_Store', '__MACOSX/B/._manifest.json'])).toEqual([
      'manifest.json', 'data.json', 'photos/a.jpg',
    ]);
  });
  it('does not strip a folder when the files do not all share it', () => {
    expect(names(['B/manifest.json', 'other.txt'])).toEqual(['B/manifest.json', 'other.txt']);
  });
});

describe('openBackup: what is not a usable backup', () => {
  it('a file that is not a ZIP, or a ZIP of something else, is NOT_A_BACKUP', async () => {
    await expectBackupError(new Blob(['hello, this is not a zip file at all']), 'NOT_A_BACKUP');
    await expectBackupError(new Blob([]), 'NOT_A_BACKUP');
    const other = new ZipWriter();
    other.add('holiday.jpg', jpegBytes('x'));
    await expectBackupError(other.finish(), 'NOT_A_BACKUP');
  });

  it('a ZIP whose manifest names another app is NOT_A_BACKUP', async () => {
    await expectInvalid((p) => ((p.manifest as unknown as { app: string }).app = 'SomethingElse'), 'NOT_A_BACKUP');
  });

  it('a backup missing data.json or manifest.json is NOT_A_BACKUP', async () => {
    await expectBackupError(backupBlob(sampleParts(), { omit: ['data.json'] }), 'NOT_A_BACKUP');
    await expectBackupError(backupBlob(sampleParts(), { omit: ['manifest.json'] }), 'NOT_A_BACKUP');
  });

  it('a backup from a newer app is NEWER_VERSION (file format or database)', async () => {
    await expectInvalid((p) => (p.manifest.formatVersion = 2), 'NEWER_VERSION');
    await expectInvalid((p) => (p.manifest.dbSchemaVersion = 99), 'NEWER_VERSION');
  });

  it('a damaged photo (flipped byte, CRC mismatch) is DAMAGED', async () => {
    const bytes = new Uint8Array(await backupBlob(sampleParts()).arrayBuffer());
    const reader = await ZipReader.open(new Blob([bytes]));
    const photo = reader.entries.find((e) => e.name === 'photos/p2.jpg');
    if (!photo) throw new Error('fixture');
    bytes[photo.localOffset + 30 + photo.name.length + 100] ^= 0x55;
    await expectBackupError(new Blob([bytes]), 'DAMAGED');
  });

  it('a damaged data.json is DAMAGED', async () => {
    const bytes = new Uint8Array(await backupBlob(sampleParts()).arrayBuffer());
    const reader = await ZipReader.open(new Blob([bytes]));
    const data = reader.entries.find((e) => e.name === 'data.json');
    if (!data) throw new Error('fixture');
    bytes[data.localOffset + 30 + data.name.length + 10] ^= 0x20;
    await expectBackupError(new Blob([bytes]), 'DAMAGED');
  });

  it('data.json or manifest.json that is not JSON (or not UTF-8) is DAMAGED', async () => {
    await expectBackupError(backupBlob(sampleParts(), { rawData: new TextEncoder().encode('{"entries": [') }), 'DAMAGED');
    await expectBackupError(backupBlob(sampleParts(), { rawManifest: new TextEncoder().encode('nope') }), 'DAMAGED');
    await expectBackupError(backupBlob(sampleParts(), { rawData: new Uint8Array([0xff, 0xfe, 0x00]) }), 'DAMAGED');
  });

  it('a backup cut short is not a ZIP any more', async () => {
    const bytes = new Uint8Array(await backupBlob(sampleParts()).arrayBuffer());
    await expectBackupError(new Blob([bytes.subarray(0, bytes.length - 100)]), 'NOT_A_BACKUP');
  });

  it('a photo file that is missing is MISSING_PHOTO', async () => {
    await expectBackupError(backupBlob(sampleParts(), { omit: ['photos/p1.jpg'] }), 'MISSING_PHOTO');
  });

  it('a "photo" that is not a JPEG is DAMAGED', async () => {
    await expectInvalid((p) => (p.photos.p1 = new TextEncoder().encode('this is a text file')), 'DAMAGED');
  });

  it('counts that do not match the content are INVALID', async () => {
    await expectInvalid((p) => (p.manifest.counts.entries = 4));
    await expectInvalid((p) => (p.manifest.counts.tags = 0));
    await expectInvalid((p) => (p.manifest.counts.photos = 1));
  });

  it('an entry pointing at a tag or photo that is not in the backup is INVALID', async () => {
    await expectInvalid((p) => (p.data.entries[0].baseSpiritTagIds = ['ghost']));
    await expectInvalid((p) => (p.data.entries[0].ingredientTagIds = ['ghost']));
    await expectInvalid((p) => (p.data.entries[0].photoId = 'ghost'));
  });

  it('a tag id of the wrong kind in an entry is INVALID', async () => {
    await expectInvalid((p) => (p.data.entries[0].baseSpiritTagIds = ['t-lime']));
    await expectInvalid((p) => (p.data.entries[0].ingredientTagIds = ['t-gin']));
  });

  it('duplicate entry ids, photo ids, tag ids or tag names are INVALID', async () => {
    await expectInvalid((p) => (p.data.entries[1].id = 'e1'));
    await expectInvalid((p) => p.data.photos.push({ ...p.data.photos[0] }));
    await expectInvalid((p) => (p.data.tags[1].id = 't-gin'));
    await expectInvalid((p) => p.data.tags.push(tag('t-gin2', ' GIN ', 'BASE_SPIRIT')));
    // the same name in the OTHER category is allowed
    const ok = cloneParts(sampleParts());
    ok.data.tags.push(tag('t-gin3', 'Gin', 'INGREDIENT'));
    ok.manifest.counts.tags = 4;
    await openBackup(backupBlob(ok));
  });

  it('an entry that breaks the entry rules is INVALID', async () => {
    await expectInvalid((p) => (p.data.entries[0].alcoholPercentage = 101));
    await expectInvalid((p) => (p.data.entries[0].alcoholVolumeMl = -1));
    await expectInvalid((p) => ((p.data.entries[0] as unknown as { category: string }).category = 'SMOOTHIE'));
    await expectInvalid((p) => (p.data.entries[0].dateTime = 'yesterday'));
    await expectInvalid((p) => (p.data.entries[0].dayKey = '2026-13-45'));
    await expectInvalid((p) => ((p.data.entries[0] as unknown as { drinkName: unknown }).drinkName = 7));
    await expectInvalid((p) => p.data.entries.splice(0, 1, makeEntry('', '2026-05-01')));
  });

  it('photo ids that would make odd file names are INVALID', async () => {
    await expectInvalid((p) => {
      p.data.photos[0].id = '../evil';
      p.data.entries[0].photoId = '../evil';
    });
  });

  it('tags without a usable name or category are INVALID', async () => {
    await expectInvalid((p) => (p.data.tags[0].name = '   '));
    await expectInvalid((p) => ((p.data.tags[0] as unknown as { category: string }).category = 'SPIRIT'));
  });

  it('data.json that is not the expected shape is INVALID', async () => {
    await expectBackupError(backupBlob(sampleParts(), { rawData: new TextEncoder().encode('[1,2,3]') }), 'INVALID');
    await expectBackupError(backupBlob(sampleParts(), { rawData: new TextEncoder().encode('{"entries":[],"tags":[]}') }), 'INVALID');
  });
});
