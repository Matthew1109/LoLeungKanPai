import { useRef, type ChangeEvent } from 'react';
import { CameraIcon, CoupeIcon, ImageIcon, TrashIcon } from '../../components/icons';
import { t } from '../../i18n';
import s from './PhotoPicker.module.css';

interface Props {
  /** The picture to show (new photo, or the stored one); null = none. */
  previewUrl: string | null;
  /** A chosen photo is being decoded and resized. */
  busy: boolean;
  /** Persistent, already translated; shown until the next pick. */
  error: string | null;
  /** The form is saving. */
  disabled: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** Called right before the camera / library opens: iOS may discard this page while the camera app is up. */
  onBeforePick: () => void;
}

/**
 * Two buttons, two hidden file inputs: "Take Photo" (`capture`, rear camera) and "Choose from Photos" (library).
 * The input is reset before each pick, so choosing the same photo again still fires `change`.
 */
export default function PhotoPicker({ previewUrl, busy, error, disabled, onFile, onRemove, onBeforePick }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const open = (input: HTMLInputElement | null) => {
    if (!input) return;
    onBeforePick();
    input.value = '';
    input.click();
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) onFile(file);
  };

  const locked = busy || disabled;

  return (
    <div className={s.root}>
      <div className={s.frame}>
        {previewUrl ? (
          <img src={previewUrl} alt={t('form.photo.alt')} className={s.preview} />
        ) : (
          <div className={s.empty}>
            <CoupeIcon width={36} height={36} />
            <span>{t('form.photo.empty')}</span>
          </div>
        )}
        {busy && <div className={s.busy} role="status">{t('form.photo.processing')}</div>}
      </div>

      <div className={s.actions}>
        <button type="button" className={s.btn} onClick={() => open(cameraRef.current)} disabled={locked}>
          <CameraIcon width={20} height={20} />
          <span>{t('form.photo.take')}</span>
        </button>
        <button type="button" className={s.btn} onClick={() => open(libraryRef.current)} disabled={locked}>
          <ImageIcon width={20} height={20} />
          <span>{t('form.photo.choose')}</span>
        </button>
      </div>

      {previewUrl && (
        <button type="button" className={s.remove} onClick={onRemove} disabled={locked}>
          <TrashIcon width={18} height={18} />
          <span>{t('form.photo.remove')}</span>
        </button>
      )}

      {error && <p className={s.error} role="alert">{error}</p>}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className={s.hidden} onChange={onChange} tabIndex={-1} aria-hidden="true" />
      <input ref={libraryRef} type="file" accept="image/*" className={s.hidden} onChange={onChange} tabIndex={-1} aria-hidden="true" />
    </div>
  );
}
