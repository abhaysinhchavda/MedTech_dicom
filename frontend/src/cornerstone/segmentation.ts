import { cache, volumeLoader } from '@cornerstonejs/core';
import { Enums as csToolsEnums, segmentation } from '@cornerstonejs/tools';

/**
 * The only module that touches Cornerstone's segmentation state.
 *
 * The mask lives in a derived labelmap volume: same geometry as the image
 * volume, one uint8 per voxel holding the segment number, 0 for unlabelled.
 * That is also exactly what crosses the wire, so nothing here reformats it.
 */

export const segmentationIdFor = (seriesUid: string): string => `seg:${seriesUid}`;

function labelmapVoxels(segmentationId: string) {
  return cache.getVolume(segmentationId)?.voxelManager;
}

export async function createLabelmap(
  referenceVolumeId: string,
  segmentationId: string,
): Promise<void> {
  await volumeLoader.createAndCacheDerivedLabelmapVolume(referenceVolumeId, {
    volumeId: segmentationId,
  });
  segmentation.addSegmentations([
    {
      segmentationId,
      representation: {
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
        data: { volumeId: segmentationId },
      },
    },
  ]);
}

export function fillLabelmap(segmentationId: string, bytes: Uint8Array): void {
  const voxels = labelmapVoxels(segmentationId);
  // setCompleteScalarDataArray is optional on the interface, so a volume
  // backed by a manager that lacks it is left empty rather than crashing.
  voxels?.setCompleteScalarDataArray?.(bytes);
}

export function readLabelmap(segmentationId: string): Uint8Array | null {
  const data = labelmapVoxels(segmentationId)?.getCompleteScalarDataArray?.();
  return data ? Uint8Array.from(data as ArrayLike<number>) : null;
}

export function showSegmentation(viewportIds: readonly string[], segmentationId: string): void {
  // MPR viewports only. The 3D viewport has no surface representation in this
  // increment, and a labelmap there would render nothing useful.
  for (const viewportId of viewportIds)
    segmentation.addLabelmapRepresentationToViewport(viewportId, [{ segmentationId }]);
}

export function setActiveSegment(segmentationId: string, segmentNumber: number): void {
  // 0 is the eraser: painting with the unlabelled value clears voxels, which
  // is why no separate eraser tool is needed.
  segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, segmentNumber);
}

export function releaseSegmentation(segmentationId: string): void {
  // Cornerstone's segmentation state is global, like its annotation state, so
  // leaving the viewer has to clear it or the next series inherits this mask.
  segmentation.removeSegmentation(segmentationId);
  cache.removeVolumeLoadObject(segmentationId);
}
