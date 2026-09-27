import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getLabelmap, getSegmentation, putSegmentation } from '../api/segmentation';
import type { Segment, SegmentationSet } from '../api/types';
import {
  createLabelmap,
  fillLabelmap,
  readLabelmap,
  releaseSegmentation,
  segmentationIdFor,
  setActiveSegment as setActiveSegmentOnVolume,
  showSegmentation,
} from '../cornerstone/segmentation';

const DEFAULT_SEGMENT: Omit<Segment, 'trackingUid'> = {
  number: 1,
  label: 'Tumour',
  // Morphologically Abnormal Structure / Neoplasm, Primary. Verified against
  // pydicom's dictionary; the backend rejects anything it cannot map.
  categoryCode: '49755003',
  typeCode: '372087000',
};

/** DICOM's UUID-derived UID form (PS3.5 B.2), as the measurements use. */
function newTrackingUid(): string {
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `2.25.${BigInt(`0x${hex}`).toString(10)}`;
}

export interface SegmentationState {
  status: 'loading' | 'ready' | 'error';
  set: SegmentationSet | null;
  segments: Segment[];
  activeSegment: number;
  parseError: string | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  canSegment: boolean;
  selectSegment: (n: number) => void;
  addSegment: () => void;
  markDirty: () => void;
  save: () => Promise<void>;
}

export function useSegmentation(
  seriesUid: string,
  ready: boolean,
  referenceVolumeId: string | null,
  viewportIds: readonly string[],
): SegmentationState {
  const qc = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeSegment, setActive] = useState(1);
  // Keyed to the series, not a bare boolean: switching series without
  // remounting must load the new mask rather than keep the old one on screen.
  const loadedFor = useRef<string | null>(null);
  // Setting up the labelmap is itself a segmentation edit as far as
  // Cornerstone is concerned: creating it, filling it and adding it to a
  // viewport all fire SEGMENTATION_DATA_MODIFIED, and those events arrive a
  // frame after the load finishes, so clearing the flag at the end of the
  // load does not catch them. Without this gate every series opened with its
  // own Save button already armed, before anyone had painted a voxel.
  const painting = useRef(false);

  const q = useQuery({
    queryKey: ['segmentation', seriesUid],
    queryFn: () => getSegmentation(seriesUid),
    enabled: Boolean(seriesUid),
  });

  const data = q.data;
  const segmentationId = segmentationIdFor(seriesUid);

  useEffect(() => {
    if (!ready || !data || !referenceVolumeId || loadedFor.current === seriesUid) return;
    loadedFor.current = seriesUid;
    painting.current = false;
    let alive = true;
    void (async () => {
      await createLabelmap(referenceVolumeId, segmentationId);
      const bytes = await getLabelmap(seriesUid);
      if (!alive) return;
      if (bytes) fillLabelmap(segmentationId, bytes);
      showSegmentation(viewportIds, segmentationId);
      const restored = data.segments.length
        ? data.segments
        : [{ ...DEFAULT_SEGMENT, trackingUid: newTrackingUid() }];
      setSegments(restored);
      setActive(restored[0]!.number);
      setActiveSegmentOnVolume(segmentationId, restored[0]!.number);
      setDirty(false);
      setError(null);
      // One frame later, so the setup's own events have been and gone. A user
      // cannot paint inside a single frame of the volume becoming ready, so
      // nothing real is dropped here.
      requestAnimationFrame(() => {
        if (alive) painting.current = true;
      });
    })().catch((e: Error) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [ready, data, seriesUid, referenceVolumeId, segmentationId, viewportIds]);

  useEffect(
    () => () => {
      releaseSegmentation(segmentationIdFor(seriesUid));
      loadedFor.current = null;
    },
    [seriesUid],
  );

  const mutation = useMutation({
    mutationFn: () => {
      const bytes = readLabelmap(segmentationId);
      if (!bytes) throw new Error('no labelmap to save');
      if (!data?.dims) throw new Error('series has no volume dimensions');
      return putSegmentation(seriesUid, data.segSopUid, data.dims, segments, bytes);
    },
    onSuccess: (next) => {
      qc.setQueryData(['segmentation', seriesUid], next);
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

  const selectSegment = useCallback(
    (n: number) => {
      setActive(n);
      setActiveSegmentOnVolume(segmentationId, n);
    },
    [segmentationId],
  );

  const addSegment = useCallback(() => {
    setSegments((current) => {
      const number = Math.max(0, ...current.map((s) => s.number)) + 1;
      return [
        ...current,
        { ...DEFAULT_SEGMENT, number, label: `Segment ${number}`, trackingUid: newTrackingUid() },
      ];
    });
    setDirty(true);
  }, []);

  const markDirty = useCallback(() => {
    if (painting.current) setDirty(true);
  }, []);

  return {
    status: q.isPending ? 'loading' : q.isError ? 'error' : 'ready',
    set: data ?? null,
    segments,
    activeSegment,
    parseError: data?.parseError ?? null,
    dirty,
    saving: mutation.isPending,
    error: error ?? (q.isError ? q.error.message : null),
    canSegment: Boolean(data?.dims),
    selectSegment,
    addSegment,
    markDirty,
    save,
  };
}
