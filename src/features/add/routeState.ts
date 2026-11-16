/** Navigation state shared by the screens that open the edit form (react-router `location.state`). */
export interface EditRouteState {
  /** Edit was opened from the entry's detail screen, so leaving it goes back there with history -1. */
  fromDetail: boolean;
  /** The draft was already offered on /add and accepted; the edit screen must not ask again. */
  resumeDraft: boolean;
}

/** `location.state` is untyped and can be anything (or null after a reload): read it defensively. */
export function readEditRouteState(state: unknown): EditRouteState {
  if (typeof state !== 'object' || state === null) return { fromDetail: false, resumeDraft: false };
  const raw = state as Record<string, unknown>;
  return { fromDetail: raw.fromDetail === true, resumeDraft: raw.resumeDraft === true };
}
