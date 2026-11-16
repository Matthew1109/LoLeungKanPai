import { memo } from 'react';
import { CoupeIcon } from '../../components/icons';
import type { DayInfo } from '../../hooks/useMonthData';
import s from './Calendar.module.css';

interface Props {
  dayKey: string;
  dayNumber: number;
  isToday: boolean;
  info?: DayInfo;
  label: string;
  onOpen: (dayKey: string) => void;
}

function DayTile({ dayKey, dayNumber, isToday, info, label, onOpen }: Props) {
  const photo = info?.coverUrl;
  const cls = [s.tile, photo ? s.hasPhoto : '', info && !photo ? s.hasEntry : '', isToday ? s.today : ''].join(' ');
  return (
    <button className={cls} onClick={() => onOpen(dayKey)} aria-label={label} aria-current={isToday ? 'date' : undefined}>
      {photo && <img className={s.photo} src={photo} alt="" draggable={false} decoding="async" />}
      {info && !photo && <CoupeIcon className={s.placeholder} width={20} height={20} />}
      <span className={s.num}>{dayNumber}</span>
    </button>
  );
}

export default memo(DayTile);
