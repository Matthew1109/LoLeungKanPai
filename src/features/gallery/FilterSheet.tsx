import { useEffect, useId, useRef } from 'react';
import { getAppLocale, t } from '../../i18n';
import { toggleId } from '../tags/tagPickerModel';
import type { TagCount } from '../collections/collectionsModel';
import type { GalleryFilters, TagMode } from './galleryFilter';
import tf from '../tags/TagField.module.css';
import s from './Gallery.module.css';

interface Props {
  filters: GalleryFilters;
  /** Years that have a photographed drink, newest first (the chosen year is always included). */
  years: number[];
  /** Tags used by photographed drinks (the ticked ones are always included), A to Z. */
  spirits: TagCount[];
  ingredients: TagCount[];
  /** Applies at once, behind the sheet. */
  onChange: (next: GalleryFilters) => void;
  onClose: () => void;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Bottom sheet with every gallery filter. Changes apply immediately; "Done" only closes the sheet. */
export default function FilterSheet({ filters, years, spirits, ingredients, onChange, onClose }: Props) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const monthName = (month: number) => new Intl.DateTimeFormat(getAppLocale(), { month: 'short' }).format(new Date(2000, month - 1, 1));

  // Focus the sheet itself so no keyboard opens.
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

  return (
    <div className={tf.overlay} onClick={onClose}>
      <div
        ref={sheetRef}
        className={tf.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={tf.sheetHead}>
          <h2 id={titleId} className={tf.sheetTitle}>{t('gallery.filters')}</h2>
          <button type="button" className={tf.done} onClick={onClose}>{t('gallery.filter.done')}</button>
        </div>

        <div className={tf.body}>
          <section className={s.section}>
            <ul className={tf.options}>
              <li>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={filters.favouritesOnly}
                  className={filters.favouritesOnly ? `${tf.option} ${tf.optionOn}` : tf.option}
                  onClick={() => onChange({ ...filters, favouritesOnly: !filters.favouritesOnly })}
                >
                  <span className={tf.box} aria-hidden="true">{filters.favouritesOnly ? '✓' : ''}</span>
                  <span className={tf.optName}>{t('gallery.filter.favourites')}</span>
                </button>
              </li>
            </ul>
          </section>

          <section className={s.section}>
            <h3 className={s.label}>{t('gallery.filter.year')}</h3>
            <div className={s.chipRow}>
              <button
                type="button"
                className={filters.year === null ? `${tf.chip} ${tf.chipOn}` : tf.chip}
                aria-pressed={filters.year === null}
                onClick={() => onChange({ ...filters, year: null })}
              >
                {t('gallery.filter.allYears')}
              </button>
              {years.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={filters.year === year ? `${tf.chip} ${tf.chipOn}` : tf.chip}
                  aria-pressed={filters.year === year}
                  onClick={() => onChange({ ...filters, year })}
                >
                  {year}
                </button>
              ))}
            </div>
          </section>

          <section className={s.section}>
            <h3 className={s.label}>{t('gallery.filter.month')}</h3>
            <div className={s.chipRow}>
              <button
                type="button"
                className={filters.month === null ? `${tf.chip} ${tf.chipOn}` : tf.chip}
                aria-pressed={filters.month === null}
                onClick={() => onChange({ ...filters, month: null })}
              >
                {t('gallery.filter.allMonths')}
              </button>
              {MONTHS.map((month) => (
                <button
                  key={month}
                  type="button"
                  className={filters.month === month ? `${tf.chip} ${tf.chipOn}` : tf.chip}
                  aria-pressed={filters.month === month}
                  onClick={() => onChange({ ...filters, month })}
                >
                  {monthName(month)}
                </button>
              ))}
            </div>
          </section>

          <TagFilter
            title={t('tags.section.spirits')}
            options={spirits}
            selected={filters.spiritIds}
            mode={filters.spiritMode}
            onToggle={(id) => onChange({ ...filters, spiritIds: toggleId(filters.spiritIds, id) })}
            onMode={(spiritMode) => onChange({ ...filters, spiritMode })}
          />
          <TagFilter
            title={t('tags.section.ingredients')}
            options={ingredients}
            selected={filters.ingredientIds}
            mode={filters.ingredientMode}
            onToggle={(id) => onChange({ ...filters, ingredientIds: toggleId(filters.ingredientIds, id) })}
            onMode={(ingredientMode) => onChange({ ...filters, ingredientMode })}
          />
        </div>
      </div>
    </div>
  );
}

interface TagFilterProps {
  title: string;
  options: TagCount[];
  selected: string[];
  mode: TagMode;
  onToggle: (id: string) => void;
  onMode: (mode: TagMode) => void;
}

/** One kind of tag: the Any / All switch, what it means, and the tags to tick. */
function TagFilter({ title, options, selected, mode, onToggle, onMode }: TagFilterProps) {
  const seg = (value: TagMode, label: string) => (
    <button
      type="button"
      className={mode === value ? `${s.segBtn} ${s.segOn}` : s.segBtn}
      aria-pressed={mode === value}
      onClick={() => onMode(value)}
    >
      {label}
    </button>
  );
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.label}>{title}</h3>
        <div className={s.seg} role="group" aria-label={t('gallery.filter.match')}>
          {seg('ANY', t('gallery.filter.any'))}
          {seg('ALL', t('gallery.filter.all'))}
        </div>
      </div>
      <p className={s.hint}>{mode === 'ALL' ? t('gallery.filter.hintAll') : t('gallery.filter.hintAny')}</p>
      {options.length === 0 ? (
        <p className={tf.empty}>{t('gallery.filter.noTags')}</p>
      ) : (
        <ul className={tf.options}>
          {options.map(({ tag, count }) => {
            const on = selected.includes(tag.id);
            return (
              <li key={tag.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={on ? `${tf.option} ${tf.optionOn}` : tf.option}
                  onClick={() => onToggle(tag.id)}
                >
                  <span className={tf.box} aria-hidden="true">{on ? '✓' : ''}</span>
                  <span className={tf.optName}>{tag.name}</span>
                  {tag.isArchived && <span className={tf.optBadge}>{t('tags.archived')}</span>}
                  <span className={tf.optBadge}>{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
