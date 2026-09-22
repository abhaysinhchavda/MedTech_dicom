import { apiFetch } from './client';
import type { VolumeInfo } from './types';
export const getVolumeInfo = (seriesUid: string): Promise<VolumeInfo> =>
  apiFetch<VolumeInfo>(`/api/series/${seriesUid}/volume-info`);
