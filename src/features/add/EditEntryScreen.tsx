import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import { clearEntryDraftFor, getEntryDraft } from '../../db/draftRepo';
import type { EntryDraft, EntryDraftFields } from '../../db/entryDraft';
import { getEntry } from '../../db/entryRepo';
import { getPhotos } from '../../db/photoRepo';
import type { DrinkEntry } from '../../db/schema';
import { useUrlBag } from '../../hooks/useUrlBag';
import { getAppLocale, t } from '../../i18n';
import { decideDraftForEdit, formatDraftTime } from './draftModel';
import { fieldsFromEntry } from './entryFormModel';
import EntryForm from './EntryForm';
import { readEditRouteState } from './routeState';
import screen from '../../components/Screen.module.css';
import j from '../journal/Journal.module.css';

type EditState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'prompt'; entry: DrinkEntry; photoUrl: string | null; draft: EntryDraft }
  | { kind: 'form'; entry: DrinkEntry; photoUrl: string | null; initial: EntryDraftFields };

/** Route /entry/:id/edit. */
export default function EditEntryScreen() {
  const { id = '' } = useParams();
  return <EditEntry key={id} id={id} />;
}

function EditEntry({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { fromDetail, resumeDraft } = readEditRouteState(location.state);
  const bag = useUrlBag();
  const [state, setState] = useState<EditState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Loads the entry and its photo once. The form must not be reset by later data changes, so there is no
  // data-version subscription here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entry = await getEntry(id);
      if (!entry) {
        if (!cancelled) setState({ kind: 'missing' });
        return;
      }
      const [photos, draft] = await Promise.all([getPhotos(entry.photoId ? [entry.photoId] : []), getEntryDraft()]);
      const decision = decideDraftForEdit(draft, entry);
      if (decision.kind === 'discard') await clearEntryDraftFor(entry.id); // ours, but stale: it can never be resumed
      if (cancelled) return;

      const record = entry.photoId ? photos.get(entry.photoId) : undefined;
      const photoUrl = record ? URL.createObjectURL(record.blob) : null;
      bag(photoUrl ? [photoUrl] : []);

      if (decision.kind === 'offer' && !resumeDraft) setState({ kind: 'prompt', entry, photoUrl, draft: decision.draft });
      else if (decision.kind === 'offer') setState({ kind: 'form', entry, photoUrl, initial: decision.draft.fields });
      else setState({ kind: 'form', entry, photoUrl, initial: fieldsFromEntry(entry) });
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setState({ kind: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [id, attempt, bag, resumeDraft]);

  // Back to where the user came from: the detail screen is one step back when they opened Edit from it.
  const finish = () => {
    if (fromDetail) navigate(-1);
    else navigate(`/entry/${encodeURIComponent(id)}`, { replace: true });
  };

  if (state.kind === 'missing') {
    return (
      <div className={screen.screen}>
        <EmptyState
          title={t('entry.notFound.title')}
          body={t('entry.notFound.body')}
          action={<Link to="/" className={j.primary}>{t('entry.notFound.action')}</Link>}
        />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className={screen.screen}>
        <EmptyState
          title={t('error.storage.title')}
          body={t('entry.loadError')}
          action={<button type="button" className={j.primary} onClick={() => { setState({ kind: 'loading' }); setAttempt((n) => n + 1); }}>{t('error.retry')}</button>}
        />
      </div>
    );
  }

  if (state.kind === 'prompt') {
    const { entry, photoUrl, draft } = state;
    const when = formatDraftTime(draft.savedAt, getAppLocale());
    const body = t('draft.body.edit');
    return (
      <ConfirmDialog
        title={t('draft.title')}
        message={when ? `${t('draft.savedAt', { when })} ${body}` : body}
        confirmLabel={t('draft.resume')}
        cancelLabel={t('draft.discard')}
        dismissable={false}
        busy={busy}
        autoFocus="confirm"
        onConfirm={() => setState({ kind: 'form', entry, photoUrl, initial: draft.fields })}
        onCancel={async () => {
          setBusy(true);
          try {
            await clearEntryDraftFor(entry.id);
          } catch (err) {
            console.warn('Could not clear the form draft', err);
          }
          setState({ kind: 'form', entry, photoUrl, initial: fieldsFromEntry(entry) });
        }}
      />
    );
  }

  if (state.kind === 'form') {
    return (
      <EntryForm
        mode="edit"
        entryId={state.entry.id}
        existing={state.entry}
        existingPhotoUrl={state.photoUrl}
        initialFields={state.initial}
        baselineFields={fieldsFromEntry(state.entry)}
        onSaved={finish}
        onLeave={finish}
      />
    );
  }

  return null;
}
