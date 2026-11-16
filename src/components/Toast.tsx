import { t } from '../i18n';
import s from './Toast.module.css';

/** A short error/notice pinned above the tab bar. Shown through useToast (hooks/useToast.tsx). */
export default function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className={s.toast} role="alert">
      <span className={s.text}>{message}</span>
      <button type="button" className={s.close} onClick={onDismiss}>{t('common.dismiss')}</button>
    </div>
  );
}
