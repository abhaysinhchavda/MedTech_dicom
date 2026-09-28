import { describe, expect, test, vi } from 'vitest';

// Both Cornerstone packages are mocked deliberately. Importing them for real
// pulls vtk.js into jsdom and starves vitest's worker pool: it previously
// made three unrelated test files fail to start.
const voxels = {
  setCompleteScalarDataArray: vi.fn(),
  getCompleteScalarDataArray: vi.fn(() => new Uint8Array([0, 1, 0, 2])),
};
const cache = {
  getVolume: vi.fn(() => ({ voxelManager: voxels })),
  removeVolumeLoadObject: vi.fn(),
};
const volumeLoader = { createAndCacheDerivedLabelmapVolume: vi.fn(async () => ({})) };
const segmentation = {
  addSegmentations: vi.fn(),
  addLabelmapRepresentationToViewport: vi.fn(),
  removeSegmentation: vi.fn(),
  state: { getSegmentation: vi.fn(() => ({ segmentationId: 'seg:1' })) },
  segmentIndex: { setActiveSegmentIndex: vi.fn() },
};

vi.mock('@cornerstonejs/core', () => ({ cache, volumeLoader }));
vi.mock('@cornerstonejs/tools', () => ({
  segmentation,
  Enums: { SegmentationRepresentations: { Labelmap: 'Labelmap' } },
}));

const {
  createLabelmap,
  fillLabelmap,
  isPaintEvent,
  readLabelmap,
  releaseSegmentation,
  segmentationIdFor,
  setActiveSegment,
  showSegmentation,
} = await import('./segmentation');

describe('the segmentation adapter', () => {
  test('a segmentation id is derived from the series, so it is stable', () => {
    expect(segmentationIdFor('1.2.3')).toBe(segmentationIdFor('1.2.3'));
    expect(segmentationIdFor('1.2.3')).not.toBe(segmentationIdFor('1.2.4'));
  });

  test('creating a labelmap derives it from the image volume and registers it', async () => {
    await createLabelmap('vol:1', 'seg:1');
    expect(volumeLoader.createAndCacheDerivedLabelmapVolume).toHaveBeenCalledWith('vol:1', {
      volumeId: 'seg:1',
    });
    const [[input]] = segmentation.addSegmentations.mock.calls as unknown as [
      [{ segmentationId: string; representation: { type: string } }[]],
    ];
    expect(input[0]!.segmentationId).toBe('seg:1');
    expect(input[0]!.representation.type).toBe('Labelmap');
  });

  test('bytes go into the volume unchanged', () => {
    const bytes = new Uint8Array([0, 1, 1, 0]);
    fillLabelmap('seg:1', bytes);
    expect(voxels.setCompleteScalarDataArray).toHaveBeenCalledWith(bytes);
  });

  test('bytes come back out unchanged', () => {
    expect(Array.from(readLabelmap('seg:1')!)).toEqual([0, 1, 0, 2]);
  });

  test('the overlay is added to every MPR viewport and no others', () => {
    segmentation.addLabelmapRepresentationToViewport.mockClear();
    showSegmentation(['axial', 'sagittal', 'coronal'], 'seg:1');
    expect(segmentation.addLabelmapRepresentationToViewport).toHaveBeenCalledTimes(3);
  });

  test('segment 0 is selectable, because that is the eraser', () => {
    setActiveSegment('seg:1', 0);
    expect(segmentation.segmentIndex.setActiveSegmentIndex).toHaveBeenCalledWith('seg:1', 0);
  });

  test('releasing clears both the segmentation state and the cached volume', () => {
    releaseSegmentation('seg:1');
    expect(segmentation.removeSegmentation).toHaveBeenCalledWith('seg:1');
    expect(cache.removeVolumeLoadObject).toHaveBeenCalledWith('seg:1');
  });

  test('only an event that names modified slices counts as painting', () => {
    // Cornerstone fires SEGMENTATION_DATA_MODIFIED for rendering the labelmap
    // as well as for changing it, and the render path passes nothing but a
    // segmentationId. Treating those as edits meant drawing a measurement --
    // which repaints the viewport -- armed the segmentation's Save button.
    // Found by drawing a length on the real T2-FLAIR series.
    const fire = (detail: unknown) =>
      isPaintEvent(new CustomEvent('csTOOLSSEGMENTATIONDATAMODIFIED', { detail }));

    // What the brush sends: the slices it touched, and the segment it used.
    expect(fire({ segmentationId: 'seg:1', modifiedSlicesToUse: [12, 13], segmentIndex: 1 })).toBe(
      true,
    );
    // What labelmapDisplay and the volume render plans send.
    expect(fire({ segmentationId: 'seg:1' })).toBe(false);
    // A stroke that landed outside the volume changed nothing either.
    expect(fire({ segmentationId: 'seg:1', modifiedSlicesToUse: [] })).toBe(false);
    expect(fire(null)).toBe(false);
  });

  test('releasing something that was never created is a no-op, not a throw', () => {
    // Cornerstone throws on an id it is not holding, and this runs on every
    // unmount -- including one that happens before createLabelmap resolves,
    // which is exactly what StrictMode's mount/unmount/remount produces. An
    // unguarded release took the whole viewer down there.
    segmentation.removeSegmentation.mockClear();
    cache.removeVolumeLoadObject.mockClear();
    segmentation.state.getSegmentation.mockReturnValueOnce(undefined as never);
    cache.getVolume.mockReturnValueOnce(undefined as never);

    expect(() => releaseSegmentation('seg:never')).not.toThrow();
    expect(segmentation.removeSegmentation).not.toHaveBeenCalled();
    expect(cache.removeVolumeLoadObject).not.toHaveBeenCalled();
  });
});
