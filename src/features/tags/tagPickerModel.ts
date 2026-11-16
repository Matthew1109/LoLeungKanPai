import type { Tag } from '../../db/schema';
import { nameKey } from '../../utils/normalise';

/** Pure logic of the tag picker (no React, no storage): easy to test. */

type Named = Pick<Tag, 'nameKey'>;

/** Adds the id when absent, removes it when present. Never mutates; selection order is the order of choosing. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Tags whose name contains what was typed (ignoring case and width); typing nothing keeps them all. Order is kept. */
export function matchTags<T extends Named>(tags: readonly T[], query: string): T[] {
  const key = nameKey(query);
  return key === '' ? [...tags] : tags.filter((tag) => tag.nameKey.includes(key));
}

/** The tag whose name is exactly what was typed (ignoring case and spacing), if any. */
export function exactMatch<T extends Named>(tags: readonly T[], query: string): T | undefined {
  const key = nameKey(query);
  return key === '' ? undefined : tags.find((tag) => tag.nameKey === key);
}
