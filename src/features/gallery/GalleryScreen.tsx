import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { CoupeIcon, HeartIcon, HeartOutlineIcon } from '../../components/icons';
import { useLibrary, type Library } from '../../hooks/useLibrary';
import { getAppLocale, t, tn } from '../../i18n';
import { tagCounts, type TagCount } from '../collections/collectionsModel';
import FilterSheet from './FilterSheet';
import {
  availableYears,
  countActiveFilters,
  emptyFilters,
  filtersFromParams,
  filtersToParams,
  galleryEntries,
  hasPhoto,
  removeFilter,
  type FilterRef,
  type GalleryFilters,
} from './galleryFilter';
import screen from '../../components/Screen.module.css';
import tf from '../tags/TagField.module.css';
import s from './Gallery.module.css';

/** Where the grid was scrolled to when the user left it (to open a drink), so Back returns to the same place. */
let remembered: { search: string; y: number } | null = null;

/** The tags that can be ticked: those a photographed drink uses, plus any already ticked (so they can be unticked). */
function withTicked(options: TagCount[], ticked: string[], library: Library): TagCount[] {
  const extra: TagCount[] = [];
  for (const id of ticked) {
    const tag = library.tags.get(id);
    if (tag && !options.some((option) => option.tag.id === id)) extra.push({ tag, count: 0 });
  }
  return extra.length === 0 ? options : [...options, ...extra].sort((a, b) => a.tag.name.localeCompare(b.tag.name, 'en', { sensitivity: 'base' }));
}

/** Route /gallery: photographed drinks in a three-column grid, newest first, with filters. */
export default function GalleryScreen() {
  const { library, failed } = useLibrary();
  const [params, setParams] = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const search = params.toString();
  const searchRef = useRef(search);
  searchRef.current = search;
  const readyRef = useRef(false);
  readyRef.current = library !== null;

  const update = (next: GalleryFilters) => setParams(filtersToParams(next), { replace: true });

  // Leaving (to open a drink): keep the scroll position. Only once the grid was shown, so React's development
  // double-mount cannot overwrite it. The layout cleanup runs before the page is torn down.
  useLayoutEffect(
    () => () => {
      if (readyRef.current) remembered = { search: searchRef.current, y: window.scrollY };
    },
    [],
  );
  const ready = library !== null;
  useLayoutEffect(() => {
    if (!ready) return;
    if (remembered && remembered.search === searchRef.current) window.scrollTo(0, remembered.y);
    remembered = null;
  }, [ready]);

  const photographed = useMemo(() => (library ? library.entries.filter(hasPhoto) : []), [library]);
  const shown = useMemo(() => galleryEntries(photographed, filters), [photographed, filters]);

  const header = (
    <>
      <header className={screen.top}>
        <span className={screen.brand}>{t('app.name')}</span>
      </header>
      <h1 className={screen.pageTitle}>{t('nav.gallery')}</h1>
    </>
  );

  if (!library) {
    return (
      <div className={screen.screen}>
        {header}
        {failed && <p className={s.error} role="alert">{t('gallery.loadError')}</p>}
      </div>
    );
  }

  const active = countActiveFilters(filters);
  const monthName = (month: number) => new Intl.DateTimeFormat(getAppLocale(), { month: 'long' }).format(new Date(2000, month - 1, 1));
  const tagName = (id: string) => library.tags.get(id)?.name ?? t('gallery.unknownTag');
  // Favourites is a chip in the bar itself; the removable chips below are the other active filters.
  const chips: Array<{ key: string; label: string; ref: FilterRef }> = [];
  if (filters.year !== null) chips.push({ key: 'year', label: String(filters.year), ref: { kind: 'year' } });
  if (filters.month !== null) chips.push({ key: 'month', label: monthName(filters.month), ref: { kind: 'month' } });
  for (const id of filters.spiritIds) chips.push({ key: `s-${id}`, label: tagName(id), ref: { kind: 'spirit', id } });
  for (const id of filters.ingredientIds) chips.push({ key: `i-${id}`, label: tagName(id), ref: { kind: 'ingredient', id } });

  const years = availableYears(photographed);
  if (filters.year !== null && !years.includes(filters.year)) years.push(filters.year);
  years.sort((a, b) => b - a);

  return (
    <div className={screen.screen}>
      {header}

      {photographed.length === 0 ? (
        <EmptyState title={t('gallery.empty.title')} body={t('gallery.empty.body')} />
      ) : (
        <>
          <div className={s.bar}>
            <button
              type="button"
              className={active > 0 ? `${tf.chip} ${tf.chipOn}` : tf.chip}
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              {active > 0 ? t('gallery.filtersActive', { count: active }) : t('gallery.filters')}
            </button>
            <button
              type="button"
              className={filters.favouritesOnly ? `${tf.chip} ${tf.chipOn}` : tf.chip}
              aria-pressed={filters.favouritesOnly}
              onClick={() => update({ ...filters, favouritesOnly: !filters.favouritesOnly })}
            >
              {filters.favouritesOnly ? <HeartIcon width={16} height={16} /> : <HeartOutlineIcon width={16} height={16} />}
              <span>{t('gallery.favourites')}</span>
            </button>
            {active > 0 && (
              <button type="button" className={s.clearAll} onClick={() => update(emptyFilters())}>
                {t('gallery.clearAll')}
              </button>
            )}
          </div>

          {chips.length > 0 && (
            <ul className={s.chips}>
              {chips.map((chip) => (
                <li key={chip.key}>
                  <button
                    type="button"
                    className={`${tf.chip} ${tf.chipOn}`}
                    aria-label={t('gallery.removeFilter', { name: chip.label })}
                    onClick={() => update(removeFilter(filters, chip.ref))}
                  >
                    <span>{chip.label}</span>
                    <span className={tf.x} aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {shown.length === 0 ? (
            <EmptyState
              title={t('gallery.noMatch.title')}
              body={t('gallery.noMatch.body')}
              action={
                <button type="button" className={s.clearAll} onClick={() => update(emptyFilters())}>
                  {t('gallery.noMatch.action')}
                </button>
              }
            />
          ) : (
            <>
              <p className={s.count}>{tn('journal.entries', shown.length)}</p>
              <ul className={s.grid}>
                {shown.map((entry) => {
                  const url = entry.photoId ? library.thumbs.get(entry.photoId) : undefined;
                  return (
                    <li key={entry.id} className={s.cell}>
                      <Link to={`/entry/${encodeURIComponent(entry.id)}`} className={s.link} aria-label={entry.drinkName || t('journal.untitled')}>
                        {url ? <img src={url} alt="" className={s.thumb} loading="lazy" decoding="async" /> : <CoupeIcon width={26} height={26} />}
                      </Link>
                      {entry.isFavourite && <HeartIcon width={14} height={14} className={s.fav} />}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {sheetOpen && (
        <FilterSheet
          filters={filters}
          years={years}
          spirits={withTicked(tagCounts(photographed, library.tags, 'BASE_SPIRIT'), filters.spiritIds, library)}
          ingredients={withTicked(tagCounts(photographed, library.tags, 'INGREDIENT'), filters.ingredientIds, library)}
          onChange={update}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
