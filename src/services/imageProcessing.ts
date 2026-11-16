/**
 * Photo pipeline (decisions D7, D9): decode with EXIF orientation applied, downscale so the long edge is at most
 * 1600 px, re-encode as JPEG q=0.82, plus a centre-cropped square 480 px thumbnail for grids.
 * If the browser cannot decode the file we throw instead of storing something broken.
 */
export class PhotoProcessingError extends Error {
  constructor(public code: 'DECODE_FAILED' | 'ENCODE_FAILED', message: string) {
    super(message);
  }
}

export interface ProcessedPhoto {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

const MAX_EDGE = 1600;
const QUALITY = 0.82;
const THUMB = 480;
const THUMB_QUALITY = 0.8;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new PhotoProcessingError('ENCODE_FAILED', 'Could not encode the image'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function processPhoto(source: Blob): Promise<ProcessedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoProcessingError('DECODE_FAILED', 'This image format could not be read by the browser');
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    full.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    const fullBlob = await toJpeg(full, QUALITY);

    const side = Math.min(bitmap.width, bitmap.height);
    const thumb = document.createElement('canvas');
    thumb.width = THUMB;
    thumb.height = THUMB;
    thumb
      .getContext('2d')!
      .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
    const thumbBlob = await toJpeg(thumb, THUMB_QUALITY);

    // Release canvas backing stores promptly (iOS is strict about total canvas memory).
    full.width = full.height = thumb.width = thumb.height = 0;
    return { full: fullBlob, thumb: thumbBlob, width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Rebuilds the grid thumbnail from an already stored JPEG (used when a backup is restored, where thumbnails are
 * not part of the file). Decoding also proves the file is a real image. `width`/`height` are its pixel size.
 */
export async function thumbnailFromJpeg(source: Blob): Promise<{ thumb: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoProcessingError('DECODE_FAILED', 'This image could not be read by the browser');
  }
  try {
    const { width, height } = bitmap;
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB;
    canvas.height = THUMB;
    canvas.getContext('2d')!.drawImage(bitmap, (width - side) / 2, (height - side) / 2, side, side, 0, 0, THUMB, THUMB);
    const thumb = await toJpeg(canvas, THUMB_QUALITY);
    canvas.width = canvas.height = 0; // release the backing store promptly
    return { thumb, width, height };
  } finally {
    bitmap.close();
  }
}
