/**
 * Tiny change signal shared by the repositories (which write) and the React hooks (which read).
 * Every repository write calls notifyDataChanged() after its transaction has committed, so open screens
 * (calendar, journal, detail) refetch. No React import here: the data layer stays UI-free.
 */
let version = 0;
const listeners = new Set<() => void>();

export function notifyDataChanged(): void {
  version++;
  listeners.forEach((listener) => listener());
}

export function getDataVersion(): number {
  return version;
}

export function subscribeDataChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
