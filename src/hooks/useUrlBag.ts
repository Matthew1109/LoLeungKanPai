import { useCallback, useEffect, useRef } from 'react';

/** Owns object URLs created for Blobs and revokes them, so photo URLs never leak memory. */
export function useUrlBag(): (next: string[]) => void {
  const ref = useRef<string[]>([]);
  useEffect(
    () => () => {
      ref.current.forEach((u) => URL.revokeObjectURL(u));
      ref.current = [];
    },
    [],
  );
  return useCallback((next: string[]) => {
    const old = ref.current;
    ref.current = next;
    // Delay so images of the previous render are never revoked while still on screen.
    setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 1000);
  }, []);
}
