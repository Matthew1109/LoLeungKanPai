import { useState } from 'react';
import { t } from '../i18n';
import s from './InstallHint.module.css';

const KEY = 'lkp.installHintDismissed'; // a UI preference only, never diary data

function shouldShow(): boolean {
  try {
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
    return isIos && !standalone && localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
}

/** iOS has no install prompt API, so in a Safari tab we show a one-line instruction. */
export default function InstallHint() {
  const [visible, setVisible] = useState(shouldShow);
  if (!visible) return null;
  return (
    <aside className={s.hint} role="note">
      <div>
        <strong>{t('install.title')}</strong>
        <p>{t('install.body')}</p>
      </div>
      <button
        onClick={() => {
          try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
          setVisible(false);
        }}
      >
        {t('install.dismiss')}
      </button>
    </aside>
  );
}
