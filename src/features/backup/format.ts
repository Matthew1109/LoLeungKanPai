import { getAppLocale } from '../../i18n';

/** "12 Mar 2026, 21:40" in the app's locale; an unreadable timestamp is shown as it is. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(getAppLocale(), {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export const formatMegabytes = (bytes: number): string => Math.max(0.1, bytes / 1048576).toFixed(1);
