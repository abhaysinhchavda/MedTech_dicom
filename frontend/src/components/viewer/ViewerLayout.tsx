import { useEffect, useRef, useState } from 'react';
import { getRenderingEngine, type Types } from '@cornerstonejs/core';
import {
  ALL_IDS,
  MPR_IDS,
  VIEWPORT_IDS,
  createViewerLayout,
  destroyViewerLayout,
  showVolume,
  type ViewportKey,
} from '../../cornerstone/viewports';
import {
  createToolGroups,
  destroyToolGroups,
  setCrosshairsActive,
} from '../../cornerstone/toolGroups';
import { voiRange, type VoiPreset } from '../../cornerstone/presets';
import { Toolbar } from './Toolbar';
import { ViewportPanel } from './ViewportPanel';

export const ENGINE_ID = 'viewer-engine';
const LABELS: Record<ViewportKey, string> = {
  axial: 'Axial',
  sagittal: 'Sagittal',
  coronal: 'Coronal',
  volume3d: '3D',
};

export function ViewerLayout({
  volumeId,
  modality,
}: {
  volumeId: string;
  modality: string | null;
}) {
  const axial = useRef<HTMLDivElement>(null);
  const sagittal = useRef<HTMLDivElement>(null);
  const coronal = useRef<HTMLDivElement>(null);
  const volume3d = useRef<HTMLDivElement>(null);
  const refs = { axial, sagittal, coronal, volume3d };
  const [ready, setReady] = useState(false);
  const [crosshairs, setCrosshairs] = useState(true);
  const [max, setMax] = useState<ViewportKey | null>(null);

  useEffect(() => {
    const engine = createViewerLayout(ENGINE_ID, {
      axial: axial.current!,
      sagittal: sagittal.current!,
      coronal: coronal.current!,
      volume3d: volume3d.current!,
    });
    createToolGroups(ENGINE_ID);
    let alive = true;
    void showVolume(engine, volumeId, modality).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
      setReady(false);
      destroyToolGroups();
      destroyViewerLayout(engine);
    };
  }, [volumeId, modality]);

  useEffect(() => {
    getRenderingEngine(ENGINE_ID)?.resize(true);
  }, [max]);

  const engine = () => getRenderingEngine(ENGINE_ID);
  const mpr = () => MPR_IDS.map((id) => engine()!.getViewport(id) as Types.IVolumeViewport);
  const vol3d = () => engine()!.getViewport(VIEWPORT_IDS.volume3d) as Types.IVolumeViewport;

  const onVoiPreset = (p: VoiPreset) => {
    for (const vp of mpr()) {
      vp.setProperties({ voiRange: voiRange(p) });
      vp.render();
    }
  };
  const onVolumePreset = (name: string) => {
    vol3d().setProperties({ preset: name });
    vol3d().render();
  };
  const onInvert = () => {
    for (const vp of mpr()) {
      vp.setProperties({ invert: !(vp.getProperties()?.invert ?? false) });
      vp.render();
    }
  };
  const onReset = () => {
    const e = engine();
    if (!e) return;
    for (const id of ALL_IDS) {
      const vp = e.getViewport(id) as Types.IVolumeViewport;
      vp.resetProperties();
    }
    void showVolume(e, volumeId, modality);
  };
  const onCrosshairs = (on: boolean) => {
    setCrosshairs(on);
    setCrosshairsActive(on);
    engine()?.render();
  };

  const panel = (key: ViewportKey) => (
    <div key={key} className={max && max !== key ? 'hidden' : 'contents'}>
      <ViewportPanel
        ref={refs[key]}
        engineId={ENGINE_ID}
        viewportId={VIEWPORT_IDS[key]}
        label={LABELS[key]}
        ready={ready}
        is3d={key === 'volume3d'}
        onMaximize={() => setMax(max ? null : key)}
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        modality={modality}
        crosshairs={crosshairs}
        onCrosshairs={onCrosshairs}
        onVoiPreset={onVoiPreset}
        onVolumePreset={onVolumePreset}
        onInvert={onInvert}
        onReset={onReset}
      />
      <div
        className={`flex-1 grid gap-1 p-1 min-h-0 ${max ? 'grid-cols-1 grid-rows-1' : 'grid-cols-2 grid-rows-2'}`}
      >
        {(['axial', 'sagittal', 'coronal', 'volume3d'] as ViewportKey[]).map(panel)}
      </div>
    </div>
  );
}
