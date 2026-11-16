import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import InstallHint from './components/InstallHint';
import UpdatePrompt from './components/UpdatePrompt';
import EmptyState from './components/EmptyState';
import CalendarScreen from './features/calendar/CalendarScreen';
import CollectionScreen from './features/collections/CollectionScreen';
import CollectionsScreen from './features/collections/CollectionsScreen';
import GalleryScreen from './features/gallery/GalleryScreen';
import DailyJournal from './features/journal/DailyJournal';
import Settings from './features/settings/Settings';
import ManageBars from './features/bars/ManageBars';
import ManageTags from './features/tags/ManageTags';
import AddEntryScreen from './features/add/AddEntryScreen';
import EditEntryScreen from './features/add/EditEntryScreen';
import EntryDetail from './features/entry/EntryDetail';
import { bootstrap } from './db/bootstrap';
import { t } from './i18n';

export default function App() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    bootstrap()
      .then(() => alive && setState('ready'))
      .catch((e) => {
        console.error(e);
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state === 'loading') return null; // opens in a few ms; the dark background avoids any flash
  if (state === 'error') {
    return (
      <EmptyState
        title={t('error.storage.title')}
        body={t('error.storage.body')}
        action={<button onClick={() => { setState('loading'); setAttempt((n) => n + 1); }} style={{ color: 'var(--accent-hi)', padding: 10 }}>{t('error.retry')}</button>}
      />
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<CalendarScreen />} />
        <Route path="/day/:dayKey" element={<DailyJournal />} />
        <Route path="/gallery" element={<GalleryScreen />} />
        <Route path="/add" element={<AddEntryScreen />} />
        <Route path="/entry/:id" element={<EntryDetail />} />
        <Route path="/entry/:id/edit" element={<EditEntryScreen />} />
        <Route path="/collections" element={<CollectionsScreen />} />
        <Route path="/collections/:kind" element={<CollectionScreen />} />
        <Route path="/collections/:kind/:tagId" element={<CollectionScreen />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/tags" element={<ManageTags />} />
        <Route path="/settings/bars" element={<ManageBars />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
      <InstallHint />
      <UpdatePrompt />
    </>
  );
}
