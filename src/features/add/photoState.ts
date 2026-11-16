import type { PhotoChange } from '../../db/entryRepo';
import type { PhotoRecord } from '../../db/schema';

/** What the form currently intends for the photograph. `url` is an object URL owned by the form. */
export type PhotoState =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace'; record: PhotoRecord; thumb: Blob; url: string };

export function toPhotoChange(state: PhotoState): PhotoChange {
  if (state.kind === 'replace') return { kind: 'replace', record: state.record, thumb: state.thumb };
  if (state.kind === 'remove') return { kind: 'remove' };
  return { kind: 'keep' };
}

/** "Remove photo": the entry ends up without a photo. If it had none stored, that is simply "no change". */
export function stateAfterRemove(hasStoredPhoto: boolean): PhotoState {
  return hasStoredPhoto ? { kind: 'remove' } : { kind: 'keep' };
}

/** The picture to show: the new one, nothing after a removal, otherwise the stored one. */
export function previewUrlFor(state: PhotoState, storedUrl: string | null): string | null {
  if (state.kind === 'replace') return state.url;
  if (state.kind === 'remove') return null;
  return storedUrl;
}
