import { Link, Navigate, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import type { DrinkEntry } from '../../db/schema';
import { useLibrary, type Library } from '../../hooks/useLibrary';
import { t, tn } from '../../i18n';
import {
  COLLECTION_EMPTY_KEYS,
  COLLECTION_TITLE_KEYS,
  entriesWithTag,
  favouriteEntries,
  isTagKind,
  parseCollectionKind,
  recentlyAdded,
  tagCategoryOf,
  tagCounts,
  type CollectionKind,
} from './collectionsModel';
import EntryRow from './EntryRow';
import screen from '../../components/Screen.module.css';
import s from './Collections.module.css';

/**
 * Routes /collections/:kind and /collections/:kind/:tagId.
 * spirits / ingredients: the tags in use, then (after tapping one) the drinks that use it.
 * favourites / recent: the drinks themselves.
 */
export default function CollectionScreen() {
  const { kind: kindParam, tagId } = useParams();
  const kind = parseCollectionKind(kindParam);
  if (!kind) return <Navigate to="/collections" replace />;
  return <Collection kind={kind} tagId={isTagKind(kind) ? tagId : undefined} />;
}

function Collection({ kind, tagId }: { kind: CollectionKind; tagId: string | undefined }) {
  const { library, failed } = useLibrary();
  const parent = tagId ? `/collections/${kind}` : '/collections';
  const tag = tagId && library ? library.tags.get(tagId) : undefined;
  // A tag page waits for the library, so the collection's name does not flash before the tag's name.
  const title = tagId ? (library ? (tag?.name ?? t(COLLECTION_TITLE_KEYS[kind])) : '') : t(COLLECTION_TITLE_KEYS[kind]);

  return (
    <div className={screen.screen}>
      <header className={s.bar}>
        <Link to={parent} className={s.back}>
          <ChevronLeftIcon width={22} height={22} />
          <span>{tagId ? t(COLLECTION_TITLE_KEYS[kind]) : t('nav.collections')}</span>
        </Link>
      </header>
      <h1 className={`${screen.pageTitle} ${s.title}`}>{title}</h1>

      {failed && !library && <p className={s.error} role="alert">{t('collections.loadError')}</p>}
      {library && <Body library={library} kind={kind} tagId={tagId} />}
    </div>
  );
}

function Body({ library, kind, tagId }: { library: Library; kind: CollectionKind; tagId: string | undefined }) {
  if (isTagKind(kind) && !tagId) {
    const rows = tagCounts(library.entries, library.tags, tagCategoryOf(kind));
    if (rows.length === 0) return <EmptyState title={t('collections.empty.title')} body={t(COLLECTION_EMPTY_KEYS[kind])} />;
    return (
      <ul className={s.list}>
        {rows.map(({ tag, count }) => (
          <li key={tag.id} className={s.item}>
            <Link to={`/collections/${kind}/${encodeURIComponent(tag.id)}`} className={s.hubLink}>
              <span className={s.hubText}>
                <span className={s.hubTitle}>{tag.name}</span>
                {tag.isArchived && <span className={s.hubHint}>{t('tags.archived')}</span>}
              </span>
              <span className={s.hubCount}>{count}</span>
              <ChevronRightIcon width={18} height={18} className={s.chevron} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  let entries: DrinkEntry[];
  if (isTagKind(kind) && tagId) entries = entriesWithTag(library.entries, tagCategoryOf(kind), tagId);
  else if (kind === 'favourites') entries = favouriteEntries(library.entries);
  else entries = recentlyAdded(library.entries);

  if (entries.length === 0) {
    return <EmptyState title={t('collections.empty.title')} body={t(tagId ? 'collections.empty.tag' : COLLECTION_EMPTY_KEYS[kind])} />;
  }
  return (
    <>
      <p className={s.countLine}>{tn('journal.entries', entries.length)}</p>
      <ul className={s.list}>
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} thumbUrl={entry.photoId ? library.thumbs.get(entry.photoId) : undefined} />
        ))}
      </ul>
    </>
  );
}
