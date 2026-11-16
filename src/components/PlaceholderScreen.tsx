import EmptyState from './EmptyState';
import { t } from '../i18n';
import s from './Screen.module.css';

export default function PlaceholderScreen({ title, body, extra }: { title: string; body: string; extra?: string }) {
  return (
    <div className={s.screen}>
      <header className={s.top}>
        <span className={s.brand}>{t('app.name')}</span>
      </header>
      <h1 className={s.pageTitle}>{title}</h1>
      {extra && <p style={{ padding: '0 20px', color: 'var(--text-2)', fontSize: 14 }}>{extra}</p>}
      <EmptyState title={title} body={body} />
    </div>
  );
}
