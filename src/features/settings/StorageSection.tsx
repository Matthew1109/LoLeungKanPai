import { useEffect, useState } from 'react';
import { getPhotoBytes } from '../../db/photoRepo';
import { useDataVersion } from '../../hooks/useDataVersion';
import { t } from '../../i18n';
import { assessStorage, formatBytes, fractionUsed, type StorageFigures } from './storageModel';
import s from './Settings.module.css';

interface Reading extends StorageFigures {
  persisted: boolean | null;
}

async function read(): Promise<Reading> {
  let usage: number | null = null;
  let quota: number | null = null;
  let persisted: boolean | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && typeof est.usage === 'number' && typeof est.quota === 'number') {
      usage = est.usage;
      quota = est.quota;
    }
  } catch {
    /* the browser cannot say */
  }
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    /* unknown */
  }
  return { usage, quota, persisted, photoBytes: await getPhotoBytes() };
}

/** Settings > Storage: how much space the journal uses, whether the browser promised to keep it, and the D6 warnings. */
export default function StorageSection() {
  const version = useDataVersion();
  const [reading, setReading] = useState<Reading | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    read().then(
      (r) => alive && (setReading(r), setFailed(false)),
      (err) => {
        console.error(err);
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [version]);

  const fraction = reading ? fractionUsed(reading) : null;
  const level = reading ? assessStorage(reading) : 'ok';

  return (
    <section className={s.block}>
      <h3>{t('settings.section.storage')}</h3>
      {failed && !reading && <p>{t('storage.unavailable')}</p>}
      {reading && (
        <>
          <ul className={s.list}>
            <li className={s.row}>
              <span>{t('storage.used')}</span>
              <span className={s.value}>
                {reading.usage !== null && reading.quota !== null
                  ? t('storage.of', { used: formatBytes(reading.usage), quota: formatBytes(reading.quota) })
                  : t('storage.unknown')}
              </span>
            </li>
            <li className={s.row}>
              <span>{t('storage.photos')}</span>
              <span className={s.value}>{formatBytes(reading.photoBytes)}</span>
            </li>
            <li className={s.row}>
              <span>{t('storage.persist')}</span>
              <span className={s.value}>
                {reading.persisted === null ? t('storage.unknown') : reading.persisted ? t('storage.persist.yes') : t('storage.persist.no')}
              </span>
            </li>
          </ul>
          {level === 'nearFull' && (
            <p className={s.storageWarn} role="alert">{t('storage.warn.nearFull', { percent: Math.min(100, Math.round((fraction ?? 0) * 100)) })}</p>
          )}
          {level === 'photos' && <p className={s.storageWarn} role="status">{t('storage.warn.photos')}</p>}
          {reading.persisted === false && <p className={s.storageNote}>{t('storage.persist.note')}</p>}
        </>
      )}
    </section>
  );
}
