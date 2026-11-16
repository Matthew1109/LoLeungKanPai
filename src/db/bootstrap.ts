import { getDb, setMeta } from './index';
import { seedDefaultTags } from './tagRepo';
import { syncBarsFromEntries } from './barRepo';
import { sweepOrphanPhotos } from './maintenance';

/**
 * Opens the database, seeds the default tag libraries once, adds a library bar for every bar name the existing
 * drinks already use (a quiet no-op when there is nothing new), and asks the browser to treat storage as persistent.
 * Persistence is a request, never a guarantee (iOS may refuse or later evict), so backup remains essential.
 * Finally starts the orphan-photo sweep in the background (it never blocks or fails the start-up).
 */
export async function bootstrap(): Promise<void> {
  await getDb();
  await seedDefaultTags();
  try {
    await syncBarsFromEntries();
  } catch (err) {
    console.warn('Could not register bars from existing drinks (retried next start)', err);
  }
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      await setMeta('persistGranted', granted);
    }
  } catch {
    /* non-fatal */
  }
  sweepOrphanPhotos().catch((err) => console.warn('Orphan sweep failed (harmless, retried next start)', err));
}
