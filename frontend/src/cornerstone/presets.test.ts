import {
  defaultVolumePreset,
  voiPresetsFor,
  voiRange,
  volumePresetsFor,
  VOI_PRESETS,
} from './presets';

test('CT presets include the four spec windows', () => {
  expect(VOI_PRESETS.CT.map((p) => [p.name, p.center, p.width])).toEqual([
    ['Lung', -600, 1500],
    ['Bone', 400, 1800],
    ['Brain', 40, 80],
    ['Soft tissue', 50, 400],
  ]);
  expect(voiRange(VOI_PRESETS.CT[1])).toEqual({ lower: -500, upper: 1300 });
});

test('unknown modality falls back to CT; MR default volume preset is MR-Default', () => {
  expect(voiPresetsFor('PT')).toEqual(VOI_PRESETS.CT);
  expect(voiPresetsFor(null)).toEqual(VOI_PRESETS.CT);
  expect(volumePresetsFor('MR')).toContain('MR-Default');
  expect(defaultVolumePreset('MR')).toBe('MR-Default');
  expect(defaultVolumePreset('CT')).toBe('CT-Bone');
});
