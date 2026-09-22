import { render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import { API, SERIES, STUDY, instanceJson, server, volumeInfoJson } from '../test/msw';

const SERIES2 = '1.2.3.5';

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
import { useVolume, type VolumeState } from './useVolume';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

// A loadVolume stand-in that actually honors the AbortSignal the way the real
// src/cornerstone/volume.ts implementation does: it stays pending until
// either aborted (rejects with AbortError) or a microtask later (resolves).
// The plain default mock above ignores the signal entirely, which can't
// exercise abort-driven behavior -- StrictMode's synthetic unmount fires
// before any microtask runs, so only a signal-aware mock can be caught
// mid-flight by it.
const signalAwareLoadVolume = (
  id: string,
  ids: string[],
  onProgress?: (d: number, t: number) => void,
  signal?: AbortSignal,
) =>
  new Promise<{ volumeId: string }>((resolve, reject) => {
    const onAbort = () =>
      reject(Object.assign(new Error('Volume load aborted'), { name: 'AbortError' }));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);
    queueMicrotask(() => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return;
      onProgress?.(ids.length, ids.length);
      resolve({ volumeId: id });
    });
  });

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

test('inside StrictMode, the dev mount→cleanup→remount cycle still reaches ready', async () => {
  // React 18/19 StrictMode (dev only) mounts, immediately tears down, then
  // remounts -- but only on the very first COMMIT where a component's
  // effects do real work; it never double-invokes a later update commit.
  // useVolume's loading effect is a no-op until infoQ/metaQ have data, so
  // with an empty cache that "real" commit is an update, not the mount, and
  // StrictMode would never touch it -- pre-seeding the QueryClient makes
  // that data available synchronously, so the real work lands on the mount
  // commit and is actually double-invoked (verified empirically: without
  // pre-seeding, this test passes even against the pre-fix code, i.e. it
  // wasn't exercising the bug at all).
  //
  // Also note: renderHook's own TestComponent captures its result via a
  // dependency-less useEffect, which -- empirically, in this React/RTL/jsdom
  // combination -- stops React's StrictMode double-invoke pass from reaching
  // descendant effects entirely (plain `render` does reproduce the real
  // mount->cleanup->remount cycle; `renderHook` does not). So this uses
  // `render` with a probe component that captures state during render
  // (no extra effect) rather than `renderHook`.
  //
  // The first (synthetic) teardown aborts this hook's in-flight load; the
  // fix must let the second (real) mount start a fresh attempt rather than
  // being latched out by a stale "already started" guard.
  loadVolume
    .mockImplementationOnce(signalAwareLoadVolume)
    .mockImplementationOnce(signalAwareLoadVolume);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['volume-info', SERIES], volumeInfoJson);
  qc.setQueryData(['metadata', STUDY, SERIES], {
    instances: [
      { sopUid: '1.1', numFrames: 1, raw: {} },
      { sopUid: '1.2', numFrames: 1, raw: {} },
      { sopUid: '1.3', numFrames: 1, raw: {} },
      { sopUid: '1.4', numFrames: 1, raw: {} },
    ],
    sortMethod: 'geometry',
  });
  const captured: { current: VolumeState | null } = { current: null };
  function Probe() {
    // Deliberately capturing during render (not in a useEffect, as
    // renderHook itself does) is what makes this test able to observe
    // StrictMode's double-invoke of useVolume's effects at all -- see the
    // comment above. oxlint's react(immutability) warning on this line is
    // expected and accepted for that reason.
    captured.current = useVolume(STUDY, SERIES);
    return null;
  }
  render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(captured.current?.status).toBe('ready'));
  expect(captured.current?.volumeId).toBe(`vol:${SERIES}`);
  expect(captured.current?.error).toBeNull();
  expect(loadVolume).toHaveBeenCalledTimes(2);
});

test('changing seriesUid on a mounted hook loads the new series', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES2}/volume-info`, () =>
      HttpResponse.json({ ...volumeInfoJson, seriesUid: SERIES2 }),
    ),
    http.get(`${API}/dicomweb/studies/${STUDY}/series/${SERIES2}/metadata`, () =>
      HttpResponse.json([instanceJson('2.1', 0), instanceJson('2.2', 1)], {
        headers: { 'X-Sort-Method': 'geometry' },
      }),
    ),
  );
  const { result, rerender } = renderHook(
    ({ seriesUid }: { seriesUid: string }) => useVolume(STUDY, seriesUid),
    { wrapper, initialProps: { seriesUid: SERIES } },
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.volumeId).toBe(`vol:${SERIES}`);
  expect(loadVolume).toHaveBeenCalledTimes(1);

  rerender({ seriesUid: SERIES2 });

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.volumeId).toBe(`vol:${SERIES2}`);
  expect(loadVolume).toHaveBeenCalledTimes(2);
  expect(loadVolume).toHaveBeenNthCalledWith(
    2,
    `vol:${SERIES2}`,
    ['wadors:2.1', 'wadors:2.2'],
    expect.any(Function),
    expect.any(AbortSignal),
  );
});
