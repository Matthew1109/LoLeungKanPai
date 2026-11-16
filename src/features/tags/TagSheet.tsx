import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PlusIcon } from '../../components/icons';
import type { Tag, TagCategory } from '../../db/schema';
import { ensureTag, listTags } from '../../db/tagRepo';
import { useDataVersion } from '../../hooks/useDataVersion';
import { t } from '../../i18n';
import type { MessageKey } from '../../i18n/locales/en';
import { nameKey } from '../../utils/normalise';
import { tagErrorKey } from './tagErrors';
import { exactMatch, matchTags, toggleId } from './tagPickerModel';
import s from './TagField.module.css';

interface Props {
  category: TagCategory;
  title: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Bottom sheet for choosing tags: tick any number of the saved tags, search them, or type a new name to create it.
 * Archived tags are not offered, except ones this drink already has (shown as "Archived" so they can be unticked).
 * Typing the name of an archived tag brings that tag back rather than failing as a duplicate.
 */
export default function TagSheet({ category, title, selectedIds, onChange, onClose }: Props) {
  const titleId = useId();
  const version = useDataVersion();
  const sheetRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const busyRef = useRef(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  useEffect(() => {
    let alive = true;
    listTags(category, { includeArchived: true })
      .then((rows) => {
        if (!alive) return;
        setTags(rows);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn('Could not read tags', err);
        if (!alive) return;
        setLoaded(true);
        setError('tags.error.generic');
      });
    return () => {
      alive = false;
    };
  }, [category, version]);

  // Focus the sheet itself, not the search field: the keyboard stays down until the user taps the field.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = tags.filter((tag) => !tag.isArchived || selectedIds.includes(tag.id));
  const shown = matchTags(visible, query);
  const canCreate = nameKey(query) !== '' && exactMatch(visible, query) === undefined;

  async function create() {
    if (busyRef.current || !canCreate) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const tag = await ensureTag(query, category);
      setQuery('');
      if (!selectedRef.current.includes(tag.id)) onChange([...selectedRef.current, tag.id]);
    } catch (err) {
      setError(tagErrorKey(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void create();
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div
        ref={sheetRef}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={s.sheetHead}>
          <h2 id={titleId} className={s.sheetTitle}>{title}</h2>
          <button type="button" className={s.done} onClick={onClose}>{t('tags.sheet.done')}</button>
        </div>

        <form className={s.searchWrap} onSubmit={submit}>
          <input
            className={s.input}
            type="text"
            value={query}
            placeholder={t('tags.sheet.search')}
            aria-label={t('tags.sheet.search')}
            enterKeyHint="done"
            autoCapitalize="words"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
          />
        </form>

        <div className={s.body}>
          {canCreate && (
            <button type="button" className={s.create} onClick={() => void create()} disabled={busy}>
              <PlusIcon width={16} height={16} aria-hidden="true" />
              <span>{t('tags.sheet.create', { name: query.replace(/\s+/g, ' ').trim() })}</span>
            </button>
          )}
          {error && <p className={s.error} role="alert">{t(error)}</p>}
          {loaded && shown.length === 0 && !canCreate && <p className={s.empty}>{t('tags.sheet.empty')}</p>}
          {shown.length > 0 && (
            <ul className={s.options}>
              {shown.map((tag) => {
                const on = selectedIds.includes(tag.id);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={on ? `${s.option} ${s.optionOn}` : s.option}
                      onClick={() => onChange(toggleId(selectedRef.current, tag.id))}
                    >
                      <span className={s.box} aria-hidden="true">{on ? '✓' : ''}</span>
                      <span className={s.optName}>{tag.name}</span>
                      {tag.isArchived && <span className={s.optBadge}>{t('tags.archived')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
