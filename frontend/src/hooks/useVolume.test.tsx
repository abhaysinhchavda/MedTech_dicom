import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { vi } from 'vitest';
import { API, SERIES, STUDY, server, volumeInfoJson } from '../test/msw';

// vi.mock factories are hoisted above this file's own top-level declarations,
// so the mocks they close over must be created inside vi.hoisted (see the
// same pattern in ../cornerstone/volume.test.ts).
const { loadVolume, releaseVolume } = vi.hoisted(() => ({
  loadVolume: vi.fn(
    async (id: string, ids: string[], onProgress?: (d: number, t: number) => void) => {
      onProgress?.(ids.length, ids.length);
      return { volumeId: id };
    },
  ),
  releaseVolume: vi.fn(),
}));
vi.mock('../cornerstone/volume', () => ({
  loadVolume,
  releaseVolume,
  volumeIdFor: (s: string) => `vol:${s}`,
}));
vi.mock('../cornerstone/imageIds', () => ({
  buildImageIds: (_s: string, _se: string, inst: { sopUid: string }[]) =>
    inst.map((i) => `wadors:${i.sopUid}`),
  seedMetadata: vi.fn(),
}));
import { useVolume } from './useVolume';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  loadVolume.mockClear();
  releaseVolume.mockClear();
});

test('info → metadata → loading → ready, then releases on unmount', async () => {
  const { result, unmount } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.volumeId).toBe(`vol:${SERIES}`);
  expect(result.current.progress).toEqual({ done: 4, total: 4 });
  expect(loadVolume).toHaveBeenCalledWith(
    `vol:${SERIES}`,
    ['wadors:1.1', 'wadors:1.2', 'wadors:1.3', 'wadors:1.4'],
    expect.any(Function),
    expect.any(AbortSignal),
  );
  unmount();
  expect(releaseVolume).toHaveBeenCalledWith(`vol:${SERIES}`);
});

test('non-volume series is blocked with reason and never loads', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/volume-info`, () =>
      HttpResponse.json({ ...volumeInfoJson, isVolume: false, reason: 'mixed orientations' }),
    ),
  );
  const { result } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('blocked'));
  expect(result.current.error).toBe('mixed orientations');
  expect(loadVolume).not.toHaveBeenCalled();
});

test('loader failure → error', async () => {
  loadVolume.mockRejectedValueOnce(new Error('slice failed to load: x'));
  const { result } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toMatch(/slice failed/);
});

test('volumes over 1 GB ask for confirmation; cancel → error, no load', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/volume-info`, () =>
      HttpResponse.json({ ...volumeInfoJson, estimatedBytes: 2e9 }),
    ),
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/2\.0 GB/));
  expect(result.current.error).toBe('Load cancelled');
  expect(loadVolume).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test('unmounting mid-load aborts the controller and does not surface as an error', async () => {
  let capturedSignal: AbortSignal | undefined;
  loadVolume.mockImplementationOnce(
    (
      _id: string,
      _ids: string[],
      _onProgress?: (d: number, t: number) => void,
      signal?: AbortSignal,
    ) =>
      new Promise((_resolve, reject) => {
        capturedSignal = signal;
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('Volume load aborted'), { name: 'AbortError' }));
        });
      }),
  );
  const { result, unmount } = renderHook(() => useVolume(STUDY, SERIES), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('loading'));

  unmount();

  expect(capturedSignal?.aborted).toBe(true);
  expect(releaseVolume).toHaveBeenCalledWith(`vol:${SERIES}`);
  // Let the AbortError rejection's handler run; it must be swallowed rather
  // than surfacing as an unhandled rejection or a post-unmount error state.
  await Promise.resolve();
  await Promise.resolve();
});
