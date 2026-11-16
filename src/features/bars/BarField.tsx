import { useEffect, useRef, useState } from 'react';
import { listBars } from '../../db/barRepo';
import type { Bar } from '../../db/schema';
import { useDataVersion } from '../../hooks/useDataVersion';
import { t } from '../../i18n';
import { tidyBarName } from '../../utils/bars';
import { exactBar, matchBars } from './barPickerModel';
import s from './BarField.module.css';

interface Props {
  id: string;
  inputClassName: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/** After the field loses focus the list closes a moment later, so a tap on a suggestion still counts. */
const CLOSE_DELAY_MS = 150;

/**
 * The drink form's "Bar or place" field: a plain text field (the bar is still just text on the drink) with the
 * library's bars suggested while you type. A name that is not in the library yet is added when the drink is saved
 * (entryRepo.saveEntry does that), and the hint under the field says so. Archived bars are never suggested.
 */
export default function BarField({ id, inputClassName, value, placeholder, onChange }: Props) {
  const version = useDataVersion();
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    listBars({ includeArchived: true })
      .then((rows) => {
        if (alive) setBars(rows);
      })
      .catch((err) => console.warn('Could not read bars (the field still works as plain text)', err));
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function show() {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeSoon() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  function choose(bar: Bar) {
    window.clearTimeout(closeTimer.current);
    onChange(bar.name);
    setOpen(false);
  }

  const typed = tidyBarName(value);
  const suggestions = open && bars !== null ? matchBars(bars.filter((bar) => !bar.isArchived), value) : [];
  // Nothing to pick when the one suggestion is exactly what is already typed.
  const listed = suggestions.length === 1 && suggestions[0].name === typed ? [] : suggestions;
  const isNew = bars !== null && typed !== '' && exactBar(bars, typed) === undefined;

  return (
    <div className={s.wrap}>
      <input
        id={id}
        className={inputClassName}
        type="text"
        value={value}
        placeholder={placeholder}
        autoCapitalize="words"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          show();
        }}
        onFocus={show}
        onBlur={closeSoon}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {listed.length > 0 && (
        <ul className={s.list} aria-label={t('bars.suggest.label')}>
          {listed.map((bar) => (
            <li key={bar.id} className={s.item}>
              <button type="button" className={s.option} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(bar)}>
                {bar.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {isNew && <p className={s.hint}>{t('bars.suggest.new', { name: typed })}</p>}
    </div>
  );
}
