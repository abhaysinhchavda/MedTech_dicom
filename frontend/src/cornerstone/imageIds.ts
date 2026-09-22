import { wadors } from '@cornerstonejs/dicom-image-loader';
import type { Types } from '@cornerstonejs/dicom-image-loader';
import { frameUrl } from '../api/dicomweb';
import type { DicomJson, InstanceMeta } from '../api/types';

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

// Our DicomJson carries `vr` and may omit `Value` for empty elements; the wadors
// metadata manager only reads `Value`. The shapes overlap but are not assignable,
// so convert explicitly rather than casting through `never`/`any` at the call site.
function toWadorsMetadata(raw: DicomJson): Types.WADORSMetaData {
  const out: Record<string, { Value: unknown }> = {};
  for (const [tag, element] of Object.entries(raw)) {
    if (element.Value !== undefined) out[tag] = { Value: element.Value };
  }
  return out as unknown as Types.WADORSMetaData;
}

export function seedMetadata(imageIds: string[], instances: InstanceMeta[]): void {
  let k = 0;
  for (const inst of instances)
    for (let f = 0; f < inst.numFrames; f++)
      wadors.metaDataManager.add(imageIds[k++], toWadorsMetadata(inst.raw));
}
