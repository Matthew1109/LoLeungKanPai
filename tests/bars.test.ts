import { describe, expect, it } from 'vitest';
import { impliedBars, missingBars, tidyBarName } from '../src/utils/bars';

const AT = '2026-06-01T09:00:00.000Z';
const drink = (id: string, barName: string, dateTime: string) => ({ id, barName, dateTime });

describe('tidyBarName', () => {
  it('trims and collapses whitespace but keeps the capitalisation', () => {
    expect(tidyBarName('  Bar \t  Leone\n')).toBe('Bar Leone');
    expect(tidyBarName('bar LEONE')).toBe('bar LEONE');
    expect(tidyBarName('   ')).toBe('');
  });

  it('treats no-break and ideographic spaces as spaces', () => {
    expect(tidyBarName('Bar\u00a0\u00a0Leone')).toBe('Bar Leone');
    expect(tidyBarName('酒吧\u3000一號')).toBe('酒吧 一號');
  });
});

describe('impliedBars', () => {
  it('lists each bar the drinks name once, earliest drink first', () => {
    const drinks = [
      drink('c', 'Pub', '2026-05-07T20:00:00.000Z'),
      drink('a', 'Bar Leone', '2026-05-07T18:00:00.000Z'),
      drink('b', 'Bar Leone', '2026-05-08T18:00:00.000Z'),
    ];
    expect(impliedBars(drinks)).toEqual([{ key: 'bar leone', name: 'Bar Leone' }, { key: 'pub', name: 'Pub' }]);
  });

  it('the earliest spelling becomes the name (tidied), later spellings are the same bar', () => {
    const drinks = [
      drink('late', 'bar leone', '2026-05-09T22:00:00.000Z'),
      drink('early', '  Bar   Leone ', '2026-05-07T18:00:00.000Z'),
    ];
    expect(impliedBars(drinks)).toEqual([{ key: 'bar leone', name: 'Bar Leone' }]);
  });

  it('breaks a tie of date and time by drink id, so the result does not depend on the input order', () => {
    const same = '2026-05-07T20:00:00.000Z';
    const first = drink('a', 'Bar X', same);
    const second = drink('b', 'BAR X', same);
    expect(impliedBars([first, second])).toEqual([{ key: 'bar x', name: 'Bar X' }]);
    expect(impliedBars([second, first])).toEqual([{ key: 'bar x', name: 'Bar X' }]);
  });

  it('skips blank names and the keys already known, and does not reorder the input', () => {
    const drinks = [
      drink('b', 'Pub', '2026-05-08T20:00:00.000Z'),
      drink('a', '   ', '2026-05-07T20:00:00.000Z'),
      drink('c', 'Known Bar', '2026-05-09T20:00:00.000Z'),
    ];
    const copy = [...drinks];
    expect(impliedBars(drinks, new Set(['known bar']))).toEqual([{ key: 'pub', name: 'Pub' }]);
    expect(drinks).toEqual(copy);
    expect(impliedBars([])).toEqual([]);
  });
});

describe('missingBars', () => {
  it('makes an active Bar record, with a new id and the given time, for each bar not known yet', () => {
    let made = 0;
    const makeId = () => `id-${++made}`;
    const drinks = [
      drink('a', 'Bar Leone', '2026-05-07T18:00:00.000Z'),
      drink('b', 'Pub', '2026-05-07T20:00:00.000Z'),
      drink('c', 'bar leone', '2026-05-08T20:00:00.000Z'),
    ];

    expect(missingBars(drinks, new Set(['pub']), makeId, AT)).toEqual([
      { id: 'id-1', name: 'Bar Leone', nameKey: 'bar leone', isArchived: false, createdAt: AT, updatedAt: AT },
    ]);
    expect(made).toBe(1); // ids are only made for bars that are really added
  });

  it('is empty when every bar is known', () => {
    const makeId = () => 'never';
    expect(missingBars([drink('a', 'Pub', '2026-05-07T20:00:00.000Z')], new Set(['pub']), makeId, AT)).toEqual([]);
    expect(missingBars([], new Set(), makeId, AT)).toEqual([]);
  });
});
