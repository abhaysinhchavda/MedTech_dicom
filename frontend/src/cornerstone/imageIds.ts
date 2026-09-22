import { wadors } from '@cornerstonejs/dicom-image-loader';
import { frameUrl } from '../api/dicomweb';
import type { InstanceMeta } from '../api/types';

export function buildImageIds(
  studyUid: string,
  seriesUid: string,
  instances: InstanceMeta[],
): string[] {
  const ids: string[] = [];
  for (const inst of instances)
    for (let f = 1; f <= inst.numFrames; f++)
      ids.push(`wadors:${frameUrl(studyUid, seriesUid, inst.sopUid, f)}`);
  return ids;
}

export function seedMetadata(imageIds: string[], instances: InstanceMeta[]): void {
  let k = 0;
  for (const inst of instances)
    for (let f = 0; f < inst.numFrames; f++)
      wadors.metaDataManager.add(imageIds[k++], inst.raw as never);
}
