export interface Study {
  studyUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  description: string;
  modalities: string[];
  numSeries: number;
  numInstances: number;
}
export interface Series {
  seriesUid: string;
  studyUid: string;
  modality: string;
  description: string;
  seriesNumber: number | null;
  numInstances: number;
  thumbSopUid?: string;
}
export type DicomJson = Record<string, { vr: string; Value?: unknown[] }>;
export interface InstanceMeta {
  sopUid: string;
  numFrames: number;
  raw: DicomJson;
}
export interface InstanceSummary {
  sopUid: string;
  instanceNumber: number | null;
}
export interface SeriesMetadata {
  instances: InstanceMeta[];
  sortMethod: string;
}
export interface VolumeInfo {
  seriesUid: string;
  isVolume: boolean;
  reason: string | null;
  dims: [number, number, number] | null;
  spacing: [number, number, number] | null;
  origin: [number, number, number] | null;
  direction: number[] | null;
  modality: string | null;
  sortMethod: string | null;
  instanceCount: number;
  estimatedBytes: number | null;
}
export type ToolName = 'Length' | 'Angle' | 'Probe' | 'EllipticalROI';
export interface MeasurementValue {
  name: string;
  value: number;
  unit: string;
}
export interface Plane {
  normal: [number, number, number];
  up: [number, number, number];
}
export interface MeasurementItem {
  /**
   * A DICOM UID, not a UUID. It is stored as the Tracking Unique Identifier,
   * whose value representation is UI, so the backend rejects anything that is
   * not dot-separated digits. See `toWire` in cornerstone/annotations.ts.
   */
  id: string;
  tool: ToolName;
  points: [number, number, number][];
  plane: Plane;
  values: MeasurementValue[];
  label: string | null;
}
export interface MeasurementSet {
  seriesUid: string;
  frameOfReferenceUid: string | null;
  srSeriesUid: string | null;
  srSopUid: string | null;
  parseError: string | null;
  measurements: MeasurementItem[];
}
export interface UploadSummary {
  accepted: number;
  skipped: { file: string; reason: string }[];
  studyUids: string[];
}
