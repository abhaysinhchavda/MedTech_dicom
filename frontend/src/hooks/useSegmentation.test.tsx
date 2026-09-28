import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { useSegmentation } from './useSegmentation';
import { API, SERIES, server } from '../test/msw';

// Mocked for the same reason annotations.test.ts mocks it: the real package
// pulls vtk.js into jsdom and starves vitest's worker pool.
const labelmap = new Uint8Array(16 * 16 * 4);
labelmap[100] = 1;
vi.mock('../cornerstone/segmentation', () => ({
  segmentationIdFor: (s: string) => `seg:${s}`,
  createLabelmap: vi.fn(async () => undefined),
  fillLabelmap: vi.fn(),
  readLabelmap: vi.fn(() => labelmap),
  showSegmentation: vi.fn(),
  setActiveSegment: vi.fn(),
  releaseSegmentation: vi.fn(),
}));

const VIEWPORTS = ['axial', 'sagittal', 'coronal'] as const;

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const render = () =>
  renderHook(() => useSegmentation(SERIES, true, 'vol:1', VIEWPORTS), { wrapper: wrap });

test('loads, offers a default segment and is not dirty', async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await waitFor(() => expect(result.current.segments).toHaveLength(1));
  expect(result.current.segments[0]!.label).toBe('Tumour');
  // A DICOM UID, not a UUID: it is stored as a Tracking UID, whose VR is UI.
  expect(result.current.segments[0]!.trackingUid).toMatch(/^2\.25\.[0-9]+$/);
  expect(result.current.dirty).toBe(false);
  expect(result.current.canSegment).toBe(true);
});

test('markDirty then save sends the labelmap and clears dirty', async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.segments).toHaveLength(1));

  act(() => result.current.markDirty());
  expect(result.current.dirty).toBe(true);

  await act(async () => {
    await result.current.save();
  });
  await waitFor(() => expect(result.current.dirty).toBe(false));
  expect(result.current.set?.segSopUid).toBe('1.2.9.4');
});

test('adding a segment numbers it and marks the set dirty', async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.segments).toHaveLength(1));

  act(() => result.current.addSegment());

  expect(result.current.segments.map((s) => s.number)).toEqual([1, 2]);
  expect(result.current.dirty).toBe(true);
});

test('a save conflict surfaces as an error without clearing dirty', async () => {
  server.use(
    http.put(`${API}/api/series/${SERIES}/segmentation`, () =>
      HttpResponse.json({ detail: 'segmentation changed since it was loaded' }, { status: 409 }),
    ),
  );
  const { result } = render();
  await waitFor(() => expect(result.current.segments).toHaveLength(1));
  act(() => result.current.markDirty());

  await act(async () => {
    await result.current.save();
  });

  await waitFor(() => expect(result.current.error).toMatch(/changed since/));
  expect(result.current.dirty).toBe(true);
});

test('an unreadable segmentation is surfaced and leaves the viewer usable', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/segmentation`, () =>
      HttpResponse.json({
        seriesUid: SERIES,
        frameOfReferenceUid: '1.2.9',
        dims: [16, 16, 4],
        segSeriesUid: '1.2.9.3',
        segSopUid: '1.2.9.4',
        parseError: 'SegParseError: dataset is not a Segmentation instance',
        segments: [],
      }),
    ),
  );
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.parseError).toMatch(/not a Segmentation/);
  expect(result.current.status).toBe('ready');
});
