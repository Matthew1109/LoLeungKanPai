import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n';
import s from './InstallHint.module.css';

/** Shown when a new version has been downloaded. Never reloads on its own, so an edit in progress is safe. */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <aside className={s.hint} role="status" style={{ bottom: 'auto', top: 'calc(var(--safe-top) + 12px)' }}>
      <div><strong>{t('update.ready')}</strong></div>
      <button onClick={() => updateServiceWorker(true)}>{t('update.reload')}</button>
    </aside>
  );
}
