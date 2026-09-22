import { cache, Enums, eventTarget, volumeLoader, type Types } from '@cornerstonejs/core';

export const volumeIdFor = (seriesUid: string): string =>
  `cornerstoneStreamingImageVolume:${seriesUid}`;

type ModDetail = { volumeId: string; framesProcessed: number; numberOfFrames: number };
type DoneDetail = { volumeId: string };
type ErrDetail = { imageId: string; error?: Error };

export function loadVolume(
  volumeId: string,
  imageIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Types.IImageVolume> {
  return new Promise((resolve, reject) => {
    const ids = new Set(imageIds);
    const failedOnce = new Set<string>();
    let volume: Types.IImageVolume | undefined;

    const off = () => {
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onMod);
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onDone);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, onErr);
    };
    const onMod = (e: Event) => {
      const d = (e as CustomEvent<ModDetail>).detail;
      if (d.volumeId === volumeId) onProgress?.(d.framesProcessed, d.numberOfFrames);
    };
    const onDone = (e: Event) => {
      if ((e as CustomEvent<DoneDetail>).detail.volumeId !== volumeId) return;
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
      off();
      reject(new Error(`slice failed to load: ${d.imageId} (${d.error?.message ?? 'error'})`));
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onMod);
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onDone);
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, onErr);

    volumeLoader.createAndCacheVolume(volumeId, { imageIds }).then(
      (v) => {
        volume = v as Types.IImageVolume;
        (v as unknown as { load: () => void }).load();
      },
      (err: Error) => {
        off();
        reject(err);
      },
    );
  });
}

export function releaseVolume(volumeId: string): void {
  if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId);
}
