import { describe, expect, it } from 'vitest';
import { parseEntryDraft, type EntryDraft } from '../src/db/entryDraft';

const good = (): EntryDraft => ({
  entryId: 'e1', mode: 'new', baseUpdatedAt: null, savedAt: '2026-05-07T10:00:00.000Z',
  fields: { drinkName: 'Neg', category: 'COCKTAIL', date: '2026-05-07', time: '20:00', barName: '', alcoholPercentage: '12.5', alcoholVolumeMl: '', notes: '', isFavourite: false },
});

describe('parseEntryDraft', () => {
  it('round-trips a valid draft', () => {
    expect(parseEntryDraft(good())).toEqual(good());
    expect(parseEntryDraft({ ...good(), mode: 'edit', baseUpdatedAt: '2026-05-01T00:00:00.000Z' })?.mode).toBe('edit');
  });

  it('treats anything malformed as no draft', () => {
    expect(parseEntryDraft(undefined)).toBeUndefined();
    expect(parseEntryDraft('x')).toBeUndefined();
    expect(parseEntryDraft({ ...good(), entryId: '' })).toBeUndefined();
    expect(parseEntryDraft({ ...good(), mode: 'other' })).toBeUndefined();
    expect(parseEntryDraft({ ...good(), baseUpdatedAt: 5 })).toBeUndefined();
    expect(parseEntryDraft({ ...good(), fields: { ...good().fields, category: 'SODA' } })).toBeUndefined();
    expect(parseEntryDraft({ ...good(), fields: { ...good().fields, alcoholPercentage: 12 } })).toBeUndefined();
    expect(parseEntryDraft({ ...good(), fields: null })).toBeUndefined();
  });
});
