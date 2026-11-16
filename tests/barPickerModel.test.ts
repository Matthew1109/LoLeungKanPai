import { describe, expect, it } from 'vitest';
import { exactBar, matchBars, MAX_SUGGESTIONS } from '../src/features/bars/barPickerModel';
import { nameKey } from '../src/utils/normalise';

const bar = (name: string) => ({ name, nameKey: nameKey(name) });
const BARS = ['Bar Leone', 'Foxglove', 'Hidden Bar', 'The Old Pub', 'Zoo Bar'].map(bar);
const MANY = Array.from({ length: 10 }, (_, index) => bar(`Bar ${index}`));
const namesOf = (bars: Array<{ name: string }>) => bars.map((item) => item.name);

describe('matchBars', () => {
  it('matches part of a name, ignoring case, spacing and width', () => {
    expect(namesOf(matchBars(BARS, 'fox'))).toEqual(['Foxglove']);
    expect(namesOf(matchBars(BARS, '  OLD  '))).toEqual(['The Old Pub']);
    expect(namesOf(matchBars(BARS, 'ＰＵＢ'))).toEqual(['The Old Pub']);
    expect(matchBars(BARS, 'xyz')).toEqual([]);
  });

  it('puts the names that START with what was typed first, then the others, each group in the given order', () => {
    expect(namesOf(matchBars(BARS, 'bar'))).toEqual(['Bar Leone', 'Hidden Bar', 'Zoo Bar']);
    expect(namesOf(matchBars(['Old Bar', 'Bar One', 'Another Bar', 'Bar Two'].map(bar), 'bar'))).toEqual(['Bar One', 'Bar Two', 'Old Bar', 'Another Bar']);
  });

  it('typing nothing gives the first bars in order, at most the limit', () => {
    expect(namesOf(matchBars(BARS, ''))).toEqual(namesOf(BARS));
    expect(matchBars(MANY, '   ')).toHaveLength(MAX_SUGGESTIONS);
    expect(namesOf(matchBars(MANY, ''))).toEqual(namesOf(MANY.slice(0, MAX_SUGGESTIONS)));
  });

  it('never gives more than the limit, and the limit can be chosen', () => {
    expect(MAX_SUGGESTIONS).toBe(6);
    expect(matchBars(MANY, 'bar')).toHaveLength(MAX_SUGGESTIONS);
    expect(namesOf(matchBars(MANY, 'bar', 3))).toEqual(['Bar 0', 'Bar 1', 'Bar 2']);
  });

  it('does not change the list it was given', () => {
    const copy = [...BARS];
    matchBars(BARS, 'bar');
    expect(BARS).toEqual(copy);
  });
});

describe('exactBar', () => {
  it('finds the bar with exactly that name (ignoring case, spacing and width), not longer ones', () => {
    expect(exactBar(BARS, ' bar  leone ')?.name).toBe('Bar Leone');
    expect(exactBar(BARS, 'ＦＯＸＧＬＯＶＥ')?.name).toBe('Foxglove');
  });

  it('is undefined for part of a name, an unknown name or nothing at all', () => {
    expect(exactBar(BARS, 'bar')).toBeUndefined();
    expect(exactBar(BARS, 'Nowhere')).toBeUndefined();
    expect(exactBar(BARS, '   ')).toBeUndefined();
    expect(exactBar([], 'bar')).toBeUndefined();
  });
});
