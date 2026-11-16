/**
 * Minimal ZIP writer and reader for backups (replaces the fflate plan: it can be tested against Python's
 * `zipfile` here, has no dependency, and knows every size and CRC up front, so no data descriptors).
 *
 * Writer: stored (method 0) entries, UTF-8 names, no ZIP64 (a backup beyond 4 GB or 65,535 files is refused).
 * Reader: stored and deflated (method 8) entries, read via the central directory from Blob slices, so only one
 * entry is in memory at a time. Every entry's CRC-32 and size are verified. No fetch() of blob: URLs anywhere.
 */
export type ZipErrorCode = 'NOT_ZIP' | 'UNSUPPORTED' | 'CORRUPT' | 'TOO_LARGE';

export class ZipError extends Error {
  constructor(readonly code: ZipErrorCode, message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const MAX_FILES = 0xfffe;
const MAX_BYTES = 0xfffffff0;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private readonly stamp: { time: number; date: number };

  constructor(when: Date = new Date()) {
    this.stamp = dosDateTime(when);
  }

  get fileCount(): number {
    return this.central.length;
  }

  add(name: string, data: Uint8Array): void {
    const nameBytes = encoder.encode(name);
    if (this.central.length >= MAX_FILES || this.offset + data.length > MAX_BYTES) {
      throw new ZipError('TOO_LARGE', 'The backup is too large for the ZIP format used');
    }
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, this.stamp.time, true);
    local.setUint16(12, this.stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, SIG_CENTRAL, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, this.stamp.time, true);
    cd.setUint16(14, this.stamp.date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, this.offset, true); // local header offset (extra/comment/disk/attrs stay 0)
    const record = new Uint8Array(46 + nameBytes.length);
    record.set(new Uint8Array(cd.buffer), 0);
    record.set(nameBytes, 46);
    this.central.push(record);

    // One Blob per file keeps the browser, not the JS heap, holding the bytes.
    this.parts.push(new Blob([new Uint8Array(local.buffer), nameBytes, data]));
    this.offset += 30 + nameBytes.length + data.length;
  }

  finish(): Blob {
    const cdSize = this.central.reduce((n, r) => n + r.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, SIG_END, true);
    end.setUint16(8, this.central.length, true);
    end.setUint16(10, this.central.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export class ZipReader {
  private constructor(private readonly blob: Blob, readonly entries: ZipEntry[]) {}

  static async open(blob: Blob): Promise<ZipReader> {
    if (blob.size < 22) throw new ZipError('NOT_ZIP', 'This is not a ZIP file');
    const tailLength = Math.min(blob.size, 22 + 0xffff);
    const tailStart = blob.size - tailLength;
    const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
    const tv = new DataView(tail.buffer);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tv.getUint32(i, true) === SIG_END && i + 22 + tv.getUint16(i + 20, true) === tail.length) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new ZipError('NOT_ZIP', 'This is not a ZIP file');

    const count = tv.getUint16(end + 10, true);
    const cdSize = tv.getUint32(end + 12, true);
    const cdOffset = tv.getUint32(end + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new ZipError('UNSUPPORTED', 'ZIP64 archives are not supported');
    }
    if (tv.getUint16(end + 4, true) !== 0 || tv.getUint16(end + 6, true) !== 0) {
      throw new ZipError('UNSUPPORTED', 'Multi-part ZIP files are not supported');
    }
    if (cdOffset + cdSize > blob.size) throw new ZipError('CORRUPT', 'The ZIP directory is damaged');

    const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const cv = new DataView(cd.buffer);
    const entries: ZipEntry[] = [];
    const seen = new Set<string>();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('CORRUPT', 'The ZIP directory is damaged');
      const flags = cv.getUint16(p + 8, true);
      const nameLen = cv.getUint16(p + 28, true);
      const extraLen = cv.getUint16(p + 30, true);
      const commentLen = cv.getUint16(p + 32, true);
      if (p + 46 + nameLen > cd.length) throw new ZipError('CORRUPT', 'The ZIP directory is damaged');
      if (flags & 1) throw new ZipError('UNSUPPORTED', 'Encrypted ZIP files are not supported');
      let name: string;
      try {
        name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));
      } catch {
        throw new ZipError('CORRUPT', 'A file name in the ZIP is not valid');
      }
      const entry: ZipEntry = {
        name,
        method: cv.getUint16(p + 10, true),
        crc: cv.getUint32(p + 16, true),
        compressedSize: cv.getUint32(p + 20, true),
        size: cv.getUint32(p + 24, true),
        localOffset: cv.getUint32(p + 42, true),
      };
      if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) {
        throw new ZipError('UNSUPPORTED', 'ZIP64 archives are not supported');
      }
      if (seen.has(name)) throw new ZipError('CORRUPT', `Duplicate file in the ZIP: ${name}`);
      seen.add(name);
      entries.push(entry);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipReader(blob, entries);
  }

  /** The verified, uncompressed bytes of one entry. `maxBytes` bounds memory (and zip bombs). */
  async read(entry: ZipEntry, maxBytes: number): Promise<Uint8Array> {
    if (entry.size > maxBytes) throw new ZipError('TOO_LARGE', `${entry.name} is larger than expected`);
    const head = new DataView(await this.blob.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
    if (head.byteLength < 30 || head.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('CORRUPT', `${entry.name} is damaged`);
    const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const end = start + entry.compressedSize;
    if (end > this.blob.size) throw new ZipError('CORRUPT', `${entry.name} is cut short`);
    const raw = this.blob.slice(start, end);

    let bytes: Uint8Array;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) throw new ZipError('CORRUPT', `${entry.name} is damaged`);
      bytes = new Uint8Array(await raw.arrayBuffer());
    } else if (entry.method === 8) {
      bytes = await inflate(raw, entry.size, entry.name);
    } else {
      throw new ZipError('UNSUPPORTED', `${entry.name} uses a compression method that is not supported`);
    }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new ZipError('CORRUPT', `${entry.name} is damaged`);
    return bytes;
  }
}

/** Inflates raw deflate data, giving up as soon as it produces more than the declared size. */
async function inflate(raw: Blob, expected: number, name: string): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new ZipError('UNSUPPORTED', 'This browser cannot read compressed ZIP files');
  const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw' as never) /* older lib.dom lists only deflate and gzip */).getReader();
  const out = new Uint8Array(expected);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > expected) throw new ZipError('CORRUPT', `${name} is damaged`);
      out.set(value, n);
      n += value.length;
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err instanceof ZipError ? err : new ZipError('CORRUPT', `${name} is damaged`);
  }
  return n === expected ? out : out.subarray(0, n);
}
