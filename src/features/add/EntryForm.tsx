import { useCallback, useEffect, useId, useRef, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { HeartIcon, HeartOutlineIcon } from '../../components/icons';
import { clearEntryDraftFor, saveEntryDraft } from '../../db/draftRepo';
import type { EntryDraftFields } from '../../db/entryDraft';
import { saveEntry } from '../../db/entryRepo';
import { EntryValidationError } from '../../db/errors';
import { DRINK_CATEGORIES, type DrinkEntry, type PhotoRecord } from '../../db/schema';
import { useUrlBag } from '../../hooks/useUrlBag';
import { t } from '../../i18n';
import type { MessageKey } from '../../i18n/locales/en';
import { PhotoProcessingError, processPhoto } from '../../services/imageProcessing';
import { newId } from '../../utils/id';
import BarField from '../bars/BarField';
import TagField from '../tags/TagField';
import { makeDraft } from './draftModel';
import { buildEntryInput, sameFields, sameTagSelection, tagSelectionFromEntry, type TagSelection } from './entryFormModel';
import { CATEGORY_LABEL_KEYS, fieldErrors, writeErrorKey, type FieldName } from './formErrors';
import PhotoPicker from './PhotoPicker';
import { previewUrlFor, stateAfterRemove, toPhotoChange, type PhotoState } from './photoState';
import s from './EntryForm.module.css';

export interface EntryFormProps {
  mode: 'new' | 'edit';
  /** New: the id reserved for the entry (a double tap on Save can only ever update it). Edit: the entry's id. */
  entryId: string;
  /** Edit only: the stored entry (tags, photo id and creation time are carried over from it). */
  existing: DrinkEntry | undefined;
  /** Edit only: object URL of the stored photo; owned (and revoked) by the caller. */
  existingPhotoUrl: string | null;
  /** What the fields start with: blank, the stored entry, or a resumed draft. */
  initialFields: EntryDraftFields;
  /** What counts as "unchanged": blank or the stored entry. Differs from initialFields after "Resume draft". */
  baselineFields: EntryDraftFields;
  onSaved: (entry: DrinkEntry) => void;
  onLeave: () => void;
}

const DRAFT_DEBOUNCE_MS = 600;
const MIN_DATE = '1900-01-01';
const MAX_DATE = '2100-12-31';

const warnDraft = (err: unknown) => console.warn('Could not update the form draft', err);

/**
 * The Add / Edit form. Text fields are drafted to IndexedDB while the user types (decision E5); the photo and the
 * tags are not.
 * Saving goes through saveEntry only, in one transaction with the photo change. Nothing here touches IndexedDB
 * for entries directly.
 */
export default function EntryForm({
  mode, entryId, existing, existingPhotoUrl, initialFields, baselineFields, onSaved, onLeave,
}: EntryFormProps) {
  const uid = useId();
  const bag = useUrlBag();
  const rootRef = useRef<HTMLDivElement>(null);

  const [fields, setFields] = useState<EntryDraftFields>(initialFields);
  const [tagSel, setTagSel] = useState<TagSelection>(() => tagSelectionFromEntry(existing));
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'keep' });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldName, MessageKey>>>({});
  const [errorTick, setErrorTick] = useState(0);
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Mutable mirrors, so handlers that outlive a render (timers, page events, async work) see current values.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const tagSelRef = useRef(tagSel);
  tagSelRef.current = tagSel;
  const baselineRef = useRef(baselineFields);
  const aliveRef = useRef(false);
  const savingRef = useRef(false);
  const photoBusyRef = useRef(false);
  /** True once the form is saving or leaving on purpose: no draft may be written any more. */
  const closedRef = useRef(false);
  /** A draft of ours may exist in storage, so returning to "unchanged" must delete it. */
  const everDirtyRef = useRef(!sameFields(initialFields, baselineFields));
  const draftTimer = useRef<number | undefined>(undefined);

  const baseUpdatedAt = mode === 'edit' && existing ? existing.updatedAt : null;

  /** Writes the draft now (or removes it when the text is back to "unchanged"). Stable: safe in listeners. */
  const flushDraft = useCallback(() => {
    window.clearTimeout(draftTimer.current);
    if (closedRef.current) return;
    const current = fieldsRef.current;
    if (sameFields(current, baselineRef.current)) {
      if (everDirtyRef.current) {
        everDirtyRef.current = false;
        clearEntryDraftFor(entryId).catch(warnDraft);
      }
      return;
    }
    everDirtyRef.current = true;
    saveEntryDraft(makeDraft({ entryId, mode, baseUpdatedAt, fields: current, now: new Date() })).catch(warnDraft);
  }, [entryId, mode, baseUpdatedAt]);

  // Debounced draft while typing.
  useEffect(() => {
    if (closedRef.current) return;
    draftTimer.current = window.setTimeout(flushDraft, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(draftTimer.current);
  }, [fields, flushDraft]);

  // Flush when the page is hidden (app switcher, camera app, lock screen), on pagehide, and when the form unmounts.
  useEffect(() => {
    aliveRef.current = true;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushDraft);
    return () => {
      aliveRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [flushDraft]);

  // After a failed validation: bring the first invalid field into view and focus it.
  useEffect(() => {
    if (errorTick === 0) return;
    const target = rootRef.current?.querySelector<HTMLElement>('[data-invalid="true"]');
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  }, [errorTick]);

  function setField<K extends keyof EntryDraftFields>(key: K, value: EntryDraftFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function clearError(...names: FieldName[]) {
    setErrors((prev) => {
      if (!names.some((name) => prev[name] !== undefined)) return prev;
      const next = { ...prev };
      for (const name of names) delete next[name];
      return next;
    });
  }

  function showFieldErrors(next: Partial<Record<FieldName, MessageKey>>) {
    setErrors(next);
    setFormError(null);
    setErrorTick((n) => n + 1);
  }

  async function handleFile(file: File) {
    if (photoBusyRef.current || savingRef.current) return;
    photoBusyRef.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const processed = await processPhoto(file);
      if (!aliveRef.current) return; // the form was left while the photo was being prepared
      const record: PhotoRecord = {
        id: newId(),
        blob: processed.full,
        mime: 'image/jpeg',
        size: processed.full.size,
        width: processed.width,
        height: processed.height,
        createdAt: new Date().toISOString(),
      };
      const url = URL.createObjectURL(processed.full);
      bag([url]);
      setPhoto({ kind: 'replace', record, thumb: processed.thumb, url });
    } catch (err) {
      console.warn('Photo could not be prepared', err);
      if (aliveRef.current) {
        setPhotoError(t(err instanceof PhotoProcessingError && err.code === 'DECODE_FAILED' ? 'form.photo.decodeError' : 'form.photo.processError'));
      }
    } finally {
      photoBusyRef.current = false;
      if (aliveRef.current) setPhotoBusy(false);
    }
  }

  function removePhoto() {
    if (photoBusyRef.current || savingRef.current) return;
    setPhotoError(null);
    bag([]);
    setPhoto(stateAfterRemove(existing?.photoId != null));
  }

  async function save() {
    if (savingRef.current || photoBusyRef.current) return;
    const built = buildEntryInput(fieldsRef.current, { id: entryId, existing, now: new Date(), tags: tagSelRef.current });
    if (!built.ok) {
      showFieldErrors(fieldErrors(built.problems));
      return;
    }
    setErrors({});
    setFormError(null);
    savingRef.current = true;
    closedRef.current = true; // from here on no draft may be written; saveEntry removes ours in its transaction
    window.clearTimeout(draftTimer.current);
    setSaving(true);

    let stored: DrinkEntry;
    try {
      stored = await saveEntry(built.entry, toPhotoChange(photo));
    } catch (err) {
      savingRef.current = false;
      closedRef.current = false;
      if (!aliveRef.current) {
        flushDraft(); // the user left meanwhile and the save failed: keep their text
        return;
      }
      setSaving(false);
      if (err instanceof EntryValidationError) showFieldErrors(fieldErrors(err.problems));
      else setFormError(writeErrorKey(err));
      return;
    }
    if (aliveRef.current) onSaved(stored);
  }

  function leave(clearDraft: boolean) {
    closedRef.current = true;
    window.clearTimeout(draftTimer.current);
    if (clearDraft || everDirtyRef.current) clearEntryDraftFor(entryId).catch(warnDraft);
    onLeave();
  }

  const dirty =
    !sameFields(fields, baselineFields) || photo.kind !== 'keep' || !sameTagSelection(tagSel, tagSelectionFromEntry(existing));

  function cancel() {
    if (savingRef.current) return;
    if (dirty) setConfirmDiscard(true);
    else leave(false);
  }

  const generalError = formError ?? errors.form ?? null;
  const saveLabel = saving ? t('form.saving') : t('form.save');
  const dateTimeError = errors.dateTime ? t(errors.dateTime) : null;
  const abvError = errors.alcoholPercentage ? t(errors.alcoholPercentage) : null;
  const volumeError = errors.alcoholVolumeMl ? t(errors.alcoholVolumeMl) : null;
  const categoryError = errors.category ? t(errors.category) : null;
  const ids = {
    name: `${uid}-name`, category: `${uid}-category`, date: `${uid}-date`, time: `${uid}-time`, bar: `${uid}-bar`,
    abv: `${uid}-abv`, volume: `${uid}-volume`, notes: `${uid}-notes`,
    dateTimeError: `${uid}-datetime-error`, abvError: `${uid}-abv-error`, volumeError: `${uid}-volume-error`,
  };

  return (
    <div className={s.page} ref={rootRef}>
      <header className={s.header}>
        <button type="button" className={s.headerBtn} onClick={cancel} disabled={saving}>{t('common.cancel')}</button>
        <h1 className={s.title}>{mode === 'edit' ? t('form.title.edit') : t('form.title.new')}</h1>
        <button type="button" className={`${s.headerBtn} ${s.headerSave}`} onClick={save} disabled={saving || photoBusy}>
          {saveLabel}
        </button>
      </header>

      <div className={s.content}>
        <div role="group" aria-label={t('form.photo.label')}>
          <PhotoPicker
            previewUrl={previewUrlFor(photo, existingPhotoUrl)}
            busy={photoBusy}
            error={photoError}
            disabled={saving}
            onFile={handleFile}
            onRemove={removePhoto}
            onBeforePick={flushDraft}
          />
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor={ids.name}>{t('form.name')}</label>
          <input
            id={ids.name}
            className={s.input}
            type="text"
            value={fields.drinkName}
            placeholder={t('form.name.placeholder')}
            autoCapitalize="words"
            autoComplete="off"
            onChange={(event) => setField('drinkName', event.target.value)}
          />
        </div>

        <div className={s.field} role="group" aria-labelledby={ids.category} data-invalid={categoryError ? 'true' : undefined}>
          <span id={ids.category} className={s.label}>{t('form.category')}</span>
          <div className={s.chips}>
            {DRINK_CATEGORIES.map((category) => {
              const on = fields.category === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={on}
                  className={on ? `${s.chip} ${s.chipOn}` : s.chip}
                  onClick={() => {
                    setField('category', on ? null : category);
                    clearError('category');
                  }}
                >
                  {t(CATEGORY_LABEL_KEYS[category])}
                </button>
              );
            })}
          </div>
          {categoryError && <p className={s.error} role="alert">{categoryError}</p>}
        </div>

        <div className={s.field} data-invalid={dateTimeError ? 'true' : undefined}>
          <div className={s.row2}>
            <div className={s.field}>
              <label className={s.label} htmlFor={ids.date}>{t('form.date')}</label>
              <input
                id={ids.date}
                className={dateTimeError ? `${s.input} ${s.invalid}` : s.input}
                type="date"
                min={MIN_DATE}
                max={MAX_DATE}
                value={fields.date}
                aria-invalid={dateTimeError ? true : undefined}
                aria-describedby={dateTimeError ? ids.dateTimeError : undefined}
                onChange={(event) => {
                  setField('date', event.target.value);
                  clearError('dateTime');
                }}
              />
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor={ids.time}>{t('form.time')}</label>
              <input
                id={ids.time}
                className={dateTimeError ? `${s.input} ${s.invalid}` : s.input}
                type="time"
                value={fields.time}
                aria-invalid={dateTimeError ? true : undefined}
                aria-describedby={dateTimeError ? ids.dateTimeError : undefined}
                onChange={(event) => {
                  setField('time', event.target.value);
                  clearError('dateTime');
                }}
              />
            </div>
          </div>
          {dateTimeError && <p id={ids.dateTimeError} className={s.error} role="alert">{dateTimeError}</p>}
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor={ids.bar}>{t('form.bar')}</label>
          <BarField
            id={ids.bar}
            inputClassName={s.input}
            value={fields.barName}
            placeholder={t('form.bar.placeholder')}
            onChange={(value) => setField('barName', value)}
          />
        </div>

        <TagField
          category="BASE_SPIRIT"
          label={t('tags.section.spirits')}
          selectedIds={tagSel.baseSpiritTagIds}
          disabled={saving}
          onChange={(ids) => setTagSel((prev) => ({ ...prev, baseSpiritTagIds: ids }))}
        />
        <TagField
          category="INGREDIENT"
          label={t('tags.section.ingredients')}
          selectedIds={tagSel.ingredientTagIds}
          disabled={saving}
          onChange={(ids) => setTagSel((prev) => ({ ...prev, ingredientTagIds: ids }))}
        />

        <div className={s.row2}>
          <div className={s.field} data-invalid={abvError ? 'true' : undefined}>
            <label className={s.label} htmlFor={ids.abv}>{t('form.abv')}</label>
            <input
              id={ids.abv}
              className={abvError ? `${s.input} ${s.invalid}` : s.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={fields.alcoholPercentage}
              placeholder={t('form.abv.placeholder')}
              aria-invalid={abvError ? true : undefined}
              aria-describedby={abvError ? ids.abvError : undefined}
              onChange={(event) => {
                setField('alcoholPercentage', event.target.value);
                clearError('alcoholPercentage');
              }}
            />
            {abvError && <p id={ids.abvError} className={s.error} role="alert">{abvError}</p>}
          </div>
          <div className={s.field} data-invalid={volumeError ? 'true' : undefined}>
            <label className={s.label} htmlFor={ids.volume}>{t('form.volume')}</label>
            <input
              id={ids.volume}
              className={volumeError ? `${s.input} ${s.invalid}` : s.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={fields.alcoholVolumeMl}
              placeholder={t('form.volume.placeholder')}
              aria-invalid={volumeError ? true : undefined}
              aria-describedby={volumeError ? ids.volumeError : undefined}
              onChange={(event) => {
                setField('alcoholVolumeMl', event.target.value);
                clearError('alcoholVolumeMl');
              }}
            />
            {volumeError && <p id={ids.volumeError} className={s.error} role="alert">{volumeError}</p>}
          </div>
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor={ids.notes}>{t('form.notes')}</label>
          <textarea
            id={ids.notes}
            className={`${s.input} ${s.textarea}`}
            rows={4}
            value={fields.notes}
            placeholder={t('form.notes.placeholder')}
            onChange={(event) => setField('notes', event.target.value)}
          />
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={fields.isFavourite}
          className={fields.isFavourite ? `${s.favourite} ${s.favouriteOn}` : s.favourite}
          onClick={() => setField('isFavourite', !fields.isFavourite)}
        >
          <span>{t('form.favourite')}</span>
          {fields.isFavourite ? <HeartIcon width={22} height={22} /> : <HeartOutlineIcon width={22} height={22} />}
        </button>

        {generalError && <p className={s.error} role="alert">{t(generalError)}</p>}

        <button type="button" className={s.primary} onClick={save} disabled={saving || photoBusy}>
          {saveLabel}
        </button>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title={mode === 'edit' ? t('discard.title.edit') : t('discard.title.new')}
          message={t('discard.body')}
          confirmLabel={t('discard.confirm')}
          cancelLabel={t('discard.keep')}
          tone="danger"
          onConfirm={() => {
            setConfirmDiscard(false);
            leave(true);
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
