import type { ReactNode } from 'react';
import { CoupeIcon } from './icons';
import s from './EmptyState.module.css';

export default function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className={s.wrap}>
      <CoupeIcon width={44} height={44} className={s.icon} />
      <h2 className={s.title}>{title}</h2>
      <p className={s.body}>{body}</p>
      {action}
    </div>
  );
}
