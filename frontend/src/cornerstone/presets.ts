export interface VoiPreset {
  name: string;
  center: number;
  width: number;
}

export const VOI_PRESETS: Record<'CT' | 'MR', VoiPreset[]> = {
  CT: [
    { name: 'Brain', center: 40, width: 80 },
    { name: 'Bone', center: 400, width: 1800 },
    { name: 'Soft tissue', center: 50, width: 400 },
  ],
  // MR has no standard center/width VOI windows like CT HU windows; MR windowing
  // is driven by the volume presets in VOLUME_PRESETS.MR instead.
  MR: [],
};

export const VOLUME_PRESETS: Record<'CT' | 'MR', string[]> = {
  CT: ['CT-Bone', 'CT-Soft-Tissue'],
  MR: ['MR-Default', 'MR-T2-Brain'],
};

const key = (m: string | null): 'CT' | 'MR' => (m === 'MR' ? 'MR' : 'CT');

export const voiPresetsFor = (modality: string | null): VoiPreset[] => VOI_PRESETS[key(modality)];

export const volumePresetsFor = (modality: string | null): string[] =>
  VOLUME_PRESETS[key(modality)];

export const defaultVolumePreset = (modality: string | null): string =>
  VOLUME_PRESETS[key(modality)][0];

export const voiRange = (p: VoiPreset): { lower: number; upper: number } => ({
  lower: p.center - p.width / 2,
  upper: p.center + p.width / 2,
});
