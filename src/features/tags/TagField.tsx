import { useEffect, useId, useState } from 'react';
import { PlusIcon } from '../../components/icons';
import type { Tag, TagCategory } from '../../db/schema';
import { getTagsByIds } from '../../db/tagRepo';
import { useDataVersion } from '../../hooks/useDataVersion';
import { t } from '../../i18n';
import { toggleId } from './tagPickerModel';
import TagSheet from './TagSheet';
import s from './TagField.module.css';

interface Props {
  category: TagCategory;
  label: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/** One tag group of the drink form: the chosen tags (tap one to remove it) and an "Add" chip that opens the picker. */
export default function TagField({ category, label, selectedIds, onChange, disabled = false }: Props) {
  const labelId = useId();
  const version = useDataVersion();
  const [tags, setTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  // Names are looked up by id (archived tags included), so a rename or a new tag shows up straight away.
  useEffect(() => {
    let alive = true;
    getTagsByIds(selectedIds)
      .then((rows) => {
        if (alive) setTags(rows);
      })
      .catch((err) => console.warn('Could not read tags', err));
    return () => {
      alive = false;
    };
  }, [selectedIds, version]);

  const byId = new Map(tags.map((tag): [string, Tag] => [tag.id, tag]));
  const chosen = selectedIds.map((id) => byId.get(id)).filter((tag): tag is Tag => tag !== undefined);

  return (
    <div className={s.field} role="group" aria-labelledby={labelId}>
      <span id={labelId} className={s.label}>{label}</span>
      <div className={s.chips}>
        {chosen.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={`${s.chip} ${s.chipOn}`}
            disabled={disabled}
            aria-label={t('tags.field.remove', { name: tag.name })}
            onClick={() => onChange(toggleId(selectedIds, tag.id))}
          >
            <span>{tag.name}</span>
            <span className={s.x} aria-hidden="true">×</span>
          </button>
        ))}
        <button type="button" className={`${s.chip} ${s.addChip}`} disabled={disabled} onClick={() => setOpen(true)}>
          <PlusIcon width={14} height={14} aria-hidden="true" />
          <span>{t('tags.field.add')}</span>
        </button>
      </div>
      {open && (
        <TagSheet category={category} title={label} selectedIds={selectedIds} onChange={onChange} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
