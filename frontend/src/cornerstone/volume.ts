import { cache, Enums, eventTarget, volumeLoader, type Types } from '@cornerstonejs/core';

export const volumeIdFor = (seriesUid: string): string =>
  `cornerstoneStreamingImageVolume:${seriesUid}`;

type ModDetail = { volumeId: string; framesProcessed: number; numberOfFrames: number };
type DoneDetail = { volumeId: string };
type ErrDetail = { imageId: string; error?: Error };

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

    const ids = new Set(imageIds);
    const failedOnce = new Set<string>();
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
    const onErr = (e: Event) => {
      const d = (e as CustomEvent<ErrDetail>).detail;
      if (!ids.has(d.imageId)) return;
      if (!failedOnce.has(d.imageId)) {
        failedOnce.add(d.imageId);
        return; // the loader retries once
      }
      settled = true;
      off();
      reject(new Error(`slice failed to load: ${d.imageId} (${d.error?.message ?? 'error'})`));
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
