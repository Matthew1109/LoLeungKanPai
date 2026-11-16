import en, { type MessageKey, type Messages } from './locales/en';

const catalogues: Record<string, Messages> = { en };
let active = 'en';

/** Initial release is English only. Later: pick 'zh-Hant' from navigator.language / a setting. */
export function resolveLocale(): string {
  return 'en';
}
active = resolveLocale();

/** Locale used for UI text and date/number formatting. (Week start follows the DEVICE locale; see utils/dates.) */
export function getAppLocale(): string {
  return active;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const msg = (catalogues[active] ?? en)[key] ?? en[key];
  return vars ? msg.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : msg;
}

/** Plural-aware lookup using Intl.PluralRules, e.g. tn('journal.entries', 3) -> "3 drinks". */
export function tn(base: 'journal.entries' | 'calendar.day', count: number, vars: Record<string, string | number> = {}): string {
  const form = new Intl.PluralRules(active).select(count) === 'one' ? 'one' : 'other';
  return t(`${base}.${form}` as MessageKey, { count, ...vars });
}
