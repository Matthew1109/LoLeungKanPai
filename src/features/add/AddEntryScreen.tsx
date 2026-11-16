import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../../components/ConfirmDialog';
import { clearEntryDraft, getEntryDraft } from '../../db/draftRepo';
import type { EntryDraft, EntryDraftFields } from '../../db/entryDraft';
import { getEntry } from '../../db/entryRepo';
import { getAppLocale, t } from '../../i18n';
import { newId } from '../../utils/id';
import { decideDraftForAdd, formatDraftTime, type DraftDecision } from './draftModel';
import { emptyFields, initialDayKey } from './entryFormModel';
import EntryForm from './EntryForm';
import type { EditRouteState } from './routeState';

type Phase =
  | { kind: 'loading' }
  | { kind: 'prompt'; draft: EntryDraft }
  | { kind: 'form'; entryId: string; initial: EntryDraftFields };

/** Route /add and /add?date=YYYY-MM-DD. */
export default function AddEntryScreen() {
  const [params] = useSearchParams();
  const dateParam = params.get('date');
  // A different ?date= is a different form: remount it (the old one saves its draft when it unmounts).
  return <AddEntry key={dateParam ?? ''} dateParam={dateParam} />;
}

function AddEntry({ dateParam }: { dateParam: string | null }) {
  const navigate = useNavigate();
  const [reservedId] = useState(newId); // reserved up front: a double tap on Save can only ever update this entry
  const [now] = useState(() => new Date());
  const blank = useMemo(() => emptyFields(initialDayKey(dateParam, now), now), [dateParam, now]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  // Decide what to do with a stored draft before showing the form. Never applied silently.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let decision: DraftDecision = { kind: 'none' };
      try {
        const draft = await getEntryDraft();
        const storedUpdatedAt = draft && draft.mode === 'edit' ? (await getEntry(draft.entryId))?.updatedAt : undefined;
        decision = decideDraftForAdd(draft, storedUpdatedAt);
        if (decision.kind === 'discard') await clearEntryDraft(); // its entry is gone or changed: it can never be resumed
      } catch (err) {
        console.warn('Could not read the form draft', err);
        decision = { kind: 'none' }; // a draft problem must never stop the user from adding a drink
      }
      if (cancelled) return;
      setPhase(decision.kind === 'offer' ? { kind: 'prompt', draft: decision.draft } : { kind: 'form', entryId: reservedId, initial: blank });
    })();
    return () => {
      cancelled = true;
    };
  }, [reservedId, blank]);

  const leave = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const resume = (draft: EntryDraft) => {
    if (draft.mode === 'edit') {
      const state: EditRouteState = { fromDetail: false, resumeDraft: true };
      navigate(`/entry/${encodeURIComponent(draft.entryId)}/edit`, { replace: true, state });
      return;
    }
    setPhase({ kind: 'form', entryId: draft.entryId, initial: draft.fields });
  };

  const startFresh = async () => {
    setBusy(true);
    try {
      await clearEntryDraft();
    } catch (err) {
      console.warn('Could not clear the form draft', err);
    }
    setPhase({ kind: 'form', entryId: reservedId, initial: blank });
  };

  if (phase.kind === 'form') {
    return (
      <EntryForm
        mode="new"
        entryId={phase.entryId}
        existing={undefined}
        existingPhotoUrl={null}
        initialFields={phase.initial}
        baselineFields={blank}
        onSaved={(entry) => navigate(`/entry/${encodeURIComponent(entry.id)}`, { replace: true })}
        onLeave={leave}
      />
    );
  }

  if (phase.kind === 'prompt') {
    const when = formatDraftTime(phase.draft.savedAt, getAppLocale());
    const body = t(phase.draft.mode === 'edit' ? 'draft.body.edit' : 'draft.body.new');
    return (
      <ConfirmDialog
        title={t('draft.title')}
        message={when ? `${t('draft.savedAt', { when })} ${body}` : body}
        confirmLabel={t('draft.resume')}
        cancelLabel={t('draft.startFresh')}
        dismissable={false}
        busy={busy}
        autoFocus="confirm"
        onConfirm={() => resume(phase.draft)}
        onCancel={startFresh}
      />
    );
  }

  return null; // opens in a few ms
}
