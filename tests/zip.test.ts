import { describe, expect, it } from 'vitest';
import { ZipError, ZipReader, ZipWriter, crc32 } from '../src/backup/zip';
import { FLAT_BACKUP_BASE64, WRAPPED_BACKUP_BASE64, fromBase64 } from './fixtures/pythonZips';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const pattern = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * seed + (i >> 8)) & 0xff);

async function expectZipError(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ZipError);
    expect((err as ZipError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ZipError ${code}, but nothing was thrown`);
}

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('ZipWriter -> ZipReader round trip', () => {
  it('returns every file byte for byte: many photos, a 1.5 MB photo, an empty file, Unicode names and text', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('manifest.json', enc('{"drink":"Negroní — 好 🍸"}'));
    files.set('data.json', enc(JSON.stringify({ notes: 'line 1\nline 2 é 日本語' })));
    files.set('photos/empty.jpg', new Uint8Array(0));
    files.set('photos/big.jpg', pattern(1_500_000));
    files.set('photos/日本語-é.jpg', pattern(321, 3));
    for (let i = 0; i < 120; i++) files.set(`photos/p${i}.jpg`, pattern(500 + i * 13, i + 1));

    const writer = new ZipWriter(new Date(2026, 4, 7, 12, 30, 10));
    for (const [name, bytes] of files) writer.add(name, bytes);
    expect(writer.fileCount).toBe(files.size);
    const blob = writer.finish();

    const reader = await ZipReader.open(blob);
    expect(reader.entries.map((e) => e.name).sort()).toEqual([...files.keys()].sort());
    for (const entry of reader.entries) {
      expect(entry.method).toBe(0);
      const got = await reader.read(entry, 10_000_000);
      const want = files.get(entry.name) as Uint8Array;
      expect(got.length).toBe(want.length);
      expect(crc32(got)).toBe(crc32(want));
      expect(got).toEqual(want);
    }
  });

  it('an archive with no files is still a valid archive', async () => {
    const reader = await ZipReader.open(new ZipWriter().finish());
    expect(reader.entries).toEqual([]);
  });

  it('the order of the files does not matter to the reader', async () => {
    const writer = new ZipWriter();
    writer.add('manifest.json', enc('m'));
    writer.add('photos/a.jpg', enc('a'));
    writer.add('data.json', enc('d'));
    const reader = await ZipReader.open(writer.finish());
    const byName = new Map(reader.entries.map((e) => [e.name, e]));
    expect(dec(await reader.read(byName.get('data.json') as never, 10))).toBe('d');
    expect(dec(await reader.read(byName.get('manifest.json') as never, 10))).toBe('m');
  });
});

describe('ZipReader rejects what it cannot trust', () => {
  const sample = () => {
    const w = new ZipWriter();
    w.add('a.txt', enc('hello world, hello zip'));
    w.add('b.txt', enc('second file'));
    return w.finish();
  };

  it('a flipped byte inside a file is caught by the CRC', async () => {
    const bytes = await bytesOf(sample());
    bytes[30 + 'a.txt'.length + 3] ^= 0x01; // inside the first file's data
    const reader = await ZipReader.open(new Blob([bytes]));
    await expectZipError(() => reader.read(reader.entries[0], 100), 'CORRUPT');
    expect(dec(await reader.read(reader.entries[1], 100))).toBe('second file'); // the other file is fine
  });

  it('a file cut short (download interrupted) is not a ZIP', async () => {
    const bytes = await bytesOf(sample());
    await expectZipError(() => ZipReader.open(new Blob([bytes.subarray(0, bytes.length - 30)])), 'NOT_ZIP');
    await expectZipError(() => ZipReader.open(new Blob([bytes.subarray(0, 10)])), 'NOT_ZIP');
  });

  it('a text file, an empty file and a JPEG renamed to .zip are not ZIPs', async () => {
    await expectZipError(() => ZipReader.open(new Blob([enc('just some text, long enough to have an end record somewhere')])), 'NOT_ZIP');
    await expectZipError(() => ZipReader.open(new Blob([])), 'NOT_ZIP');
    await expectZipError(() => ZipReader.open(new Blob([pattern(5000)])), 'NOT_ZIP');
  });

  it('a damaged central directory is reported', async () => {
    const bytes = await bytesOf(sample());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    const cdOffset = view.getUint32(end + 16, true);
    view.setUint32(cdOffset, 0x12345678, true); // break the first directory record's signature
    await expectZipError(() => ZipReader.open(new Blob([bytes])), 'CORRUPT');
  });

  it('a directory that points beyond the file is reported', async () => {
    const bytes = await bytesOf(sample());
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 22 + 16, 0x00ffffff, true);
    await expectZipError(() => ZipReader.open(new Blob([bytes])), 'CORRUPT');
  });

  it('two files with the same name are refused', async () => {
    const w = new ZipWriter();
    w.add('same.txt', enc('1'));
    w.add('same.txt', enc('2'));
    await expectZipError(() => ZipReader.open(w.finish()), 'CORRUPT');
  });

  it('an encrypted archive is refused', async () => {
    const bytes = await bytesOf(sample());
    const view = new DataView(bytes.buffer);
    const cdOffset = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint16(cdOffset + 8, view.getUint16(cdOffset + 8, true) | 1, true);
    await expectZipError(() => ZipReader.open(new Blob([bytes])), 'UNSUPPORTED');
  });

  it('an unknown compression method is refused when the file is read, not when the list is read', async () => {
    const bytes = await bytesOf(sample());
    const view = new DataView(bytes.buffer);
    const cdOffset = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint16(cdOffset + 10, 99, true);
    const reader = await ZipReader.open(new Blob([bytes]));
    await expectZipError(() => reader.read(reader.entries[0], 100), 'UNSUPPORTED');
  });

  it('a file larger than the caller allows is refused before it is read', async () => {
    const reader = await ZipReader.open(sample());
    await expectZipError(() => reader.read(reader.entries[0], 5), 'TOO_LARGE');
  });
});

describe('archives written by other tools (Python zipfile, streaming: deflated + data descriptors)', () => {
  it('reads a deflated archive and verifies every CRC', async () => {
    const reader = await ZipReader.open(new Blob([fromBase64(FLAT_BACKUP_BASE64)]));
    expect(reader.entries.map((e) => e.name)).toEqual(['manifest.json', 'data.json', 'photos/p1.jpg']);
    expect(reader.entries.every((e) => e.method === 8)).toBe(true);
    const manifest = JSON.parse(dec(await reader.read(reader.entries[0], 10_000)));
    expect(manifest.app).toBe('LoLeungKanPai');
    const photo = await reader.read(reader.entries[2], 100_000);
    expect(Array.from(photo.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(photo.length).toBeGreaterThan(5000);
  });

  it('lists folder entries and Finder junk too, and reads the empty folder entry', async () => {
    const reader = await ZipReader.open(new Blob([fromBase64(WRAPPED_BACKUP_BASE64)]));
    const names = reader.entries.map((e) => e.name);
    expect(names).toContain('LoLeungKanPai-backup/');
    expect(names).toContain('LoLeungKanPai-backup/photos/p1.jpg');
    expect(names.some((n) => n.startsWith('__MACOSX/'))).toBe(true);
    const folder = reader.entries.find((e) => e.name === 'LoLeungKanPai-backup/');
    expect((await reader.read(folder as never, 10)).length).toBe(0);
  });

  it('a flipped byte in a deflated file is detected (never silently wrong data)', async () => {
    const bytes = fromBase64(FLAT_BACKUP_BASE64);
    const reader0 = await ZipReader.open(new Blob([bytes]));
    const target = reader0.entries[1]; // data.json
    const damaged = bytes.slice();
    damaged[target.localOffset + 30 + target.name.length + 5] ^= 0xff;
    const reader = await ZipReader.open(new Blob([damaged]));
    await expectZipError(() => reader.read(reader.entries[1], 100_000), 'CORRUPT');
  });
});
