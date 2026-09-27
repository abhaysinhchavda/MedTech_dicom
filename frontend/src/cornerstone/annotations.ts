import { annotation } from '@cornerstonejs/tools';
import type { MeasurementItem, MeasurementValue, ToolName } from '../api/types';

const TOOLS: ToolName[] = ['Length', 'Angle', 'Probe', 'EllipticalROI'];

// Cornerstone stores each tool's results under `cachedStats`, keyed by a
// string that embeds the volume id, with a different shape per tool. These
// maps are the whole translation: wire value name on the left, cachedStats
// key on the right.
const STAT_KEYS: Record<ToolName, Record<string, string>> = {
  Length: { Length: 'length' },
  Angle: { Angle: 'angle' },
  Probe: { Mean: 'value' },
  EllipticalROI: { Area: 'area', Mean: 'mean', StandardDeviation: 'stdDev' },
};
const UNITS: Record<string, string> = {
  Length: 'mm',
  Angle: 'deg',
  Area: 'mm2',
  Mean: '1',
  StandardDeviation: '1',
};

const DICOM_UID = /^[0-9]+(\.[0-9]+)*$/;

/**
 * Cornerstone names each annotation with a UUID, but the report stores that
 * name as a Tracking Unique Identifier, whose value representation is UI.
 * DICOM's own answer to exactly this problem is the UUID-derived UID form
 * `2.25.<uuid as a single integer>` (PS3.5 B.2), which is what this builds.
 * An id that already looks like a UID is left alone, so a measurement read
 * back out of a report keeps the identity it was stored with.
 */
export function toDicomUid(annotationUID: string): string {
  if (DICOM_UID.test(annotationUID)) return annotationUID;
  const hex = annotationUID.replace(/[^0-9a-fA-F]/g, '');
  if (!hex) return annotationUID;
  return `2.25.${BigInt(`0x${hex}`).toString(10)}`;
}

export interface WireAnnotation {
  annotationUID: string;
  highlighted: boolean;
  invalidated: boolean;
  isLocked: boolean;
  isVisible: boolean;
  metadata: {
    toolName: string;
    FrameOfReferenceUID: string;
    viewPlaneNormal: [number, number, number];
    viewUp: [number, number, number];
  };
  data: {
    label?: string;
    handles: { points: [number, number, number][]; activeHandleIndex: number | null };
    cachedStats: Record<string, Record<string, number>>;
  };
}

const firstStats = (a: WireAnnotation): Record<string, number> =>
  Object.values(a.data.cachedStats ?? {})[0] ?? {};

export function fromWire(item: MeasurementItem, frameOfReferenceUID = ''): WireAnnotation {
  return {
    annotationUID: item.id,
    highlighted: false,
    // The report persists geometry, not statistics. `invalidated` makes
    // Cornerstone recompute length, angle and ROI values against the volume
    // that is actually loaded, which is both more truthful than replaying
    // stored numbers and the only way to avoid fabricating a cachedStats key:
    // those keys must be a real targetId ("volumeId:..."), and anything else
    // makes getTargetIdImage throw on the first render.
    invalidated: true,
    isLocked: false,
    isVisible: true,
    metadata: {
      toolName: item.tool,
      FrameOfReferenceUID: frameOfReferenceUID,
      // Restoring these is the whole reason the report carries the view plane:
      // without them Cornerstone cannot put the annotation back on the plane
      // it was drawn on.
      viewPlaneNormal: item.plane.normal,
      viewUp: item.plane.up,
    },
    data: {
      ...(item.label ? { label: item.label } : {}),
      handles: { points: item.points, activeHandleIndex: null },
      cachedStats: {},
    },
  };
}

export function toWire(a: WireAnnotation): MeasurementItem | null {
  const tool = a.metadata.toolName as ToolName;
  if (!TOOLS.includes(tool)) return null;
  const stats = firstStats(a);
  const values: MeasurementValue[] = Object.entries(STAT_KEYS[tool])
    .filter(([, key]) => typeof stats[key] === 'number' && Number.isFinite(stats[key]))
    .map(([name, key]) => ({ name, value: stats[key]!, unit: UNITS[name]! }));
  return {
    id: toDicomUid(a.annotationUID),
    tool,
    points: a.data.handles.points,
    plane: { normal: a.metadata.viewPlaneNormal, up: a.metadata.viewUp },
    values,
    label: a.data.label ?? null,
  };
}

export function loadAnnotations(items: MeasurementItem[], frameOfReferenceUID: string): void {
  for (const item of items)
    annotation.state.addAnnotation(
      fromWire(item, frameOfReferenceUID) as never,
      frameOfReferenceUID,
    );
}

export function readAnnotations(frameOfReferenceUID: string): MeasurementItem[] {
  const out: MeasurementItem[] = [];
  for (const tool of TOOLS) {
    const found = annotation.state.getAnnotations(tool, frameOfReferenceUID) ?? [];
    for (const a of found) {
      const item = toWire(a as unknown as WireAnnotation);
      if (item) out.push(item);
    }
  }
  return out;
}

export function clearAnnotations(): void {
  annotation.state.removeAllAnnotations();
}
