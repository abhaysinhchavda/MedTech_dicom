import { apiFetch } from './client';
import type { MeasurementItem, MeasurementSet } from './types';

export const getMeasurements = (seriesUid: string): Promise<MeasurementSet> =>
  apiFetch<MeasurementSet>(`/api/series/${seriesUid}/measurements`);

export const putMeasurements = (
  seriesUid: string,
  srSopUid: string | null,
  measurements: MeasurementItem[],
): Promise<MeasurementSet> =>
  apiFetch<MeasurementSet>(`/api/series/${seriesUid}/measurements`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // srSopUid is the one the client loaded. The backend rejects the save with
    // a 409 if it is no longer current, so a second tab cannot be overwritten
    // silently.
    body: JSON.stringify({ srSopUid, measurements }),
  });
