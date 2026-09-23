import { cache, Enums, eventTarget, volumeLoader, type Types } from '@cornerstonejs/core';

export const volumeIdFor = (seriesUid: string): string =>
  `cornerstoneStreamingImageVolume:${seriesUid}`;

type ModDetail = { volumeId: string; framesProcessed: number; numberOfFrames: number };
type DoneDetail = { volumeId: string };
// Cornerstone's BaseStreamingImageVolume has an upstream arg-order bug: its
// errorCallback is declared (imageId, permanent, error) but bound and invoked
// as errorCallback(imageIdIndex, imageId, error, ...) via
// ProgressiveIterator.forEach's errorCallback(e, true). So the event detail's
// `imageId` field actually holds the numeric imageIdIndex, not a wadors: id.
type ErrDetail = { imageId: number; error?: Error };

function abortError(): Error {
  return typeof DOMException !== 'undefined'
    ? new DOMException('Volume load aborted', 'AbortError')
    : Object.assign(new Error('Volume load aborted'), { name: 'AbortError' });
}

export function loadVolume(
  volumeId: string,
  imageIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Types.IImageVolume> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let volume: Types.IImageVolume | undefined;
    let settled = false;

    const off = () => {
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onMod);
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onDone);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, onErr);
      signal?.removeEventListener('abort', onAbort);
    };
    const onMod = (e: Event) => {
      const d = (e as CustomEvent<ModDetail>).detail;
      if (d.volumeId === volumeId) onProgress?.(d.framesProcessed, d.numberOfFrames);
    };
    const onDone = (e: Event) => {
      if ((e as CustomEvent<DoneDetail>).detail.volumeId !== volumeId) return;
      settled = true;
      off();
      resolve(volume!);
    };
    // Only one volume loads at a time (this promise is created per loadVolume
    // call and nothing else shares its imageIds), so this needs no volumeId
    // filtering the way onMod/onDone do -- any IMAGE_LOAD_ERROR fired while
    // we're listening is ours.
    const onErr = (e: Event) => {
      if (settled) return;
      settled = true;
      off();
      releaseVolume(volumeId);
      const d = (e as CustomEvent<ErrDetail>).detail;
      const slice = imageIds[d.imageId] ?? d.imageId;
      reject(new Error(`slice failed to load: ${slice} (${d.error?.message ?? 'error'})`));
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      off();
      releaseVolume(volumeId);
      reject(abortError());
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onMod);
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onDone);
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, onErr);
    signal?.addEventListener('abort', onAbort);

    volumeLoader.createAndCacheVolume(volumeId, { imageIds }).then(
      (v) => {
        if (settled) return; // aborted (or otherwise settled) before the volume finished creating
        volume = v as Types.IImageVolume;
        (v as Types.IStreamingImageVolume).load();
      },
      (err: Error) => {
        if (settled) return;
        settled = true;
        off();
        reject(err);
      },
    );
  });
}

export function releaseVolume(volumeId: string): void {
  try {
    cache.removeVolumeLoadObject(volumeId);
  } catch {
    /* not cached */
  }
}
