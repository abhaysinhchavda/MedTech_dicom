import type { DicomJson } from './types';

const vals = (j: DicomJson, tag: string): unknown[] => j[tag]?.Value ?? [];
export const str = (j: DicomJson, tag: string): string => {
  const v = vals(j, tag)[0];
  return v == null ? '' : String(v);
};
export const num = (j: DicomJson, tag: string): number | null => {
  const v = vals(j, tag)[0];
  return typeof v === 'number' ? v : v == null ? null : Number(v);
};
export const strs = (j: DicomJson, tag: string): string[] => vals(j, tag).map(String);
export const pn = (j: DicomJson, tag: string): string => {
  const v = vals(j, tag)[0] as { Alphabetic?: string } | string | undefined;
  return typeof v === 'object' && v ? (v.Alphabetic ?? '') : v ? String(v) : '';
};
