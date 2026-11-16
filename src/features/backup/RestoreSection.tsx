import { useId, useRef, useState, type ChangeEvent } from 'react';
import { openBackup, type OpenedBackup } from '../../backup/backupFormat';
import { defaultRestoreDeps, restoreBackup, type RestoreProgress, type RestoreStep } from '../../backup/restore';
import ConfirmDialog from '../../components/ConfirmDialog';
import { isRestoreSupported } from '../../db/locks';
import { t } from '../../i18n';
import type { MessageKey } from '../../i18n/locales/en';
import { thumbnailFromJpeg } from '../../services/imageProcessing';
import { restoreErrorKey } from './backupErrors';
import { formatWhen } from './format';
import { useBackupStatus } from './useBackupStatus';
import s from './Backup.module.css';

type Phase = 'idle' | 'checking' | 'review' | 'restoring';
interface Note {
  kind: 'ok' | 'error';
  text: string;
}

const STEP_KEYS: Record<RestoreStep, MessageKey> = {
  preparing: 'restore.step.preparing',
  staging: 'restore.step.staging',
  committing: 'restore.step.committing',
  cleaning: 'restore.step.cleaning',
};

function percent(p: RestoreProgress | null): number {
  if (!p) return 0;
  if (p.step === 'committing' || p.step === 'cleaning') return 100;
  return p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
}

/**
 * Pick a file -> it is checked completely without writing anything -> the user sees what it holds, is advised to
 * make a safety backup, confirms in a strong dialog -> restore runs behind a blocking overlay. Any failure leaves
 * the journal exactly as it was (restoreBackup is atomic).
 */
export default function RestoreSection() {
  const titleId = useId();
  const overlayTitleId = useId();
  const supported = isRestoreSupported();
  const status = useBackupStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [checked, setChecked] = useState<{ done: number; total: number } | null>(null);
  const [opened, setOpened] = useState<OpenedBackup | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<RestoreProgress | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // so the same file can be chosen again later
    if (!file || busy.current) return;
    busy.current = true;
    setNote(null);
    setOpened(null);
    setChecked(null);
    setPhase('checking');
    try {
      const backup = await openBackup(file, (done, total) => setChecked({ done, total }));
      setOpened(backup);
      setPhase('review');
    } catch (err) {
      setNote({ kind: 'error', text: t(restoreErrorKey(err)) });
      setPhase('idle');
    } finally {
      busy.current = false;
    }
  };

  const restore = async () => {
    if (!opened || busy.current) return;
    busy.current = true;
    setConfirming(false);
    setNote(null);
    setStep(null);
    setPhase('restoring');
    try {
      const result = await restoreBackup(opened, defaultRestoreDeps(thumbnailFromJpeg), (progress) => setStep(progress));
      const text = t('restore.done', { entries: result.entries, tags: result.tags, photos: result.photos });
      setNote({ kind: 'ok', text: result.cleanupPending ? `${text} ${t('restore.done.cleanup')}` : text });
    } catch (err) {
      setNote({ kind: 'error', text: t(restoreErrorKey(err)) });
    } finally {
      setOpened(null);
      setStep(null);
      setPhase('idle');
      busy.current = false;
    }
  };

  const unprotected =
    status !== null && status.entryCount > 0 && (status.lastBackupAt === null || status.reminder.changedCount > 0);

  return (
    <section className={s.card} aria-labelledby={titleId}>
      <h3 id={titleId} className={s.title}>{t('restore.title')}</h3>
      <p className={s.text}>{t('restore.intro')}</p>

      {!supported && <p className={s.note}>{t('restore.unsupported')}</p>}

      {supported && phase === 'idle' && (
        <div className={s.actions}>
          <button type="button" className={s.secondary} onClick={() => fileInput.current?.click()}>{t('restore.choose')}</button>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        className={s.fileInput}
        onChange={onFile}
        tabIndex={-1}
        aria-hidden="true"
      />

      {phase === 'checking' && (
        <p className={s.progress} role="status">
          {checked && checked.total > 0
            ? t('restore.checkingProgress', { done: checked.done, total: checked.total })
            : t('restore.checking')}
        </p>
      )}

      {phase === 'review' && opened && (
        <div className={s.progress}>
          <h4 className={s.subtitle}>{t('restore.review.title')}</h4>
          <p className={s.text}>
            {t('restore.review.backup', {
              date: formatWhen(opened.manifest.createdAt),
              entries: opened.manifest.counts.entries,
              tags: opened.manifest.counts.tags,
              photos: opened.manifest.counts.photos,
            })}
          </p>
          {status && (
            <p className={s.meta}>{t('restore.review.device', { entries: status.entryCount, photos: status.photoCount })}</p>
          )}
          {unprotected && <p className={s.error}>{t('restore.review.unprotected')}</p>}
          <p className={s.text}>{t('restore.review.advice')}</p>
          <div className={s.actions}>
            <button type="button" className={s.danger} onClick={() => setConfirming(true)}>{t('restore.start')}</button>
            <button
              type="button"
              className={s.secondary}
              onClick={() => {
                setOpened(null);
                setPhase('idle');
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className={note.kind === 'error' ? s.error : s.note} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}

      {confirming && opened && (
        <ConfirmDialog
          tone="danger"
          title={t('restore.confirm.title')}
          message={t('restore.confirm.body', {
            date: formatWhen(opened.manifest.createdAt),
            entries: opened.manifest.counts.entries,
            photos: opened.manifest.counts.photos,
          })}
          confirmLabel={t('restore.confirm.yes')}
          cancelLabel={t('restore.confirm.no')}
          onConfirm={restore}
          onCancel={() => setConfirming(false)}
        />
      )}

      {phase === 'restoring' && (
        <div className={s.overlay}>
          <div className={s.panel} role="dialog" aria-modal="true" aria-labelledby={overlayTitleId} aria-busy="true">
            <h2 id={overlayTitleId} className={s.panelTitle}>{t('restore.progress.title')}</h2>
            <p className={s.text} aria-live="polite">
              {step
                ? t(STEP_KEYS[step.step], { current: Math.min(step.done + 1, Math.max(step.total, 1)), total: step.total })
                : t('restore.step.preparing')}
            </p>
            <div className={s.bar}>
              <div className={s.fill} style={{ width: `${percent(step)}%` }} />
            </div>
            <p className={s.meta}>{t('restore.progress.keepOpen')}</p>
          </div>
        </div>
      )}
    </section>
  );
}
