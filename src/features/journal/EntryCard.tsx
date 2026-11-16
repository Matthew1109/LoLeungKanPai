import { Link } from 'react-router-dom';
import { CoupeIcon, HeartIcon, HeartOutlineIcon } from '../../components/icons';
import type { DrinkEntry } from '../../db/schema';
import { getAppLocale, t } from '../../i18n';
import type { DayEntryView } from '../../hooks/useDayEntries';
import s from './Journal.module.css';

interface Props {
  view: DayEntryView;
  index: number;
  /** The heart. The parent owns the write and reports failures. */
  onToggleFavourite: (entry: DrinkEntry) => void;
}

export default function EntryCard({ view, index, onToggleFavourite }: Props) {
  const { entry, photoUrl, baseSpirits, ingredients } = view;
  const time = new Intl.DateTimeFormat(getAppLocale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(entry.dateTime));
  const tags = [...baseSpirits.map((x) => ({ ...x, kind: 'spirit' })), ...ingredients.map((x) => ({ ...x, kind: 'ingredient' }))];

  return (
    <article className={s.card} style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}>
      <Link to={`/entry/${encodeURIComponent(entry.id)}`} className={s.cardLink}>
        <div className={photoUrl ? s.photoWrap : `${s.photoWrap} ${s.noPhoto}`}>
          {photoUrl ? <img src={photoUrl} alt={entry.drinkName || t('journal.untitled')} className={s.photo} decoding="async" /> : <CoupeIcon width={40} height={40} />}
        </div>
        <div className={s.body}>
          <p className={s.meta}>
            <time dateTime={entry.dateTime}>{time}</time>
            {entry.barName && <><i aria-hidden="true">·</i><span>{entry.barName}</span></>}
          </p>
          <h2 className={s.name}>{entry.drinkName || t('journal.untitled')}</h2>
          {tags.length > 0 && (
            <ul className={s.chips}>
              {tags.map((tag) => (
                <li key={tag.id} className={tag.kind === 'spirit' ? `${s.chip} ${s.chipSpirit}` : s.chip}>{tag.name}</li>
              ))}
            </ul>
          )}
          {entry.notes && <p className={s.notes}>{entry.notes}</p>}
        </div>
      </Link>
      {/* A sibling of the link, not inside it: tapping the heart must never open the entry. */}
      <button
        type="button"
        className={entry.isFavourite ? `${s.heartBtn} ${s.heartOn}` : s.heartBtn}
        aria-pressed={entry.isFavourite}
        aria-label={entry.isFavourite ? t('favourite.remove') : t('favourite.add')}
        onClick={() => onToggleFavourite(entry)}
      >
        <span className={s.heartDisc}>
          {entry.isFavourite ? <HeartIcon width={17} height={17} /> : <HeartOutlineIcon width={17} height={17} />}
        </span>
      </button>
    </article>
  );
}
