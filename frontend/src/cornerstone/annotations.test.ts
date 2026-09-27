import { describe, expect, test } from 'vitest';
import { fromWire, toDicomUid, toWire } from './annotations';
import type { MeasurementItem } from '../api/types';

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

  test('round trip through the Cornerstone shape is lossless', () => {
    expect(toWire(fromWire(item))).toEqual(item);
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

  test('all three elliptical ROI statistics survive the round trip', () => {
    const roi: MeasurementItem = {
      ...item,
      tool: 'EllipticalROI',
      points: [
        [0, 5, 2],
        [10, 5, 2],
        [5, 0, 2],
        [5, 10, 2],
      ],
      values: [
        { name: 'Area', value: 78.54, unit: 'mm2' },
        { name: 'Mean', value: 112.5, unit: '1' },
        { name: 'StandardDeviation', value: 18.2, unit: '1' },
      ],
    };
    const back = toWire(fromWire(roi));
    expect(back?.values.map((v) => v.name).sort()).toEqual(['Area', 'Mean', 'StandardDeviation']);
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
