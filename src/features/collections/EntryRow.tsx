import { Link } from 'react-router-dom';
import { CoupeIcon, HeartIcon } from '../../components/icons';
import type { DrinkEntry } from '../../db/schema';
import { getAppLocale, t } from '../../i18n';
import s from './Collections.module.css';

/** One drink in a list: small photo, name, date and bar. The whole row opens the drink. */
export default function EntryRow({ entry, thumbUrl }: { entry: DrinkEntry; thumbUrl: string | undefined }) {
  const date = new Intl.DateTimeFormat(getAppLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(entry.dateTime));
  return (
    <li className={s.item}>
      <Link to={`/entry/${encodeURIComponent(entry.id)}`} className={s.row}>
        <span className={s.thumb}>
          {thumbUrl ? <img src={thumbUrl} alt="" className={s.thumbImg} loading="lazy" decoding="async" /> : <CoupeIcon width={24} height={24} />}
        </span>
        <span className={s.rowText}>
          <span className={s.rowName}>{entry.drinkName || t('journal.untitled')}</span>
          <span className={s.rowSub}>
            <time dateTime={entry.dateTime}>{date}</time>
            {entry.barName ? ` · ${entry.barName}` : ''}
          </span>
        </span>
        {entry.isFavourite && <HeartIcon width={16} height={16} className={s.rowHeart} />}
      </Link>
    </li>
  );
}
