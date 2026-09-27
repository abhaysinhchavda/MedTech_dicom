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
  // File rather than Blob, matching uploadFiles. vitest.setup.ts swaps in
  // undici's FormData and node:buffer's File but leaves jsdom's Blob in
  // place, and undici rejects a foreign Blob with "Expected value to be an
  // instance of Blob". File is a Blob in the browser, so this costs nothing.
  body.append(
    'labelmap',
    new File([labelmap as unknown as BlobPart], 'labelmap.bin', {
      type: 'application/octet-stream',
    }),
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
