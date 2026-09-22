import { useQuery } from '@tanstack/react-query';
import { getSeriesMetadata } from '../api/dicomweb';

export const useSeriesMetadata = (studyUid: string, seriesUid: string, enabled = true) =>
  useQuery({
    queryKey: ['metadata', studyUid, seriesUid],
    queryFn: () => getSeriesMetadata(studyUid, seriesUid),
    enabled,
    staleTime: Infinity,
  });
