import { vi } from 'vitest';
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadors: { metaDataManager: { add: vi.fn() } },
}));
import { wadors } from '@cornerstonejs/dicom-image-loader';
import { buildImageIds, seedMetadata } from './imageIds';
import { API } from '../test/msw';

const inst = (sop: string, frames = 1) => ({
  sopUid: sop,
  numFrames: frames,
  raw: { '00080018': { vr: 'UI', Value: [sop] } },
});

test('one imageId per frame, wadors scheme', () => {
  expect(buildImageIds('S', 'SE', [inst('a'), inst('b', 3)])).toEqual([
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/a/frames/1`,
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/b/frames/1`,
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/b/frames/2`,
    `wadors:${API}/dicomweb/studies/S/series/SE/instances/b/frames/3`,
  ]);
});

test('seeds metadata for every imageId, converted to the wadors Value-only shape', () => {
  const instances = [inst('a'), inst('b', 2)];
  const ids = buildImageIds('S', 'SE', instances);
  seedMetadata(ids, instances);
  const add = vi.mocked(wadors.metaDataManager.add);
  expect(add).toHaveBeenCalledTimes(3);
  expect(add).toHaveBeenNthCalledWith(2, ids[1], { '00080018': { Value: ['b'] } });
  expect(add).toHaveBeenNthCalledWith(3, ids[2], { '00080018': { Value: ['b'] } });
});

test('drops elements with no Value and strips vr, keeping only elements that have a Value', () => {
  const withEmpty = {
    sopUid: 'c',
    numFrames: 1,
    raw: {
      '00080018': { vr: 'UI', Value: ['c'] },
      '00081030': { vr: 'LO' }, // empty element: no Value
    },
  };
  const ids = buildImageIds('S', 'SE', [withEmpty]);
  seedMetadata(ids, [withEmpty]);
  const add = vi.mocked(wadors.metaDataManager.add);
  const passed = add.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(passed).toEqual({ '00080018': { Value: ['c'] } });
  expect(Object.keys(passed)).not.toContain('00081030');
  expect(Object.values(passed).every((el) => !('vr' in (el as object)))).toBe(true);
});
