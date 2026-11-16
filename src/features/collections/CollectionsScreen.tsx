import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { ChevronRightIcon } from '../../components/icons';
import { useLibrary, type Library } from '../../hooks/useLibrary';
import { t, tn } from '../../i18n';
import {
  COLLECTION_HINT_KEYS,
  COLLECTION_KINDS,
  COLLECTION_TITLE_KEYS,
  RECENT_LIMIT,
  favouriteEntries,
  tagCounts,
  type CollectionKind,
} from './collectionsModel';
import { searchEntries, searchTerms } from './searchModel';
import EntryRow from './EntryRow';
import screen from '../../components/Screen.module.css';
import s from './Collections.module.css';

/** The number shown beside each collection: tags for the two tag collections, drinks for the other two. */
function collectionCounts(library: Library): Record<CollectionKind, number> {
  return {
    spirits: tagCounts(library.entries, library.tags, 'BASE_SPIRIT').length,
    ingredients: tagCounts(library.entries, library.tags, 'INGREDIENT').length,
    favourites: favouriteEntries(library.entries).length,
    recent: Math.min(library.entries.length, RECENT_LIMIT),
  };
}

/** Route /collections: the four collections, with the global search on top. */
export default function CollectionsScreen() {
  const { library, failed } = useLibrary();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');

  // The query rides in the address (replace, debounced) so Back from a found drink returns to the same search.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== query) setParams(query ? { q: query } : {}, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, params, setParams]);

  const searching = searchTerms(query).length > 0;
  const counts = library && !searching ? collectionCounts(library) : null;
  const results = useMemo(
    () => (library && searching ? searchEntries(library.entries, library.tags, query) : []),
    [library, searching, query],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // lowers the keyboard
  }

  return (
    <div className={screen.screen}>
      <header className={screen.top}>
        <span className={screen.brand}>{t('app.name')}</span>
      </header>
      <h1 className={screen.pageTitle}>{t('nav.collections')}</h1>

      <form className={s.searchWrap} role="search" onSubmit={submit}>
        <input
          className={s.search}
          type="search"
          value={query}
          placeholder={t('collections.search.placeholder')}
          aria-label={t('collections.search.label')}
          enterKeyHint="search"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query !== '' && (
          <button type="button" className={s.clear} aria-label={t('collections.search.clear')} onClick={() => setQuery('')}>
            ×
          </button>
        )}
      </form>

      {failed && !library && <p className={s.error} role="alert">{t('collections.loadError')}</p>}

      {library && searching && (
        results.length === 0 ? (
          <p className={s.note}>{t('collections.search.empty', { query: query.trim() })}</p>
        ) : (
          <>
            <p className={s.countLine}>{tn('journal.entries', results.length)}</p>
            <ul className={s.list}>
              {results.map((entry) => (
                <EntryRow key={entry.id} entry={entry} thumbUrl={entry.photoId ? library.thumbs.get(entry.photoId) : undefined} />
              ))}
            </ul>
          </>
        )
      )}

      {library && counts && library.entries.length === 0 && (
        <EmptyState title={t('collections.empty.title')} body={t('collections.empty.recent')} />
      )}

      {library && counts && library.entries.length > 0 && (
        <ul className={s.list}>
          {COLLECTION_KINDS.map((kind) => (
            <li key={kind} className={s.item}>
              <Link to={`/collections/${kind}`} className={s.hubLink}>
                <span className={s.hubText}>
                  <span className={s.hubTitle}>{t(COLLECTION_TITLE_KEYS[kind])}</span>
                  <span className={s.hubHint}>{t(COLLECTION_HINT_KEYS[kind])}</span>
                </span>
                <span className={s.hubCount}>{counts[kind]}</span>
                <ChevronRightIcon width={18} height={18} className={s.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
