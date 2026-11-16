import { Link } from 'react-router-dom';
import { ChevronLeftIcon } from '../../components/icons';
import screen from '../../components/Screen.module.css';
import { t } from '../../i18n';
import TagSection from './TagSection';
import s from './ManageTags.module.css';

/** Settings > Tag management: add, rename, archive, restore and delete the reusable base-spirit and ingredient tags. */
export default function ManageTags() {
  return (
    <div className={screen.screen}>
      <header className={s.bar}>
        <Link to="/settings" className={s.back}>
          <ChevronLeftIcon width={22} height={22} />
          <span>{t('settings.title')}</span>
        </Link>
      </header>
      <h1 className={screen.pageTitle}>{t('tags.manage.title')}</h1>
      <p className={s.hint}>{t('tags.archiveHint')}</p>
      <TagSection category="BASE_SPIRIT" title={t('tags.section.spirits')} placeholder={t('tags.add.placeholder.spirit')} />
      <TagSection category="INGREDIENT" title={t('tags.section.ingredients')} placeholder={t('tags.add.placeholder.ingredient')} />
    </div>
  );
}
