import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import { ChevronLeftIcon, CoupeIcon, HeartIcon, HeartOutlineIcon, PencilIcon, TrashIcon } from '../../components/icons';
import { deleteEntry, setEntryFavourite } from '../../db/entryRepo';
import type { DrinkEntry, Tag } from '../../db/schema';
import { useEntryDetail } from '../../hooks/useEntryDetail';
import { useToast } from '../../hooks/useToast';
import { getAppLocale, t } from '../../i18n';
import { CATEGORY_LABEL_KEYS, writeErrorKey } from '../add/formErrors';
import type { EditRouteState } from '../add/routeState';
import screen from '../../components/Screen.module.css';
import j from '../journal/Journal.module.css';
import s from './EntryDetail.module.css';

/** Route /entry/:id. */
export default function EntryDetail() {
  const { id = '' } = useParams();
  return <Detail key={id} id={id} />;
}

function Detail({ id }: { id: string }) {
  const navigate = useNavigate();
  const state = useEntryDetail(id);
  const { toast, showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [favouriteBusy, setFavouriteBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const deletingRef = useRef(false);
  const favouriteRef = useRef(false);

  // One step back when there is history; otherwise (the entry was opened directly) up to its day.
  const goBack = (dayKey: string | null) => {
    if (window.history.length > 1) navigate(-1);
    else navigate(dayKey ? `/day/${dayKey}` : '/', { replace: true });
  };

  const backButton = (dayKey: string | null) => (
    <header className={j.bar}>
      <button type="button" className={j.back} onClick={() => goBack(dayKey)}>
        <ChevronLeftIcon width={22} height={22} />
        <span>{t('nav.back')}</span>
      </button>
    </header>
  );

  const toggleFavourite = async (entry: DrinkEntry) => {
    if (favouriteRef.current) return;
    favouriteRef.current = true;
    setFavouriteBusy(true);
    try {
      await setEntryFavourite(entry.id, !entry.isFavourite);
    } catch (err) {
      showToast(t(writeErrorKey(err, 'error.updateFailed')));
    } finally {
      favouriteRef.current = false;
      setFavouriteBusy(false);
    }
  };

  const confirmDelete = async (entry: DrinkEntry) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteEntry(entry.id);
    } catch (err) {
      deletingRef.current = false;
      setDeleting(false);
      setConfirming(false);
      showToast(t(writeErrorKey(err, 'error.deleteFailed')));
      return;
    }
    setGone(true); // keeps "not found" from flashing while we navigate away
    goBack(entry.dayKey);
  };

  if (gone) return null;

  if (state.status === 'loading') return null;

  if (state.status === 'missing') {
    return (
      <div className={screen.screen}>
        {backButton(null)}
        <EmptyState
          title={t('entry.notFound.title')}
          body={t('entry.notFound.body')}
          action={<Link to="/" className={j.primary}>{t('entry.notFound.action')}</Link>}
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={screen.screen}>
        {backButton(null)}
        <p className={s.loadError} role="alert">{t('entry.loadError')}</p>
      </div>
    );
  }

  const { entry, photoUrl, baseSpirits, ingredients } = state;
  const locale = getAppLocale();
  const when = new Date(entry.dateTime);
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(when);
  const timeLabel = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(when);
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const title = entry.drinkName || t('journal.untitled');
  const chips: Array<Tag & { spirit: boolean }> = [
    ...baseSpirits.map((tag) => ({ ...tag, spirit: true })),
    ...ingredients.map((tag) => ({ ...tag, spirit: false })),
  ];
  const facts: Array<[string, string]> = [];
  if (entry.category) facts.push([t('entry.fact.category'), t(CATEGORY_LABEL_KEYS[entry.category])]);
  if (entry.alcoholPercentage !== null) facts.push([t('entry.fact.abv'), t('entry.value.abv', { value: numbers.format(entry.alcoholPercentage) })]);
  if (entry.alcoholVolumeMl !== null) facts.push([t('entry.fact.volume'), t('entry.value.volume', { value: numbers.format(entry.alcoholVolumeMl) })]);
  const editState: EditRouteState = { fromDetail: true, resumeDraft: false };

  return (
    <div className={screen.screen}>
      {backButton(entry.dayKey)}

      <div className={photoUrl ? s.photoWrap : `${s.photoWrap} ${s.noPhoto}`}>
        {photoUrl ? <img src={photoUrl} alt={title} className={s.photo} decoding="async" /> : <CoupeIcon width={56} height={56} />}
        <button
          type="button"
          className={entry.isFavourite ? `${s.heart} ${s.heartOn}` : s.heart}
          aria-pressed={entry.isFavourite}
          aria-label={entry.isFavourite ? t('favourite.remove') : t('favourite.add')}
          onClick={() => toggleFavourite(entry)}
          disabled={favouriteBusy}
        >
          <span className={s.heartDisc}>
            {entry.isFavourite ? <HeartIcon width={20} height={20} /> : <HeartOutlineIcon width={20} height={20} />}
          </span>
        </button>
      </div>

      <div className={s.body}>
        <p className={s.when}>
          <time dateTime={entry.dateTime}>{dateLabel}</time>
          <i aria-hidden="true">·</i>
          <span>{timeLabel}</span>
        </p>
        <h1 className={s.name}>{title}</h1>
        {entry.barName && <p className={s.place}>{entry.barName}</p>}

        {facts.length > 0 && (
          <dl className={s.facts}>
            {facts.map(([label, value]) => (
              <div key={label} className={s.fact}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {chips.length > 0 && (
          <ul className={j.chips}>
            {chips.map((tag) => (
              <li key={tag.id} className={tag.spirit ? `${j.chip} ${j.chipSpirit}` : j.chip}>{tag.name}</li>
            ))}
          </ul>
        )}

        {entry.notes && <p className={s.notes}>{entry.notes}</p>}

        <div className={s.actions}>
          <Link to={`/entry/${encodeURIComponent(entry.id)}/edit`} state={editState} className={j.primary}>
            <PencilIcon width={18} height={18} />
            {t('entry.edit')}
          </Link>
          <button type="button" className={s.delete} onClick={() => setConfirming(true)}>
            <TrashIcon width={18} height={18} />
            <span>{t('entry.delete')}</span>
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.body')}
          confirmLabel={t('delete.confirm')}
          cancelLabel={t('common.cancel')}
          tone="danger"
          busy={deleting}
          onConfirm={() => confirmDelete(entry)}
          onCancel={() => setConfirming(false)}
        />
      )}
      {toast}
    </div>
  );
}
