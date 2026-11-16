import { describe, expect, it } from 'vitest';
import type { EntryDraftFields } from '../src/db/entryDraft';
import {
  buildEntryInput, emptyFields, sameTagSelection, tagSelectionFromEntry, type TagSelection,
} from '../src/features/add/entryFormModel';
import { makeEntry } from './helpers';

const DAY = '2026-05-07';
const NOW = new Date(2026, 4, 7, 9, 5);
const fields = (patch: Partial<EntryDraftFields> = {}): EntryDraftFields => ({ ...emptyFields(DAY, NOW), time: '10:00', ...patch });

describe('buildEntryInput with the form\'s tags', () => {
  const existing = makeEntry('a', DAY, 20, { baseSpiritTagIds: ['gin'], ingredientTagIds: ['lime'] });

  it('takes the tags the pickers hold, replacing the stored ones', () => {
    const tags: TagSelection = { baseSpiritTagIds: ['vodka', 'gin'], ingredientTagIds: [] };
    const result = buildEntryInput(fields(), { id: 'a', existing, now: NOW, tags });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.baseSpiritTagIds).toEqual(['vodka', 'gin']);
    expect(result.entry.ingredientTagIds).toEqual([]);
  });

  it('a new drink gets the chosen tags; without a selection it has none, and an edit keeps its stored tags', () => {
    const tags: TagSelection = { baseSpiritTagIds: ['rum'], ingredientTagIds: ['mint', 'lime'] };
    const fresh = buildEntryInput(fields(), { id: 'n', existing: undefined, now: NOW, tags });
    expect(fresh.ok && fresh.entry.ingredientTagIds).toEqual(['mint', 'lime']);

    const bare = buildEntryInput(fields(), { id: 'n', existing: undefined, now: NOW });
    expect(bare.ok && bare.entry.baseSpiritTagIds).toEqual([]);

    const kept = buildEntryInput(fields(), { id: 'a', existing, now: NOW });
    expect(kept.ok && kept.entry.baseSpiritTagIds).toEqual(['gin']);
    expect(kept.ok && kept.entry.ingredientTagIds).toEqual(['lime']);
  });

  it('copies the arrays, so editing the entry never changes the form\'s selection', () => {
    const tags: TagSelection = { baseSpiritTagIds: ['rum'], ingredientTagIds: [] };
    const result = buildEntryInput(fields(), { id: 'n', existing: undefined, now: NOW, tags });
    if (!result.ok) throw new Error('expected a valid entry');
    result.entry.baseSpiritTagIds.push('extra');
    expect(tags.baseSpiritTagIds).toEqual(['rum']);
  });
});

describe('tag selection helpers', () => {
  it('tagSelectionFromEntry copies the stored ids, and is empty for a new drink', () => {
    const entry = makeEntry('a', DAY, 20, { baseSpiritTagIds: ['gin'], ingredientTagIds: ['lime'] });
    const selection = tagSelectionFromEntry(entry);
    expect(selection).toEqual({ baseSpiritTagIds: ['gin'], ingredientTagIds: ['lime'] });
    selection.baseSpiritTagIds.push('x');
    expect(entry.baseSpiritTagIds).toEqual(['gin']);
    expect(tagSelectionFromEntry(undefined)).toEqual({ baseSpiritTagIds: [], ingredientTagIds: [] });
  });

  it('sameTagSelection ignores order but notices any added, removed or moved tag', () => {
    const base: TagSelection = { baseSpiritTagIds: ['a', 'b'], ingredientTagIds: ['c'] };
    expect(sameTagSelection(base, { baseSpiritTagIds: ['b', 'a'], ingredientTagIds: ['c'] })).toBe(true);
    expect(sameTagSelection(base, { baseSpiritTagIds: ['a'], ingredientTagIds: ['c'] })).toBe(false);
    expect(sameTagSelection(base, { baseSpiritTagIds: ['a', 'b'], ingredientTagIds: [] })).toBe(false);
    expect(sameTagSelection(base, { baseSpiritTagIds: ['a', 'b', 'c'], ingredientTagIds: [] })).toBe(false);
    expect(sameTagSelection(base, { baseSpiritTagIds: ['a', 'c'], ingredientTagIds: ['b'] })).toBe(false);
  });
});
