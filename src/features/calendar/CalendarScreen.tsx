import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import { getAppLocale, t, tn } from '../../i18n';
import { useMonthData } from '../../hooks/useMonthData';
import {
  addMonths, buildMonthGrid, formatMonthParam, getWeekStart, parseDayKey, parseMonthParam, toDayKey, weekdayOrder,
} from '../../utils/dates';
import ReminderBanner from '../backup/ReminderBanner';
import DayTile from './DayTile';
import screen from '../../components/Screen.module.css';
import s from './Calendar.module.css';

export default function CalendarScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const locale = getAppLocale();

  const now = new Date();
  const todayKey = toDayKey(now);
  const parsed = parseMonthParam(params.get('m'));
  const year = parsed?.year ?? now.getFullYear();
  const month = parsed?.month ?? now.getMonth();
  const isCurrent = year === now.getFullYear() && month === now.getMonth();

  const weekStart = useMemo(() => getWeekStart(), []);
  const cells = useMemo(() => buildMonthGrid(year, month, weekStart), [year, month, weekStart]);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return weekdayOrder(weekStart).map((wd) => fmt.format(new Date(2026, 0, 4 + wd))); // 2026-01-04 is a Sunday
  }, [locale, weekStart]);
  const monthName = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, month, 1)),
    [locale, year, month],
  );
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }), [locale]);

  const { days, error } = useMonthData(year, month);
  const [dir, setDir] = useState<'next' | 'prev' | 'none'>('none');

  const shift = useCallback(
    (delta: number) => {
      const n = addMonths(year, month, delta);
      setDir(delta > 0 ? 'next' : 'prev');
      // replace: true keeps the back button from stepping through every month browsed
      setParams({ m: formatMonthParam(n.year, n.month) }, { replace: true });
    },
    [year, month, setParams],
  );
  const goToday = () => {
    const cur = now.getFullYear() * 12 + now.getMonth();
    setDir(cur > year * 12 + month ? 'next' : 'prev');
    setParams({}, { replace: true });
  };
  const open = useCallback((key: string) => navigate(`/day/${key}`), [navigate]);

  // horizontal swipe to change month
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touch.current;
    touch.current = null;
    if (!st) return;
    const dx = e.changedTouches[0].clientX - st.x;
    const dy = e.changedTouches[0].clientY - st.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45) shift(dx < 0 ? 1 : -1);
  };

  return (
    <div className={screen.screen}>
      <header className={screen.top}>
        <span className={screen.brand}>{t('app.name')}</span>
      </header>

      <section className={s.head}>
        <div>
          <span className={s.year}>{year}</span>
          <h1 className={s.month}>{monthName}</h1>
        </div>
        <div className={s.controls}>
          {!isCurrent && (
            <button className={s.todayBtn} onClick={goToday}>{t('calendar.today')}</button>
          )}
          <button className={s.round} onClick={() => shift(-1)} aria-label={t('calendar.prevMonth')}><ChevronLeftIcon width={20} height={20} /></button>
          <button className={s.round} onClick={() => shift(1)} aria-label={t('calendar.nextMonth')}><ChevronRightIcon width={20} height={20} /></button>
        </div>
      </section>

      <div className={s.weekdays} aria-hidden="true">
        {weekdays.map((w, i) => <span key={i}>{w}</span>)}
      </div>

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className={s.gridArea}>
        <div
          key={formatMonthParam(year, month)}
          className={`${s.grid} ${dir === 'next' ? s.fromRight : dir === 'prev' ? s.fromLeft : s.fade}`}
        >
          {cells.map((key, i) => {
            if (!key) return <div key={`b${i}`} className={s.blank} />;
            const info = days?.get(key);
            const date = dateFmt.format(parseDayKey(key));
            return (
              <DayTile
                key={key}
                dayKey={key}
                dayNumber={Number(key.slice(8))}
                isToday={key === todayKey}
                info={info}
                label={info ? tn('calendar.day', info.count, { date }) : t('calendar.day.empty', { date })}
                onOpen={open}
              />
            );
          })}
        </div>
      </div>

      <ReminderBanner />

      {error != null && <p className={s.error} role="alert">{t('calendar.loadError')}</p>}
    </div>
  );
}
