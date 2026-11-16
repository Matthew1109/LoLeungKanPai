import { useId, useRef, useState } from 'react';
import { APP_VERSION } from '../../appVersion';
import { deliverBackup } from '../../backup/deliver';
import { createBackup, type CreatedBackup } from '../../backup/exportBackup';
import { recordBackupMade } from '../../db/backupRepo';
import { t } from '../../i18n';
import { backupErrorKey } from './backupErrors';
import { formatMegabytes, formatWhen } from './format';
import { useBackupStatus } from './useBackupStatus';
import s from './Backup.module.css';

type Phase = 'idle' | 'creating' | 'ready' | 'saving';
interface Note {
  kind: 'ok' | 'info' | 'error';
  text: string;
}

/**
 * Two steps on purpose: "Create backup" can take a while with many photos, and the iOS share sheet only opens
 * from a fresh tap, so "Save backup" is a second button. The backup counts as made only once the file has been
 * handed to the share sheet / download; a closed share sheet records nothing.
 */
export default function BackupSection() {
  const titleId = useId();
  const status = useBackupStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [ready, setReady] = useState<CreatedBackup | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const busy = useRef(false);

  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    setNote(null);
    setReady(null);
    setProgress(null);
    setPhase('creating');
    try {
      const made = await createBackup(APP_VERSION, (done, total) => {
        setProgress({ done, total });
        return new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the screen repaint
      });
      setReady(made);
      setPhase('ready');
    } catch (err) {
      setNote({ kind: 'error', text: t(backupErrorKey(err)) });
      setPhase('idle');
    } finally {
      busy.current = false;
    }
  };

  const save = async () => {
    if (busy.current || !ready) return;
    busy.current = true;
    setNote(null);
    setPhase('saving');
    try {
      const outcome = await deliverBackup(ready.blob, ready.fileName);
      if (outcome === 'cancelled') {
        setNote({ kind: 'info', text: t('backup.cancelled') });
        setPhase('ready');
        return;
      }
      const text = t(outcome === 'shared' ? 'backup.saved.shared' : 'backup.saved.downloaded');
      try {
        await recordBackupMade(ready.snapshotAt);
        setNote({ kind: 'ok', text });
      } catch {
        setNote({ kind: 'error', text: `${text} ${t('backup.noteFailed')}` });
      }
      setReady(null);
      setPhase('idle');
    } catch {
      setNote({ kind: 'error', text: t('backup.error.save') });
      setPhase('ready');
    } finally {
      busy.current = false;
    }
  };

  return (
    <section className={s.card} aria-labelledby={titleId}>
      <h3 id={titleId} className={s.title}>{t('backup.title')}</h3>
      <p className={s.text}>{t('backup.intro')}</p>
      {status && (
        <p className={s.meta}>
          {status.lastBackupAt ? t('backup.status.last', { date: formatWhen(status.lastBackupAt) }) : t('backup.status.never')}
          <br />
          {t('backup.status.counts', { entries: status.entryCount, photos: status.photoCount })}
        </p>
      )}

      {phase === 'idle' && (
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={create}>{t('backup.create')}</button>
        </div>
      )}

      {phase === 'creating' && (
        <div className={s.progress} role="status">
          <p className={s.text}>
            {progress && progress.total > 0
              ? t('backup.progress', { done: progress.done, total: progress.total })
              : t('backup.creating')}
          </p>
          <div className={s.bar}>
            <div className={s.fill} style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {(phase === 'ready' || phase === 'saving') && ready && (
        <div className={s.progress}>
          <p className={s.text}>
            {t('backup.ready', {
              name: ready.fileName,
              entries: ready.counts.entries,
              tags: ready.counts.tags,
              photos: ready.counts.photos,
              size: formatMegabytes(ready.blob.size),
            })}
          </p>
          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={save} disabled={phase === 'saving'}>
              {phase === 'saving' ? t('backup.saving') : t('backup.save')}
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className={note.kind === 'error' ? s.error : s.note} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
    </section>
  );
}
