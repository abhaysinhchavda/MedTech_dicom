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
  const started = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const info = infoQ.data;
    if (!canLoad || !info || !metaQ.data || started.current) return;
    started.current = true;
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
  // volume together, whether the component unmounts or seriesUid changes.
  useEffect(
    () => () => {
      if (started.current) {
        controllerRef.current?.abort();
        releaseVolume(volumeId);
      }
    },
    [volumeId],
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
