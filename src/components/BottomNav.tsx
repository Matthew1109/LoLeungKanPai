import { NavLink, useMatch } from 'react-router-dom';
import { t } from '../i18n';
import { CalendarIcon, CollectionsIcon, GalleryIcon, GearIcon, PlusIcon } from './icons';
import s from './BottomNav.module.css';

export default function BottomNav() {
  // When the user is looking at a specific day, "Add Drink" pre-selects that date.
  const day = useMatch('/day/:dayKey');
  const addTo = day?.params.dayKey ? `/add?date=${day.params.dayKey}` : '/add';
  const item = ({ isActive }: { isActive: boolean }) => (isActive ? `${s.item} ${s.active}` : s.item);

  return (
    <nav className={s.nav} aria-label="Main">
      <NavLink to="/" end className={item}>
        <CalendarIcon />
        <span>{t('nav.calendar')}</span>
      </NavLink>
      <NavLink to="/gallery" className={item}>
        <GalleryIcon />
        <span>{t('nav.gallery')}</span>
      </NavLink>
      <NavLink to={addTo} className={s.addWrap} aria-label={t('nav.add')}>
        <span className={s.add}>
          <PlusIcon width={26} height={26} />
        </span>
      </NavLink>
      <NavLink to="/collections" className={item}>
        <CollectionsIcon />
        <span>{t('nav.collections')}</span>
      </NavLink>
      <NavLink to="/settings" className={item}>
        <GearIcon />
        <span>{t('nav.settings')}</span>
      </NavLink>
    </nav>
  );
}
