import { describe, expect, it } from 'vitest';
import { searchEntries, searchTerms } from '../src/features/collections/searchModel';
import { nameKey } from '../src/utils/normalise';
import type { DrinkEntry, Tag, TagCategory } from '../src/db/schema';
import { makeEntry } from './helpers';

const tag = (id: string, name: string, category: TagCategory, isArchived = false): Tag => ({
  id, name, nameKey: nameKey(name), category, isArchived, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const tags = new Map(
  [tag('gin', 'Gin', 'BASE_SPIRIT'), tag('mezcal', 'Mezcal', 'BASE_SPIRIT', true), tag('lime', 'Lime Juice', 'INGREDIENT')].map((entry): [string, Tag] => [entry.id, entry]),
);
const ids = (list: DrinkEntry[]) => list.map((entry) => entry.id);

const journal = [
  makeEntry('negroni', '2026-05-01', 12, { drinkName: 'Negroni', barName: 'The Aviary', notes: 'Bitter, orange peel.', baseSpiritTagIds: ['gin'] }),
  makeEntry('paloma', '2026-05-03', 12, { drinkName: 'Paloma', barName: 'Casa Azul', notes: 'Smoky and fresh.', baseSpiritTagIds: ['mezcal'], ingredientTagIds: ['lime'] }),
  makeEntry('wine', '2026-05-02', 12, { drinkName: 'Pinot Noir', barName: 'Cave & Co', notes: 'Cherry,\nearth.' }),
  makeEntry('untitled', '2026-04-01', 12, { drinkName: '', barName: '', notes: '' }),
];

describe('searchTerms', () => {
  it('splits on any whitespace, lower-cases, and gives nothing for a blank query', () => {
    expect(searchTerms('  Old   Fashioned ')).toEqual(['old', 'fashioned']);
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   \n ')).toEqual([]);
  });
});

describe('searchEntries', () => {
  it('finds a drink by part of its name, ignoring case', () => {
    expect(ids(searchEntries(journal, tags, 'negro'))).toEqual(['negroni']);
    expect(ids(searchEntries(journal, tags, 'PINOT'))).toEqual(['wine']);
  });

  it('finds a drink by its bar', () => {
    expect(ids(searchEntries(journal, tags, 'aviary'))).toEqual(['negroni']);
    expect(ids(searchEntries(journal, tags, 'casa'))).toEqual(['paloma']);
  });

  it('finds a drink by its notes, including text after a line break', () => {
    expect(ids(searchEntries(journal, tags, 'smoky'))).toEqual(['paloma']);
    expect(ids(searchEntries(journal, tags, 'earth'))).toEqual(['wine']);
  });

  it('finds a drink by the name of a base spirit or ingredient tag, archived tags included', () => {
    expect(ids(searchEntries(journal, tags, 'gin'))).toEqual(['negroni']);
    expect(ids(searchEntries(journal, tags, 'mezcal'))).toEqual(['paloma']);
    expect(ids(searchEntries(journal, tags, 'lime juice'))).toEqual(['paloma']);
  });

  it('needs every word, which may be found in different fields', () => {
    expect(ids(searchEntries(journal, tags, 'negroni aviary'))).toEqual(['negroni']);
    expect(ids(searchEntries(journal, tags, 'paloma lime fresh'))).toEqual(['paloma']);
    expect(searchEntries(journal, tags, 'negroni casa')).toEqual([]);
  });

  it('ignores letter case and full-width letters', () => {
    expect(ids(searchEntries(journal, tags, 'ＧＩＮ'))).toEqual(['negroni']);
    expect(ids(searchEntries(journal, tags, 'ZZZ'))).toEqual([]);
  });

  it('a blank query finds nothing, and a word that is nowhere finds nothing', () => {
    expect(searchEntries(journal, tags, '')).toEqual([]);
    expect(searchEntries(journal, tags, '   ')).toEqual([]);
    expect(searchEntries(journal, tags, 'vodka')).toEqual([]);
  });

  it('lists results newest first and does not change the journal', () => {
    const before = ids(journal);
    expect(ids(searchEntries(journal, tags, 'o'))).toEqual(['paloma', 'wine', 'negroni']);
    expect(ids(journal)).toEqual(before);
  });

  it('copes with a tag id that has no tag record', () => {
    const odd = [makeEntry('odd', '2026-01-01', 12, { drinkName: 'Odd', baseSpiritTagIds: ['deleted'] })];
    expect(ids(searchEntries(odd, tags, 'odd'))).toEqual(['odd']);
    expect(searchEntries(odd, tags, 'deleted')).toEqual([]);
  });
});
