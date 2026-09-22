import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { SeriesGrid } from './SeriesGrid';
import { API, SERIES, STUDY, server, volumeInfoJson } from '../../test/msw';

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

test('volume series renders as a link with dims', async () => {
  render(wrap(<SeriesGrid studyUid={STUDY} />));
  const link = await screen.findByRole('link', { name: /Synthetic series/ });
  expect(link).toHaveAttribute('href', `/viewer/${STUDY}/${SERIES}`);
  expect(await screen.findByText('16 × 16 × 4')).toBeInTheDocument();
});

test('non-volume series is greyed with reason and not a link', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/volume-info`, () =>
      HttpResponse.json({
        ...volumeInfoJson,
        isVolume: false,
        reason: 'fewer than 3 slices',
        dims: null,
      }),
    ),
  );
  render(wrap(<SeriesGrid studyUid={STUDY} />));
  expect(await screen.findByText('fewer than 3 slices')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Synthetic series/ })).toBeNull();
});

test('card is neutral (not greyed, no reason) while volume-info is loading, then becomes a link', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/volume-info`, async () => {
      await delay(50);
      return HttpResponse.json(volumeInfoJson);
    }),
  );
  const { container } = render(wrap(<SeriesGrid studyUid={STUDY} />));

  await screen.findByText('Synthetic series');
  expect(container.querySelector('.opacity-50')).toBeNull();
  expect(screen.queryByRole('link', { name: /Synthetic series/ })).toBeNull();
  expect(screen.queryByText(/fewer than 3 slices/)).toBeNull();

  const link = await screen.findByRole('link', { name: /Synthetic series/ });
  expect(link).toHaveAttribute('href', `/viewer/${STUDY}/${SERIES}`);
  expect(await screen.findByText('16 × 16 × 4')).toBeInTheDocument();
});
