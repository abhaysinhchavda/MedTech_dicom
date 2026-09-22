import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getVolumeInfo } from '../api/volume';
import type { VolumeInfo } from '../api/types';
import { buildImageIds, seedMetadata } from '../cornerstone/imageIds';
import { loadVolume, releaseVolume, volumeIdFor } from '../cornerstone/volume';
import { useSeriesMetadata } from './useSeriesMetadata';

export type VolumeStatus = 'info' | 'metadata' | 'loading' | 'ready' | 'blocked' | 'error';
export interface VolumeState {
  status: VolumeStatus;
  info: VolumeInfo | null;
  progress: { done: number; total: number };
  volumeId: string | null;
  error: string | null;
}
type LoadState = { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string };
const GB = 1e9;

// AbortError rejections are the expected outcome of an unmount/series-change
// tearing down an in-flight load, not a load failure -- they must never reach
// the `error` state.
function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export function useVolume(studyUid: string, seriesUid: string): VolumeState {
  const infoQ = useQuery({
    queryKey: ['volume-info', seriesUid],
    queryFn: () => getVolumeInfo(seriesUid),
  });
  const canLoad = infoQ.data?.isVolume === true;
  const metaQ = useSeriesMetadata(studyUid, seriesUid, canLoad);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const volumeId = volumeIdFor(seriesUid);
  // Which series the current load attempt belongs to, rather than a plain
  // boolean. A boolean latch that's never cleared blocks every future load:
  // switching seriesUid while mounted would never start the new series, and
  // in StrictMode's dev mount->cleanup->remount cycle the teardown effect
  // (below) aborts the first attempt before the second (real) effect run
  // sees a clear latch, so the hook gets stuck at 'loading' forever. Keying
  // by seriesUid -- and clearing it in the teardown cleanup -- lets a fresh
  // attempt start whenever this series' in-flight/loaded resource is torn
  // down, whether that's a StrictMode remount of the same series, a real
  // series change, or an actual unmount.
  const startedRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const info = infoQ.data;
    if (!canLoad || !info || !metaQ.data || startedRef.current === seriesUid) return;
    startedRef.current = seriesUid;
    // Clear any stale progress/error left over from a previous series (or a
    // previous, torn-down attempt at this same series) before starting.
    setProgress({ done: 0, total: 0 });
    setLoad({ status: 'idle' });
    const bytes = info.estimatedBytes ?? 0;
    if (
      bytes > GB &&
      !window.confirm(`This volume needs ~${(bytes / GB).toFixed(1)} GB of GPU memory. Load it?`)
    ) {
      setLoad({ status: 'error', error: 'Load cancelled' });
      return;
    }
    const imageIds = buildImageIds(studyUid, seriesUid, metaQ.data.instances);
    seedMetadata(imageIds, metaQ.data.instances);
    setProgress({ done: 0, total: imageIds.length });
    setLoad({ status: 'loading' });
    const controller = new AbortController();
    controllerRef.current = controller;
    loadVolume(
      volumeId,
      imageIds,
      (done, total) => setProgress({ done, total }),
      controller.signal,
    ).then(
      () => setLoad({ status: 'ready' }),
      (e: Error) => {
        if (isAbortError(e)) return;
        setLoad({ status: 'error', error: e.message });
      },
    );
  }, [canLoad, infoQ.data, metaQ.data, studyUid, seriesUid, volumeId]);

  // Single teardown point: abort any in-flight load and release the cached
  // volume for the render it was created in, whether the component unmounts,
  // seriesUid changes, or (dev-only) StrictMode tears down the first of its
  // two mount passes. Clearing startedRef here -- not just re-keying it --
  // is what lets the following setup start a fresh attempt instead of being
  // latched out.
  useEffect(
    () => () => {
      if (startedRef.current === seriesUid) {
        controllerRef.current?.abort();
        releaseVolume(volumeId);
        startedRef.current = null;
      }
    },
    [volumeId, seriesUid],
  );

  const info = infoQ.data ?? null;
  const base = { info, progress };
  if (infoQ.isError)
    return { ...base, status: 'error', volumeId: null, error: infoQ.error.message };
  if (infoQ.isPending || !info) return { ...base, status: 'info', volumeId: null, error: null };
  if (!info.isVolume) {
    return { ...base, status: 'blocked', volumeId: null, error: info.reason ?? 'not a volume' };
  }
  if (metaQ.isError)
    return { ...base, status: 'error', volumeId: null, error: metaQ.error.message };
  if (load.status === 'error') {
    return { ...base, status: 'error', volumeId: null, error: load.error ?? 'load failed' };
  }
  if (metaQ.isPending || load.status === 'idle') {
    return { ...base, status: 'metadata', volumeId: null, error: null };
  }
  if (load.status === 'loading') return { ...base, status: 'loading', volumeId: null, error: null };
  return { ...base, status: 'ready', volumeId, error: null };
}
