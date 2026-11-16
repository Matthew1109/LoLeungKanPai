import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { TagCategory } from '../../db/schema';
import { createTag, deleteTag, listTagsWithCounts, renameTag, setTagArchived, type TagWithCount } from '../../db/tagRepo';
import { useDataVersion } from '../../hooks/useDataVersion';
import { t, tn } from '../../i18n';
import type { MessageKey } from '../../i18n/locales/en';
import { tagErrorKey } from './tagErrors';
import s from './ManageTags.module.css';

interface Props {
  category: TagCategory;
  title: string;
  placeholder: string;
}

/** One category's tags: an add field, then the list. Tap a tag for its actions (rename, archive/restore, delete). */
export default function TagSection({ category, title, placeholder }: Props) {
  const version = useDataVersion();
  const [rows, setRows] = useState<TagWithCount[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<TagWithCount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const busyRef = useRef(false);

  // Every tag write notifies the data version, so the list refetches by itself after each change.
  useEffect(() => {
    let alive = true;
    listTagsWithCounts(category)
      .then((list) => {
        if (!alive) return;
        setRows(list);
        setState('ready');
      })
      .catch((err) => {
        console.warn('Could not read tags', err);
        if (alive) setState('failed');
      });
    return () => {
      alive = false;
    };
  }, [category, version]);

  // Active tags first; archived ones sit below them.
  const ordered = useMemo(() => [...rows.filter((row) => !row.isArchived), ...rows.filter((row) => row.isArchived)], [rows]);

  /** One change at a time. Resolves true when it succeeded; on failure the reason is shown under the add field. */
  async function act(work: () => Promise<unknown>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(tagErrorKey(err));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await act(() => createTag(newName, category))) setNewName('');
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    const id = renamingId;
    if (id === null) return;
    if (await act(() => renameTag(id, renameText))) setRenamingId(null);
  }

  async function confirmDelete() {
    const tag = deleting;
    if (!tag) return;
    await act(() => deleteTag(tag.id));
    setDeleting(null);
    setOpenId(null);
  }

  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>{title}</h2>

      <form className={s.addForm} onSubmit={add}>
        <input
          className={s.input}
          type="text"
          value={newName}
          placeholder={placeholder}
          aria-label={placeholder}
          autoCapitalize="words"
          autoComplete="off"
          onChange={(event) => {
            setNewName(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className={s.primary} disabled={busy || newName.trim() === ''}>{t('tags.add')}</button>
      </form>
      {error && <p className={s.error} role="alert">{t(error)}</p>}

      {state === 'failed' && <p className={s.error} role="alert">{t('tags.error.generic')}</p>}
      {state === 'ready' && ordered.length === 0 && <p className={s.empty}>{t('tags.empty')}</p>}

      {ordered.length > 0 && (
        <ul className={s.list}>
          {ordered.map((tag) =>
            renamingId === tag.id ? (
              <li key={tag.id} className={s.row}>
                <form className={s.renameForm} onSubmit={saveRename}>
                  <input
                    className={s.input}
                    type="text"
                    value={renameText}
                    aria-label={t('tags.rename')}
                    autoCapitalize="words"
                    autoComplete="off"
                    onChange={(event) => {
                      setRenameText(event.target.value);
                      setError(null);
                    }}
                  />
                  <div className={s.renameActions}>
                    <button type="submit" className={s.primary} disabled={busy}>{t('form.save')}</button>
                    <button type="button" className={s.ghost} disabled={busy} onClick={() => setRenamingId(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={tag.id} className={s.row}>
                <button
                  type="button"
                  className={s.rowBtn}
                  aria-expanded={openId === tag.id}
                  onClick={() => setOpenId(openId === tag.id ? null : tag.id)}
                >
                  <span className={tag.isArchived ? `${s.name} ${s.nameArchived}` : s.name}>{tag.name}</span>
                  <span className={s.meta}>
                    {tag.isArchived ? `${t('tags.archived')} · ` : ''}
                    {tn('journal.entries', tag.entryCount)}
                  </span>
                </button>
                {openId === tag.id && (
                  <div className={s.panelActions}>
                    <button
                      type="button"
                      className={s.act}
                      disabled={busy}
                      onClick={() => {
                        setRenameText(tag.name);
                        setRenamingId(tag.id);
                        setError(null);
                      }}
                    >
                      {t('tags.rename')}
                    </button>
                    <button type="button" className={s.act} disabled={busy} onClick={() => void act(() => setTagArchived(tag.id, !tag.isArchived))}>
                      {tag.isArchived ? t('tags.restore') : t('tags.archive')}
                    </button>
                    {tag.entryCount === 0 && (
                      <button type="button" className={`${s.act} ${s.actDanger}`} disabled={busy} onClick={() => setDeleting(tag)}>
                        {t('tags.delete')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('tags.delete.title', { name: deleting.name })}
          message={t('tags.delete.body')}
          confirmLabel={t('tags.delete.confirm')}
          cancelLabel={t('common.cancel')}
          tone="danger"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
