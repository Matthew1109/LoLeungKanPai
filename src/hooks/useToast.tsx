import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import Toast from '../components/Toast';

const TOAST_MS = 4500;

/** `showToast(message)` replaces any toast being shown; it dismisses itself after a few seconds. Render `toast`. */
export function useToast(): { toast: ReactElement | null; showToast: (message: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setMessage(null);
  }, []);

  const showToast = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    setMessage(next);
    timer.current = window.setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast: message === null ? null : <Toast message={message} onDismiss={dismiss} />, showToast };
}
