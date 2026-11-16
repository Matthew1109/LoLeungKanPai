import { getDb } from './index';
import type { PhotoRecord } from './schema';

/** Thumbnails only: used by the calendar so it never reads full-size photographs. */
export async function getThumbs(ids: string[]): Promise<Map<string, Blob>> {
  const db = await getDb();
  const tx = db.transaction('thumbs', 'readonly');
  const rows = await Promise.all(ids.map((id) => tx.store.get(id)));
  const out = new Map<string, Blob>();
  rows.forEach((r) => r && out.set(r.id, r.blob));
  return out;
}

export async function getPhotos(ids: string[]): Promise<Map<string, PhotoRecord>> {
  const db = await getDb();
  const tx = db.transaction('photos', 'readonly');
  const rows = await Promise.all(ids.map((id) => tx.store.get(id)));
  const out = new Map<string, PhotoRecord>();
  rows.forEach((r) => r && out.set(r.id, r));
  return out;
}
