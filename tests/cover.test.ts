import { describe, expect, it } from 'vitest';
import { resolveCoverEntry } from '../src/utils/cover';
import type { DrinkEntry } from '../src/db/schema';

const e = (id: string, time: string, photoId: string | null, createdAt = '2026-05-07T00:00:00.000Z'): DrinkEntry => ({
  id, drinkName: id, category: null, dateTime: `2026-05-07T${time}:00.000Z`, dayKey: '2026-05-07', barName: '',
  photoId, baseSpiritTagIds: [], ingredientTagIds: [], alcoholPercentage: null, alcoholVolumeMl: null, notes: '',
  isFavourite: false, createdAt, updatedAt: createdAt,
});

describe('resolveCoverEntry (automatic cover only: earliest photographed entry of the day)', () => {
  it('picks the earliest entry that has a photo, ignoring earlier entries without one', () => {
    const list = [e('late', '22:00', 'p2'), e('noPhoto', '10:00', null), e('early', '18:00', 'p1')];
    expect(resolveCoverEntry(list)?.id).toBe('early');
  });

  it('returns undefined when no entry has a photo (placeholder tile)', () => {
    expect(resolveCoverEntry([e('a', '18:00', null)])).toBeUndefined();
    expect(resolveCoverEntry([])).toBeUndefined();
  });

  it('does not depend on the order of the list and does not mutate it', () => {
    const list = [e('b', '22:00', 'p2'), e('a', '18:00', 'p1')];
    expect(resolveCoverEntry(list)?.id).toBe('a');
    expect(list.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('breaks identical times by createdAt, then by id (deterministic)', () => {
    const older = e('z', '18:00', 'p1', '2026-05-01T00:00:00.000Z');
    const newer = e('a', '18:00', 'p2', '2026-05-02T00:00:00.000Z');
    expect(resolveCoverEntry([newer, older])?.id).toBe('z');
    const same1 = e('m', '18:00', 'p1');
    const same2 = e('n', '18:00', 'p2');
    expect(resolveCoverEntry([same2, same1])?.id).toBe('m');
  });

  it('falls back to the next earliest photographed entry when the cover entry is deleted', () => {
    const all = [e('early', '18:00', 'p1'), e('mid', '20:00', 'p2'), e('late', '22:00', 'p3')];
    expect(resolveCoverEntry(all)?.id).toBe('early');
    expect(resolveCoverEntry(all.filter((x) => x.id !== 'early'))?.id).toBe('mid');
  });

  it('falls back when the cover entry is moved to another day (it leaves this day\'s list)', () => {
    const all = [e('early', '18:00', 'p1'), e('late', '22:00', 'p3')];
    const thatDay = all.filter((x) => x.id !== 'early');
    expect(resolveCoverEntry(thatDay)?.id).toBe('late');
  });

  it('falls back when the cover entry loses its photo', () => {
    const all = [e('early', '18:00', 'p1'), e('late', '22:00', 'p3')];
    const edited = all.map((x) => (x.id === 'early' ? { ...x, photoId: null } : x));
    expect(resolveCoverEntry(edited)?.id).toBe('late');
  });

  it('lets a back-dated, earlier, photographed entry take over as the cover (accepted behaviour)', () => {
    const all = [e('evening', '20:00', 'p1')];
    expect(resolveCoverEntry(all)?.id).toBe('evening');
    expect(resolveCoverEntry([...all, e('backdated', '09:00', 'p2')])?.id).toBe('backdated');
  });
});
