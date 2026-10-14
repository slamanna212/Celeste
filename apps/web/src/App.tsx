import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { PanelProvider } from './lib/store';
import { EndedPage } from './pages/Ended';
import { HistoryPage } from './pages/History';
import { PlayerPage } from './pages/Player';
import { QueuePage } from './pages/Queue';
import { RadioPage } from './pages/Radio';
import { SearchPage } from './pages/Search';

export function App() {
  const { pathname } = useLocation();
  if (pathname === '/ended') return <EndedPage />;
  return (
    <PanelProvider>
      <Shell>
        <Routes>
          <Route path="/player" element={<PlayerPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/radio" element={<RadioPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/player" replace />} />
        </Routes>
      </Shell>
    </PanelProvider>
  );
}
