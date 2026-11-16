import { describe, expect, it } from 'vitest';
import {
  EMPTY_BACKUP_STATE, afterBackup, evaluateBackupReminder, normaliseBackupState, withEntryChanged, withEntryRemoved,
  type BackupState,
} from '../src/db/backupReminder';

const NOW = new Date('2026-06-30T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const changedMap = (n: number, at = daysAgo(1)) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, at]));
const state = (lastBackupAt: string | null, changed: Record<string, string> = {}): BackupState => ({ lastBackupAt, changed });

describe('bookkeeping', () => {
  it('counts DISTINCT entries: editing the same entry twice is one', () => {
    let s = withEntryChanged(EMPTY_BACKUP_STATE, 'a', '2026-06-01T10:00:00.000Z');
    s = withEntryChanged(s, 'a', '2026-06-02T10:00:00.000Z');
    s = withEntryChanged(s, 'b', '2026-06-02T11:00:00.000Z');
    expect(Object.keys(s.changed).sort()).toEqual(['a', 'b']);
    expect(s.changed.a).toBe('2026-06-02T10:00:00.000Z');
  });

  it('forgets a deleted entry and never mutates the input', () => {
    const s = withEntryChanged(EMPTY_BACKUP_STATE, 'a', 'x');
    expect(withEntryRemoved(s, 'a').changed).toEqual({});
    expect(s.changed).toEqual({ a: 'x' });
    expect(withEntryRemoved(s, 'zzz')).toBe(s);
  });

  it('afterBackup clears changes up to the snapshot but keeps edits made while the file was being built', () => {
    const s = state(null, { before: '2026-06-30T10:00:00.000Z', during: '2026-06-30T10:00:05.000Z' });
    const next = afterBackup(s, '2026-06-30T10:00:02.000Z');
    expect(next.lastBackupAt).toBe('2026-06-30T10:00:02.000Z');
    expect(Object.keys(next.changed)).toEqual(['during']);
  });

  it('normaliseBackupState tolerates junk', () => {
    expect(normaliseBackupState(undefined)).toEqual(EMPTY_BACKUP_STATE);
    expect(normaliseBackupState('x')).toEqual(EMPTY_BACKUP_STATE);
    expect(normaliseBackupState({ lastBackupAt: 5, changed: ['a'] })).toEqual(EMPTY_BACKUP_STATE);
    expect(normaliseBackupState({ lastBackupAt: 'd', changed: { a: 'x', b: 7 } })).toEqual({ lastBackupAt: 'd', changed: { a: 'x' } });
  });
});

describe('evaluateBackupReminder (E6: 10 distinct changed entries, or 30 days)', () => {
  const run = (s: BackupState, entryCount: number, firstEntryCreatedAt: string | null) =>
    evaluateBackupReminder({ state: s, entryCount, firstEntryCreatedAt, now: NOW });

  it('no entries, no reminder', () => {
    expect(run(EMPTY_BACKUP_STATE, 0, null).due).toBe(false);
  });

  it('changes rule: 9 changed entries is quiet, 10 triggers', () => {
    expect(run(state(daysAgo(2), changedMap(9)), 50, daysAgo(400)).due).toBe(false);
    const r = run(state(daysAgo(2), changedMap(10)), 50, daysAgo(400));
    expect(r.due).toBe(true);
    expect(r.reason).toBe('changes');
    expect(r.changedCount).toBe(10);
  });

  it('age rule: 30 days since the last backup triggers when something changed', () => {
    expect(run(state(daysAgo(29), changedMap(1)), 50, daysAgo(400)).due).toBe(false);
    const r = run(state(daysAgo(30), changedMap(1)), 50, daysAgo(400));
    expect(r.due).toBe(true);
    expect(r.reason).toBe('age');
  });

  it('age rule stays quiet when nothing changed since the backup (nothing unprotected)', () => {
    expect(run(state(daysAgo(90), {}), 50, daysAgo(400)).due).toBe(false);
  });

  it('never backed up: every entry counts, and the 30 days run from the FIRST ENTRY', () => {
    expect(run(EMPTY_BACKUP_STATE, 3, daysAgo(29)).due).toBe(false);
    const aged = run(EMPTY_BACKUP_STATE, 3, daysAgo(31));
    expect(aged.due).toBe(true);
    expect(aged.reason).toBe('age');
    const many = run(EMPTY_BACKUP_STATE, 10, daysAgo(1));
    expect(many.due).toBe(true);
    expect(many.reason).toBe('changes');
  });

  it('a first-entry date that cannot be read disables only the age rule', () => {
    expect(run(EMPTY_BACKUP_STATE, 3, null).due).toBe(false);
    expect(run(EMPTY_BACKUP_STATE, 12, null).due).toBe(true);
  });
});
