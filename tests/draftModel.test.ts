import { describe, expect, it } from 'vitest';
import { decideDraftForAdd, decideDraftForEdit, formatDraftTime, makeDraft } from '../src/features/add/draftModel';
import { emptyFields } from '../src/features/add/entryFormModel';
import type { EntryDraft } from '../src/db/entryDraft';
import { makeEntry } from './helpers';

const DAY = '2026-05-07';
const NOW = new Date(2026, 4, 7, 12, 0);
const entry = makeEntry('a', DAY, 20, { updatedAt: '2026-05-07T12:00:00.000Z' });

const newDraft = (entryId = 'n1'): EntryDraft => makeDraft({ entryId, mode: 'new', baseUpdatedAt: null, fields: emptyFields(DAY, NOW), now: NOW });
const editDraft = (baseUpdatedAt: string | null = entry.updatedAt, entryId = entry.id): EntryDraft =>
  makeDraft({ entryId, mode: 'edit', baseUpdatedAt, fields: emptyFields(DAY, NOW), now: NOW });

describe('makeDraft', () => {
  it('stamps savedAt and copies the fields (later typing must not change a stored draft)', () => {
    const source = emptyFields(DAY, NOW);
    const draft = makeDraft({ entryId: 'n1', mode: 'new', baseUpdatedAt: null, fields: source, now: NOW });
    expect(draft.savedAt).toBe(NOW.toISOString());
    expect(draft.entryId).toBe('n1');
    expect(draft.mode).toBe('new');
    expect(draft.baseUpdatedAt).toBeNull();
    expect(draft.fields).toEqual(source);
    expect(draft.fields).not.toBe(source);
    source.drinkName = 'typed later';
    expect(draft.fields.drinkName).toBe('');
  });
});

describe('decideDraftForAdd: a draft is never applied silently', () => {
  it('no draft -> nothing to do', () => {
    expect(decideDraftForAdd(undefined, undefined)).toEqual({ kind: 'none' });
  });

  it('a new-entry draft is offered', () => {
    const draft = newDraft();
    expect(decideDraftForAdd(draft, undefined)).toEqual({ kind: 'offer', draft });
  });

  it('an edit draft is offered only while its entry still has the updatedAt the form opened with', () => {
    const draft = editDraft();
    expect(decideDraftForAdd(draft, entry.updatedAt)).toEqual({ kind: 'offer', draft });
    expect(decideDraftForAdd(draft, '2026-05-08T00:00:00.000Z')).toEqual({ kind: 'discard' }); // entry changed since
    expect(decideDraftForAdd(draft, undefined)).toEqual({ kind: 'discard' }); // entry was deleted
    expect(decideDraftForAdd(editDraft(null), entry.updatedAt)).toEqual({ kind: 'discard' }); // malformed base
  });
});

describe('decideDraftForEdit', () => {
  it('a draft of some other entry is not ours to offer or delete', () => {
    expect(decideDraftForEdit(undefined, entry)).toEqual({ kind: 'none' });
    expect(decideDraftForEdit(newDraft('n1'), entry)).toEqual({ kind: 'none' });
    expect(decideDraftForEdit(editDraft(entry.updatedAt, 'someone-else'), entry)).toEqual({ kind: 'none' });
  });

  it('a matching edit draft is offered while the entry is unchanged', () => {
    const draft = editDraft();
    expect(decideDraftForEdit(draft, entry)).toEqual({ kind: 'offer', draft });
  });

  it('a matching draft is discarded when the entry changed since, or was a new-entry draft for the same id', () => {
    expect(decideDraftForEdit(editDraft('2026-01-01T00:00:00.000Z'), entry)).toEqual({ kind: 'discard' });
    expect(decideDraftForEdit(newDraft(entry.id), entry)).toEqual({ kind: 'discard' });
  });
});

describe('formatDraftTime', () => {
  it('formats a valid stamp for the given locale', () => {
    const text = formatDraftTime(NOW.toISOString(), 'en');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('2026');
  });

  it('returns an empty string for an unusable stamp instead of throwing', () => {
    expect(formatDraftTime('not a date', 'en')).toBe('');
    expect(formatDraftTime('', 'en')).toBe('');
  });
});
