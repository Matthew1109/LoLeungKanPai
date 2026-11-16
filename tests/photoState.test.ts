import { describe, expect, it } from 'vitest';
import { previewUrlFor, stateAfterRemove, toPhotoChange, type PhotoState } from '../src/features/add/photoState';
import { makePhoto } from './helpers';

const replacement = (): PhotoState => {
  const p = makePhoto('new');
  return { kind: 'replace', record: p.record, thumb: p.thumb, url: 'blob:new-photo' };
};

describe('toPhotoChange', () => {
  it('keep and remove carry no payload', () => {
    expect(toPhotoChange({ kind: 'keep' })).toEqual({ kind: 'keep' });
    expect(toPhotoChange({ kind: 'remove' })).toEqual({ kind: 'remove' });
  });

  it('replace hands the record and thumbnail to the repository, not the preview URL', () => {
    const state = replacement();
    const change = toPhotoChange(state);
    expect(change.kind).toBe('replace');
    if (state.kind === 'replace' && change.kind === 'replace') {
      expect(change.record).toBe(state.record);
      expect(change.thumb).toBe(state.thumb);
      expect('url' in change).toBe(false);
    }
  });
});

describe('stateAfterRemove', () => {
  it('removes a stored photo, and is simply "no change" when there was none', () => {
    expect(stateAfterRemove(true)).toEqual({ kind: 'remove' });
    expect(stateAfterRemove(false)).toEqual({ kind: 'keep' });
  });
});

describe('previewUrlFor', () => {
  it('shows the new picture, nothing after a removal, otherwise the stored one', () => {
    expect(previewUrlFor(replacement(), 'blob:stored')).toBe('blob:new-photo');
    expect(previewUrlFor({ kind: 'remove' }, 'blob:stored')).toBeNull();
    expect(previewUrlFor({ kind: 'keep' }, 'blob:stored')).toBe('blob:stored');
    expect(previewUrlFor({ kind: 'keep' }, null)).toBeNull();
    expect(previewUrlFor(replacement(), null)).toBe('blob:new-photo');
  });
});
