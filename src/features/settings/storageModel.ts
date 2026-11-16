/** Pure rules of the storage meter (decision D6): no React, no browser calls. */

/** Warn when the browser's quota is this full. */
export const NEAR_FULL_FRACTION = 0.8;
/** Soft warning when stored photographs exceed this many bytes (500 MB). */
export const PHOTO_SOFT_LIMIT = 500 * 1024 * 1024;

export interface StorageFigures {
  /** Bytes used by this app (browser estimate), or null when the browser cannot say. */
  usage: number | null;
  quota: number | null;
  /** Sum of the stored photograph sizes. */
  photoBytes: number;
}

export type StorageLevel = 'ok' | 'photos' | 'nearFull';

/** 0 to 1 (can exceed 1), or null when unknown or the quota is not a positive number. */
export function fractionUsed(f: Pick<StorageFigures, 'usage' | 'quota'>): number | null {
  if (f.usage === null || f.quota === null || !(f.quota > 0) || f.usage < 0) return null;
  return f.usage / f.quota;
}

/** 'nearFull' (80% of the quota) outranks 'photos' (more than 500 MB of photographs). */
export function assessStorage(f: StorageFigures): StorageLevel {
  const used = fractionUsed(f);
  if (used !== null && used >= NEAR_FULL_FRACTION) return 'nearFull';
  return f.photoBytes > PHOTO_SOFT_LIMIT ? 'photos' : 'ok';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i <= 1 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
