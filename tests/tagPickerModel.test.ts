import { describe, expect, it } from 'vitest';
import { exactMatch, matchTags, toggleId } from '../src/features/tags/tagPickerModel';
import { nameKey } from '../src/utils/normalise';

const tag = (name: string) => ({ name, nameKey: nameKey(name) });
const TAGS = ['Gin', 'Ginger Beer', 'Lime', 'Tonic Water'].map(tag);
const namesOf = (tags: Array<{ name: string }>) => tags.map((t) => t.name);

describe('toggleId', () => {
  it('adds an id at the end and removes one that is there, without mutating', () => {
    const start = ['a', 'b'];
    expect(toggleId(start, 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleId(start, 'a')).toEqual(['b']);
    expect(start).toEqual(['a', 'b']);
    expect(toggleId([], 'x')).toEqual(['x']);
  });
});

describe('matchTags', () => {
  it('matches part of a name, ignoring case, spacing and width', () => {
    expect(namesOf(matchTags(TAGS, 'gin'))).toEqual(['Gin', 'Ginger Beer']);
    expect(namesOf(matchTags(TAGS, '  ONIC '))).toEqual(['Tonic Water']);
    expect(namesOf(matchTags(TAGS, 'ＬＩＭ'))).toEqual(['Lime']);
    expect(matchTags(TAGS, 'xyz')).toEqual([]);
  });

  it('typing nothing keeps every tag, in order', () => {
    expect(namesOf(matchTags(TAGS, ''))).toEqual(['Gin', 'Ginger Beer', 'Lime', 'Tonic Water']);
    expect(namesOf(matchTags(TAGS, '   '))).toHaveLength(4);
  });
});

describe('exactMatch', () => {
  it('finds the tag with exactly that name, not longer ones', () => {
    expect(exactMatch(TAGS, ' gin ')?.name).toBe('Gin');
    expect(exactMatch(TAGS, 'Ginger  beer')?.name).toBe('Ginger Beer');
    expect(exactMatch(TAGS, 'ＧＩＮ')?.name).toBe('Gin');
  });

  it('is undefined for a part of a name or nothing at all', () => {
    expect(exactMatch(TAGS, 'gi')).toBeUndefined();
    expect(exactMatch(TAGS, '')).toBeUndefined();
    expect(exactMatch([], 'gin')).toBeUndefined();
  });
});
