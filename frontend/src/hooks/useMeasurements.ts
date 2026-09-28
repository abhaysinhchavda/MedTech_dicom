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
  // The geometry as the stored report holds it. `null` means "nothing loaded
  // yet", which is why the swap below clears it before touching Cornerstone.
  const saved = useRef<string | null>(null);

  const q = useQuery({
    queryKey: ['measurements', seriesUid],
    queryFn: () => getMeasurements(seriesUid),
    enabled: Boolean(seriesUid),
  });

  const forUid = q.data?.frameOfReferenceUid ?? '';
  const data = q.data;

  /**
   * What the report actually stores, as one comparable string.
   *
   * Deliberately geometry and label only. Cornerstone recomputes a restored
   * measurement's statistics against the loaded volume -- that is what
   * `invalidated` asks it to do -- so its numbers change without anyone
   * editing anything. Including them here would make every series that
   * already had a report look unsaved the moment it opened.
   */
  const geometry = useCallback(
    () =>
      JSON.stringify(
        readAnnotations(forUid)
          .map((m) => [m.id, m.tool, m.points, m.label])
          .sort(),
      ),
    [forUid],
  );

  useEffect(() => {
    if (!ready || !data || loadedFor.current === seriesUid) return;
    // Cleared first: removing the previous series' annotations is itself a
    // change Cornerstone reports, and it must not be measured against a
    // baseline that no longer applies.
    saved.current = null;
    clearAnnotations();
    loadAnnotations(data.measurements, forUid);
    saved.current = geometry();
    loadedFor.current = seriesUid;
    setDirty(false);
    setError(null);
  }, [ready, data, seriesUid, forUid, geometry]);

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
      // What is on screen is now what is stored, so it becomes the baseline.
      // Without this the next recompute would be measured against the report
      // that was just replaced, and arm Save again.
      saved.current = geometry();
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

  const markDirty = useCallback(() => {
    // Cornerstone fires the same event for "the user moved a handle" and for
    // "I recalculated this restored annotation's numbers". Only the first is
    // an edit, and the difference is visible in the geometry, so ask.
    if (saved.current === null) return;
    if (geometry() !== saved.current) setDirty(true);
  }, [geometry]);

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
