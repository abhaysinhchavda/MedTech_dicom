import { Enums, RenderingEngine, setVolumesForViewports, type Types } from '@cornerstonejs/core';
import { defaultVolumePreset } from './presets';

export const VIEWPORT_IDS = {
  axial: 'mpr-axial',
  sagittal: 'mpr-sagittal',
  coronal: 'mpr-coronal',
  volume3d: 'vol-3d',
} as const;
export type ViewportKey = keyof typeof VIEWPORT_IDS;
export const MPR_IDS: string[] = [VIEWPORT_IDS.axial, VIEWPORT_IDS.sagittal, VIEWPORT_IDS.coronal];
export const ALL_IDS: string[] = [...MPR_IDS, VIEWPORT_IDS.volume3d];
const BLACK: Types.RGB = [0, 0, 0];

export function createViewerLayout(
  engineId: string,
  els: Record<ViewportKey, HTMLDivElement>,
): RenderingEngine {
  const engine = new RenderingEngine(engineId);
  const ortho = (
    id: string,
    element: HTMLDivElement,
    orientation: Enums.OrientationAxis,
  ): Types.PublicViewportInput => ({
    viewportId: id,
    type: Enums.ViewportType.ORTHOGRAPHIC,
    element,
    defaultOptions: { orientation, background: BLACK },
  });
  engine.setViewports([
    ortho(VIEWPORT_IDS.axial, els.axial, Enums.OrientationAxis.AXIAL),
    ortho(VIEWPORT_IDS.sagittal, els.sagittal, Enums.OrientationAxis.SAGITTAL),
    ortho(VIEWPORT_IDS.coronal, els.coronal, Enums.OrientationAxis.CORONAL),
    {
      viewportId: VIEWPORT_IDS.volume3d,
      type: Enums.ViewportType.VOLUME_3D,
      element: els.volume3d,
      defaultOptions: { background: [0.05, 0.05, 0.08] },
    },
  ]);
  return engine;
}

export async function showVolume(
  engine: RenderingEngine,
  volumeId: string,
  modality: string | null,
): Promise<void> {
  await setVolumesForViewports(engine, [{ volumeId }], ALL_IDS);
  const v3 = engine.getViewport(VIEWPORT_IDS.volume3d) as Types.IVolumeViewport;
  v3.setProperties({ preset: defaultVolumePreset(modality) });
  for (const id of ALL_IDS) engine.getViewport(id).resetCamera();
  engine.render();
}

export function destroyViewerLayout(engine: RenderingEngine): void {
  // engine.destroy() already disables every element on the engine; looping
  // disableElement() first was redundant.
  engine.destroy();
}
