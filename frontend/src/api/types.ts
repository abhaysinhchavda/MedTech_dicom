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
export interface UploadSummary {
  accepted: number;
  skipped: { file: string; reason: string }[];
  studyUids: string[];
}
