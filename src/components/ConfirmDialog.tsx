import { useEffect, useId, useRef } from 'react';
import s from './ConfirmDialog.module.css';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'default' | 'danger';
  /** Escape and a tap outside the dialog cancel it. Turn off when "cancel" is a real choice, not a way out. */
  dismissable?: boolean;
  /** An action is running: both buttons are disabled and the dialog cannot be dismissed. */
  busy?: boolean;
  /** Which button gets focus. Destructive dialogs keep it on Cancel. */
  autoFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation. Used for deleting an entry, discarding edits, and resuming a draft. */
export default function ConfirmDialog({
  title, message, confirmLabel, cancelLabel, tone = 'default', dismissable = true, busy = false,
  autoFocus = 'cancel', onConfirm, onCancel,
}: Props) {
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (autoFocus === 'confirm' ? confirmRef : cancelRef).current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!dismissable || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissable, busy, onCancel]);

  return (
    <div className={s.backdrop} onClick={dismissable && !busy ? onCancel : undefined}>
      <div
        className={s.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className={s.title}>{title}</h2>
        <p id={messageId} className={s.message}>{message}</p>
        <div className={s.actions}>
          <button ref={cancelRef} type="button" className={s.cancel} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'danger' ? `${s.confirm} ${s.danger}` : s.confirm}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
