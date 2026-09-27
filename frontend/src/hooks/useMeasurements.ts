import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getMeasurements, putMeasurements } from '../api/measurements';
import type { MeasurementSet } from '../api/types';
import { clearAnnotations, loadAnnotations, readAnnotations } from '../cornerstone/annotations';

export interface MeasurementsState {
  status: 'loading' | 'ready' | 'error';
  set: MeasurementSet | null;
  parseError: string | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  markDirty: () => void;
  save: () => Promise<void>;
}

export function useMeasurements(seriesUid: string, ready: boolean): MeasurementsState {
  const qc = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed to the series rather than a bare boolean: switching series without
  // remounting must load the new report, not leave the old set on screen.
  const loadedFor = useRef<string | null>(null);

  const q = useQuery({
    queryKey: ['measurements', seriesUid],
    queryFn: () => getMeasurements(seriesUid),
    enabled: Boolean(seriesUid),
  });

  const forUid = q.data?.frameOfReferenceUid ?? '';
  const data = q.data;

  useEffect(() => {
    if (!ready || !data || loadedFor.current === seriesUid) return;
    clearAnnotations();
    loadAnnotations(data.measurements, forUid);
    loadedFor.current = seriesUid;
    setDirty(false);
    setError(null);
  }, [ready, data, seriesUid, forUid]);

  useEffect(
    () => () => {
      // Cornerstone's annotation state is global, so leaving the viewer has to
      // clear it or the next series inherits these.
      clearAnnotations();
      loadedFor.current = null;
    },
    [seriesUid],
  );

  const mutation = useMutation({
    mutationFn: () => putMeasurements(seriesUid, data?.srSopUid ?? null, readAnnotations(forUid)),
    onSuccess: (next) => {
      qc.setQueryData(['measurements', seriesUid], next);
      setDirty(false);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutateAsync } = mutation;
  const save = useCallback(async () => {
    try {
      await mutateAsync();
    } catch {
      /* surfaced through `error` by onError */
    }
  }, [mutateAsync]);

  const markDirty = useCallback(() => setDirty(true), []);

  return {
    status: q.isPending ? 'loading' : q.isError ? 'error' : 'ready',
    set: data ?? null,
    parseError: data?.parseError ?? null,
    dirty,
    saving: mutation.isPending,
    error: error ?? (q.isError ? q.error.message : null),
    markDirty,
    save,
  };
}
