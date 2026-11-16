import { Link } from 'react-router-dom';
import { snoozeReminder } from '../../db/backupRepo';
import { t } from '../../i18n';
import { useBackupStatus } from './useBackupStatus';
import s from './Backup.module.css';

/** Shown on the Calendar when a backup is due (10+ changed entries, or 30 days). "Later" hides it for 24 hours. */
export default function ReminderBanner() {
  const status = useBackupStatus();
  if (!status || !status.reminder.due) return null;
  const { reminder, lastBackupAt } = status;
  const text =
    lastBackupAt === null
      ? t('reminder.never')
      : reminder.reason === 'changes'
        ? t('reminder.changes', { count: reminder.changedCount })
        : t('reminder.age', { days: reminder.daysSinceReference ?? 0 });

  return (
    <aside className={s.banner} aria-label={t('reminder.title')}>
      <p className={s.bannerTitle}>{t('reminder.title')}</p>
      <p className={s.bannerText}>{text}</p>
      <div className={s.bannerActions}>
        <Link to="/settings" className={s.bannerPrimary}>{t('reminder.action')}</Link>
        <button type="button" className={s.bannerGhost} onClick={() => void snoozeReminder().catch(() => undefined)}>
          {t('reminder.later')}
        </button>
      </div>
    </aside>
  );
}
