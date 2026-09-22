import { apiFetch, apiFetchWithHeaders, apiUrl } from './client';
import { num, pn, str, strs } from './dicomJson';
import type { DicomJson, Series, SeriesMetadata, Study } from './types';

export async function getStudies(): Promise<Study[]> {
  const rows = await apiFetch<DicomJson[]>('/dicomweb/studies');
  return rows.map((j) => ({
    studyUid: str(j, '0020000D'),
    patientName: pn(j, '00100010'),
    patientId: str(j, '00100020'),
    studyDate: str(j, '00080020'),
    description: str(j, '00081030'),
    modalities: strs(j, '00080061'),
    numSeries: num(j, '00201206') ?? 0,
    numInstances: num(j, '00201208') ?? 0,
  }));
}

export async function getSeries(studyUid: string): Promise<Series[]> {
  const rows = await apiFetch<DicomJson[]>(`/dicomweb/studies/${studyUid}/series`);
  return rows.map((j) => ({
    seriesUid: str(j, '0020000E'),
    studyUid: str(j, '0020000D') || studyUid,
    modality: str(j, '00080060'),
    description: str(j, '0008103E'),
    seriesNumber: num(j, '00200011'),
    numInstances: num(j, '00201209') ?? 0,
    thumbSopUid: str(j, '00080018') || undefined,
  }));
}

export async function getSeriesMetadata(
  studyUid: string,
  seriesUid: string,
): Promise<SeriesMetadata> {
  const { body, headers } = await apiFetchWithHeaders<DicomJson[]>(
    `/dicomweb/studies/${studyUid}/series/${seriesUid}/metadata`,
  );
  return {
    sortMethod: headers.get('X-Sort-Method') ?? 'unknown',
    instances: body.map((raw) => ({
      sopUid: str(raw, '00080018'),
      numFrames: num(raw, '00280008') ?? 1,
      raw,
    })),
  };
}

export const frameUrl = (
  studyUid: string,
  seriesUid: string,
  sopUid: string,
  frame: number,
): string =>
  apiUrl(`/dicomweb/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/frames/${frame}`);

export const thumbnailUrl = (
  studyUid: string,
  seriesUid: string,
  sopUid: string,
  size = 128,
): string =>
  apiUrl(
    `/dicomweb/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/rendered?viewport=${size},${size}`,
  );
