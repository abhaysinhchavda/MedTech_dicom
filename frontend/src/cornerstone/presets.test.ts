import {
  defaultVolumePreset,
  voiPresetsFor,
  voiRange,
  volumePresetsFor,
  VOI_PRESETS,
} from './presets';

test('CT presets include the brain-first spec windows', () => {
  expect(VOI_PRESETS.CT.map((p) => [p.name, p.center, p.width])).toEqual([
    ['Brain', 40, 80],
    ['Bone', 400, 1800],
    ['Soft tissue', 50, 400],
  ]);
  expect(voiRange(VOI_PRESETS.CT[1])).toEqual({ lower: -500, upper: 1300 });
});

test('volume presets are brain-focused (no lung/AAA/angio)', () => {
  expect(volumePresetsFor('CT')).toEqual(['CT-Bone', 'CT-Soft-Tissue']);
  expect(volumePresetsFor('MR')).toEqual(['MR-Default', 'MR-T2-Brain']);
});

test('unknown modality falls back to CT; MR default volume preset is MR-Default', () => {
  expect(voiPresetsFor('PT')).toEqual(VOI_PRESETS.CT);
  expect(voiPresetsFor(null)).toEqual(VOI_PRESETS.CT);
  expect(volumePresetsFor('MR')).toContain('MR-Default');
  expect(defaultVolumePreset('MR')).toBe('MR-Default');
  expect(defaultVolumePreset('CT')).toBe('CT-Bone');
});
