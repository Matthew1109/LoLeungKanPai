import { useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_VERSION_LABEL } from '../../appVersion';
import { ChevronRightIcon } from '../../components/icons';
import { t } from '../../i18n';
import { DEV_TOOLS_ENABLED, eraseEverything, seedDemoData } from '../../dev/devSeed';
import BackupSection from '../backup/BackupSection';
import RestoreSection from '../backup/RestoreSection';
import screen from '../../components/Screen.module.css';
import s from './Settings.module.css';

const VERSION = APP_VERSION_LABEL;

export default function Settings() {
  const [status, setStatus] = useState<string>('');

  const run = async (fn: () => Promise<void>) => {
    setStatus(t('settings.dev.working'));
    try {
      await fn();
      setStatus(t('settings.dev.done'));
    } catch (e) {
      setStatus(String(e));
    }
  };

  return (
    <div className={screen.screen}>
      <h1 className={screen.pageTitle}>{t('settings.title')}</h1>

      <section className={s.warning} role="note">
        <h2>{t('settings.backupWarning.title')}</h2>
        <p>{t('settings.backupWarning.body')}</p>
      </section>

      <BackupSection />
      <RestoreSection />

      <ul className={`${s.list} ${s.listGap}`}>
        <li className={`${s.row} ${s.rowLinkItem}`}>
          <Link to="/settings/tags" className={s.rowLink}>
            <span>{t('settings.section.tags')}</span>
            <ChevronRightIcon width={20} height={20} />
          </Link>
        </li>
        <li className={s.row}>
          <span>{t('settings.section.storage')}</span>
          <span className={s.badge}>{t('settings.comingPhase', { phase: 5 })}</span>
        </li>
      </ul>

      <section className={s.block}>
        <h3>{t('settings.section.privacy')}</h3>
        <p>{t('settings.privacy.body')}</p>
      </section>
      <section className={s.block}>
        <h3>{t('settings.section.about')}</h3>
        <p>{t('settings.about.body', { version: VERSION })}</p>
      </section>

      {DEV_TOOLS_ENABLED && (
        <section className={s.block}>
          <h3>{t('settings.dev.title')}</h3>
          <div className={s.devRow}>
            <button className={s.devBtn} onClick={() => run(seedDemoData)}>{t('settings.dev.seed')}</button>
            <button
              className={s.devBtn}
              onClick={() => window.confirm(t('settings.dev.clearConfirm')) && run(eraseEverything)}
            >
              {t('settings.dev.clear')}
            </button>
          </div>
          {status && <p className={s.status}>{status}</p>}
        </section>
      )}
    </div>
  );
}
