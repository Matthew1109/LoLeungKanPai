import type { Bar } from '../../db/schema';
import { nameKey } from '../../utils/normalise';

/** Pure logic of the bar suggestions on the drink form (no React, no storage): easy to test. */

type Named = Pick<Bar, 'nameKey'>;

/** The most suggestions shown under the bar field at once. */
export const MAX_SUGGESTIONS = 6;

/**
 * The bars whose name contains what was typed (ignoring case and width), names that START with it first, at most
 * `limit`. Within each group the given order is kept. Typing nothing gives the first `limit` bars.
 */
export function matchBars<T extends Named>(bars: readonly T[], query: string, limit: number = MAX_SUGGESTIONS): T[] {
  const key = nameKey(query);
  if (key === '') return bars.slice(0, limit);
  const starting = bars.filter((bar) => bar.nameKey.startsWith(key));
  const containing = bars.filter((bar) => !bar.nameKey.startsWith(key) && bar.nameKey.includes(key));
  return [...starting, ...containing].slice(0, limit);
}

/** The bar whose name is exactly what was typed (ignoring case and spacing), if any. */
export function exactBar<T extends Named>(bars: readonly T[], query: string): T | undefined {
  const key = nameKey(query);
  return key === '' ? undefined : bars.find((bar) => bar.nameKey === key);
}
