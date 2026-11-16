import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeftIcon } from '../../components/icons';
import screen from '../../components/Screen.module.css';
import { createBar, listBarsWithCounts, renameBar, setBarArchived, type BarWithCount } from '../../db/barRepo';
import { useDataVersion } from '../../hooks/useDataVersion';
import { t, tn } from '../../i18n';
import type { MessageKey } from '../../i18n/locales/en';
import { barErrorKey } from './barErrors';
import s from './ManageBars.module.css';

/**
 * Settings > Bar management: add, rename, archive and restore the reusable bars. Tap a bar for its actions.
 * There is no delete: an archived bar is only left out of the drink form's suggestions, its drinks keep it.
 */
export default function ManageBars() {
  const version = useDataVersion();
  const [rows, setRows] = useState<BarWithCount[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const busyRef = useRef(false);

  // Every bar write notifies the data version, so the list refetches by itself after each change.
  useEffect(() => {
    let alive = true;
    listBarsWithCounts()
      .then((list) => {
        if (!alive) return;
        setRows(list);
        setState('ready');
      })
      .catch((err) => {
        console.warn('Could not read bars', err);
        if (alive) setState('failed');
      });
    return () => {
      alive = false;
    };
  }, [version]);

  // Active bars first; archived ones sit below them.
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
      setError(barErrorKey(err));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await act(() => createBar(newName))) setNewName('');
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    const id = renamingId;
    if (id === null) return;
    if (await act(() => renameBar(id, renameText))) setRenamingId(null);
  }

  return (
    <div className={screen.screen}>
      <header className={s.bar}>
        <Link to="/settings" className={s.back}>
          <ChevronLeftIcon width={22} height={22} />
          <span>{t('settings.title')}</span>
        </Link>
      </header>
      <h1 className={screen.pageTitle}>{t('bars.manage.title')}</h1>
      <p className={s.hint}>{t('bars.archiveHint')}</p>

      <section className={s.section}>
        <form className={s.addForm} onSubmit={add}>
          <input
            className={s.input}
            type="text"
            value={newName}
            placeholder={t('bars.add.placeholder')}
            aria-label={t('bars.add.placeholder')}
            autoCapitalize="words"
            autoComplete="off"
            onChange={(event) => {
              setNewName(event.target.value);
              setError(null);
            }}
          />
          <button type="submit" className={s.primary} disabled={busy || newName.trim() === ''}>{t('bars.add')}</button>
        </form>
        {error && <p className={s.error} role="alert">{t(error)}</p>}

        {state === 'failed' && <p className={s.error} role="alert">{t('bars.error.generic')}</p>}
        {state === 'ready' && ordered.length === 0 && <p className={s.empty}>{t('bars.empty')}</p>}

        {ordered.length > 0 && (
          <ul className={s.list}>
            {ordered.map((bar) =>
              renamingId === bar.id ? (
                <li key={bar.id} className={s.row}>
                  <form className={s.renameForm} onSubmit={saveRename}>
                    <input
                      className={s.input}
                      type="text"
                      value={renameText}
                      aria-label={t('bars.rename')}
                      autoCapitalize="words"
                      autoComplete="off"
                      onChange={(event) => {
                        setRenameText(event.target.value);
                        setError(null);
                      }}
                    />
                    {bar.entryCount > 0 && <p className={s.note}>{t('bars.rename.note', { drinks: tn('journal.entries', bar.entryCount) })}</p>}
                    <div className={s.renameActions}>
                      <button type="submit" className={s.primary} disabled={busy}>{t('form.save')}</button>
                      <button type="button" className={s.ghost} disabled={busy} onClick={() => setRenamingId(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={bar.id} className={s.row}>
                  <button
                    type="button"
                    className={s.rowBtn}
                    aria-expanded={openId === bar.id}
                    onClick={() => setOpenId(openId === bar.id ? null : bar.id)}
                  >
                    <span className={bar.isArchived ? `${s.name} ${s.nameArchived}` : s.name}>{bar.name}</span>
                    <span className={s.meta}>
                      {bar.isArchived ? `${t('bars.archived')} · ` : ''}
                      {tn('journal.entries', bar.entryCount)}
                    </span>
                  </button>
                  {openId === bar.id && (
                    <div className={s.panelActions}>
                      <button
                        type="button"
                        className={s.act}
                        disabled={busy}
                        onClick={() => {
                          setRenameText(bar.name);
                          setRenamingId(bar.id);
                          setError(null);
                        }}
                      >
                        {t('bars.rename')}
                      </button>
                      <button type="button" className={s.act} disabled={busy} onClick={() => void act(() => setBarArchived(bar.id, !bar.isArchived))}>
                        {bar.isArchived ? t('bars.restore') : t('bars.archive')}
                      </button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
