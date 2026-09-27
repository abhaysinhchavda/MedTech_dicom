import { API_URL, ApiError, apiFetch, apiUrl } from './client';
import type { Segment, SegmentationSet } from './types';

export const getSegmentation = (seriesUid: string): Promise<SegmentationSet> =>
  apiFetch<SegmentationSet>(`/api/series/${seriesUid}/segmentation`);

export const labelmapUrl = (seriesUid: string): string =>
  apiUrl(`/api/series/${seriesUid}/segmentation/labelmap`);

/**
 * The labelmap is bulk binary, not JSON, so it does not go through apiFetch.
 * A 404 means "no segmentation yet", which is an ordinary state rather than
 * an error, and the caller distinguishes it by the null.
 */
export async function getLabelmap(seriesUid: string): Promise<Uint8Array | null> {
  const res = await fetch(labelmapUrl(seriesUid));
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, res.statusText || `HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function putSegmentation(
  seriesUid: string,
  segSopUid: string | null,
  dims: [number, number, number],
  segments: Segment[],
  labelmap: Uint8Array,
): Promise<SegmentationSet> {
  const body = new FormData();
  // segSopUid is the one the client loaded; the backend answers 409 if it is
  // no longer current, so a second tab cannot be overwritten silently.
  body.append('meta', JSON.stringify({ segSopUid, dims, segments }));
  body.append(
    'labelmap',
    new Blob([labelmap as unknown as BlobPart], { type: 'application/octet-stream' }),
    'labelmap.bin',
  );
  const res = await fetch(`${API_URL}/api/series/${seriesUid}/segmentation`, {
    method: 'PUT',
    body,
  });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { detail?: string }).detail ?? message;
    } catch {
      /* keep the default */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as SegmentationSet;
}
