import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPhotoBytes } from '../src/db/photoRepo';
import { assessStorage, formatBytes, fractionUsed, NEAR_FULL_FRACTION, PHOTO_SOFT_LIMIT } from '../src/features/settings/storageModel';
import { clearAll, stagePhotos } from './helpers';

beforeEach(clearAll);

const MB = 1024 * 1024;

describe('storage warnings (D6)', () => {
  it('fractionUsed is null when unknown or the quota is not positive', () => {
    expect(fractionUsed({ usage: null, quota: 100 })).toBeNull();
    expect(fractionUsed({ usage: 10, quota: null })).toBeNull();
    expect(fractionUsed({ usage: 10, quota: 0 })).toBeNull();
    expect(fractionUsed({ usage: 50, quota: 200 })).toBe(0.25);
  });

  it('warns at 80% of the quota, not below', () => {
    expect(NEAR_FULL_FRACTION).toBe(0.8);
    expect(assessStorage({ usage: 79, quota: 100, photoBytes: 0 })).toBe('ok');
    expect(assessStorage({ usage: 80, quota: 100, photoBytes: 0 })).toBe('nearFull');
    expect(assessStorage({ usage: 120, quota: 100, photoBytes: 0 })).toBe('nearFull');
  });

  it('soft-warns above 500 MB of photographs, and near-full outranks it', () => {
    expect(assessStorage({ usage: null, quota: null, photoBytes: PHOTO_SOFT_LIMIT })).toBe('ok');
    expect(assessStorage({ usage: null, quota: null, photoBytes: PHOTO_SOFT_LIMIT + 1 })).toBe('photos');
    expect(assessStorage({ usage: 90, quota: 100, photoBytes: 600 * MB })).toBe('nearFull');
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(5 * MB)).toBe('5.0 MB');
    expect(formatBytes(1.5 * 1024 * MB)).toBe('1.5 GB');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('getPhotoBytes', () => {
  it('is 0 for an empty store and sums the stored photograph sizes', async () => {
    expect(await getPhotoBytes()).toBe(0);
    await stagePhotos('a', 'b');
    // makePhoto writes "photo-<id>": 7 bytes each
    expect(await getPhotoBytes()).toBe(14);
  });
});
