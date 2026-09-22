import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { BrowserPage } from './components/browser/BrowserPage';
import { ViewerPage } from './components/viewer/ViewerPage';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BrowserPage />} />
          <Route path="/viewer/:studyUid/:seriesUid" element={<ViewerPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
