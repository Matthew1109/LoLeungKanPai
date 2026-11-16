import { useCallback, useRef } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { ChevronLeftIcon, PlusIcon } from '../../components/icons';
import { setEntryFavourite } from '../../db/entryRepo';
import type { DrinkEntry } from '../../db/schema';
import { getAppLocale, t, tn } from '../../i18n';
import { useDayEntries } from '../../hooks/useDayEntries';
import { useToast } from '../../hooks/useToast';
import { isValidDayKey, parseDayKey } from '../../utils/dates';
import { writeErrorKey } from '../add/formErrors';
import EntryCard from './EntryCard';
import s from './Journal.module.css';
import screen from '../../components/Screen.module.css';

export default function DailyJournal() {
  const { dayKey = '' } = useParams();
  if (!isValidDayKey(dayKey)) return <Navigate to="/" replace />;
  return <Journal dayKey={dayKey} />;
}

function Journal({ dayKey }: { dayKey: string }) {
  const navigate = useNavigate();
  const locale = getAppLocale();
  const date = parseDayKey(dayKey);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
  const { items, error } = useDayEntries(dayKey);
  const addHref = `/add?date=${dayKey}`;
  const { toast, showToast } = useToast();

  // The heart on a card. One write per entry at a time; the list refreshes itself when the write commits.
  const inFlight = useRef(new Set<string>());
  const toggleFavourite = useCallback(
    async (entry: DrinkEntry) => {
      if (inFlight.current.has(entry.id)) return;
      inFlight.current.add(entry.id);
      try {
        await setEntryFavourite(entry.id, !entry.isFavourite);
      } catch (err) {
        showToast(t(writeErrorKey(err, 'error.updateFailed')));
      } finally {
        inFlight.current.delete(entry.id);
      }
    },
    [showToast],
  );

  return (
    <div className={screen.screen}>
      <header className={s.bar}>
        <button className={s.back} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <ChevronLeftIcon width={22} height={22} />
          <span>{t('nav.calendar')}</span>
        </button>
      </header>

      <section className={s.hero}>
        <span className={s.weekday}>{weekday}</span>
        <h1 className={s.date}>
          <span className={s.day}>{date.getDate()}</span>
          <span className={s.monthYear}>{month}<em>{date.getFullYear()}</em></span>
        </h1>
        {items && items.length > 0 && <span className={s.count}>{tn('journal.entries', items.length)}</span>}
      </section>

      {error != null && <p style={{ padding: 20, color: 'var(--accent-hi)' }} role="alert">{t('calendar.loadError')}</p>}

      {items && items.length === 0 && (
        <EmptyState
          title={t('journal.empty.title')}
          body={t('journal.empty.body')}
          action={<Link to={addHref} className={s.primary}><PlusIcon width={18} height={18} />{t('journal.addDrink')}</Link>}
        />
      )}

      {items && items.length > 0 && (
        <>
          <div className={s.list}>
            {items.map((v, i) => <EntryCard key={v.entry.id} view={v} index={i} onToggleFavourite={toggleFavourite} />)}
          </div>
          <div className={s.addRow}>
            <Link to={addHref} className={s.primary}><PlusIcon width={18} height={18} />{t('journal.addDrink')}</Link>
          </div>
        </>
      )}
      {toast}
    </div>
  );
}
