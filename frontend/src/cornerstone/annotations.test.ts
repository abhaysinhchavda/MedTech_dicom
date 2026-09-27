import { describe, expect, test, vi } from 'vitest';
import type { MeasurementItem } from '../api/types';

// The functions under test are pure. Importing the real @cornerstonejs/tools
// pulls its whole bundle (and vtk.js behind it) into jsdom, which starves
// vitest's worker pool badly enough that unrelated test files time out before
// they even start. The state manager is exercised for real by the Playwright
// test instead.
vi.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: {
      addAnnotation: vi.fn(),
      getAnnotations: vi.fn(() => []),
      removeAllAnnotations: vi.fn(),
    },
  },
}));

const { fromWire, toDicomUid, toWire } = await import('./annotations');

const item: MeasurementItem = {
  id: '2.25.100000000000000000000000000000001',
  tool: 'Length',
  points: [
    [-31.2, 14.8, 62],
    [-9.7, 22.4, 62],
  ],
  plane: { normal: [0, 0, 1], up: [0, -1, 0] },
  values: [{ name: 'Length', value: 22.8, unit: 'mm' }],
  label: null,
};

describe('annotation conversion', () => {
  test('a wire item becomes a Cornerstone annotation', () => {
    const a = fromWire(item, '1.2.9');
    expect(a.annotationUID).toBe(item.id);
    expect(a.metadata.toolName).toBe('Length');
    expect(a.metadata.FrameOfReferenceUID).toBe('1.2.9');
    expect(a.metadata.viewPlaneNormal).toEqual([0, 0, 1]);
    expect(a.metadata.viewUp).toEqual([0, -1, 0]);
    expect(a.data.handles.points).toEqual(item.points);
  });

  test('geometry, identity and label survive the round trip', () => {
    const back = toWire(fromWire(item))!;
    expect(back.id).toBe(item.id);
    expect(back.tool).toBe(item.tool);
    expect(back.points).toEqual(item.points);
    expect(back.plane).toEqual(item.plane);
    expect(back.label).toBeNull();
  });

  test('a restored annotation carries no stale statistics', () => {
    // The report persists geometry; Cornerstone recomputes the numbers
    // against the volume that is actually loaded.
    const a = fromWire(item);
    expect(a.invalidated).toBe(true);
    expect(a.data.cachedStats).toEqual({});
    expect(toWire(a)?.values).toEqual([]);
  });

  test('an annotation from an unsupported tool is dropped rather than sent', () => {
    const a = fromWire(item);
    a.metadata.toolName = 'CobbAngle';
    expect(toWire(a)).toBeNull();
  });

  test('a label survives the round trip', () => {
    const labelled = { ...item, label: 'tumour long axis' };
    expect(toWire(fromWire(labelled))?.label).toBe('tumour long axis');
  });

  test("all three elliptical ROI statistics are read from Cornerstone's cachedStats", () => {
    const roi = fromWire({
      ...item,
      tool: 'EllipticalROI',
      points: [
        [0, 5, 2],
        [10, 5, 2],
        [5, 0, 2],
        [5, 10, 2],
      ],
    });
    // The key is a real targetId, which is what Cornerstone writes once it has
    // computed the statistics against the loaded volume.
    roi.data.cachedStats = {
      'volumeId:cornerstoneStreamingImageVolume:series-1': {
        area: 78.54,
        mean: 112.5,
        stdDev: 18.2,
      },
    };
    const back = toWire(roi)!;
    expect(back.values.map((v) => v.name).sort()).toEqual(['Area', 'Mean', 'StandardDeviation']);
    expect(back.values.find((v) => v.name === 'Area')).toEqual({
      name: 'Area',
      value: 78.54,
      unit: 'mm2',
    });
  });

  test('a length value is read back with millimetre units', () => {
    const a = fromWire(item);
    a.data.cachedStats = { 'volumeId:series-1': { length: 22.8 } };
    expect(toWire(a)?.values).toEqual([{ name: 'Length', value: 22.8, unit: 'mm' }]);
  });
});

describe('identity', () => {
  test("Cornerstone's UUID becomes a DICOM UUID-derived UID", () => {
    const uid = toDicomUid('3f2a9c1e-0000-4000-8000-000000000001');
    expect(uid.startsWith('2.25.')).toBe(true);
    expect(uid).toMatch(/^[0-9]+(\.[0-9]+)*$/);
    expect(uid.length).toBeLessThanOrEqual(64);
  });

  test('an id that is already a UID is left alone, so identity survives a reload', () => {
    expect(toDicomUid(item.id)).toBe(item.id);
  });

  test('the same UUID always yields the same UID', () => {
    const uuid = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
    expect(toDicomUid(uuid)).toBe(toDicomUid(uuid));
  });
});
