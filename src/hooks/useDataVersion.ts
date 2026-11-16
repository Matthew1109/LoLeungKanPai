import { useSyncExternalStore } from 'react';
import { getDataVersion, notifyDataChanged, subscribeDataChanged } from '../db/changeSignal';

/** Re-exported so existing callers keep working. Repositories now call it themselves after each committed write. */
export { notifyDataChanged };

/** Changes whenever stored data changes; put it in an effect's dependency list to refetch. */
export function useDataVersion(): number {
  return useSyncExternalStore(subscribeDataChanged, getDataVersion);
}
