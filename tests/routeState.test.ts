import { describe, expect, it } from 'vitest';
import { readEditRouteState } from '../src/features/add/routeState';

describe('readEditRouteState (location.state is untyped, and null after a reload)', () => {
  const none = { fromDetail: false, resumeDraft: false };

  it('reads both flags when they are exactly true', () => {
    expect(readEditRouteState({ fromDetail: true, resumeDraft: true })).toEqual({ fromDetail: true, resumeDraft: true });
    expect(readEditRouteState({ fromDetail: true, resumeDraft: false })).toEqual({ fromDetail: true, resumeDraft: false });
    expect(readEditRouteState({ fromDetail: false, resumeDraft: true })).toEqual({ fromDetail: false, resumeDraft: true });
  });

  it('treats anything missing or malformed as false', () => {
    expect(readEditRouteState(null)).toEqual(none);
    expect(readEditRouteState(undefined)).toEqual(none);
    expect(readEditRouteState('detail')).toEqual(none);
    expect(readEditRouteState(42)).toEqual(none);
    expect(readEditRouteState({})).toEqual(none);
    expect(readEditRouteState({ fromDetail: 'true', resumeDraft: 1 })).toEqual(none);
    expect(readEditRouteState({ fromDetail: true })).toEqual({ fromDetail: true, resumeDraft: false });
  });
});
