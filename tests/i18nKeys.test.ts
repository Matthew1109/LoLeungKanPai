import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en';

/**
 * Every message key written in the source must exist in the English catalogue. The compiler already checks
 * t('literal') calls; this also covers keys that are stored in objects or passed around as values, and it keeps
 * working when a key is renamed in one place only.
 */
const SRC = join(process.cwd(), 'src');
const CATALOGUE_FILE = join('i18n', 'locales', 'en.ts');
const PREFIXES = [
  'app', 'nav', 'common', 'calendar', 'journal', 'favourite', 'form', 'category', 'draft', 'discard', 'entry',
  'delete', 'placeholder', 'settings', 'install', 'update', 'error', 'backup', 'restore', 'reminder', 'tags',
  'gallery', 'collections',
];
const KEY_LITERAL = new RegExp(`'((?:${PREFIXES.join('|')})\\.[A-Za-z0-9_.]+)'`, 'g');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(item.name)) out.push(full);
  }
  return out;
}

const has = (key: string) => Object.prototype.hasOwnProperty.call(en, key);

describe('message keys', () => {
  it('every key literal used in src/ exists in the English catalogue', () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith(CATALOGUE_FILE)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(KEY_LITERAL)) {
        found++;
        const key = match[1];
        const isPluralBase = has(`${key}.one`) && has(`${key}.other`); // tn('journal.entries', n)
        if (!has(key) && !isPluralBase) missing.push(`${file.slice(SRC.length + 1)}: ${key}`);
      }
    }
    expect(found).toBeGreaterThan(50); // the scan itself works
    expect(missing).toEqual([]);
  });

  it('the catalogue has no empty messages', () => {
    for (const [key, message] of Object.entries(en)) {
      expect(`${key}: ${message.trim().length > 0}`).toBe(`${key}: true`);
    }
  });
});
