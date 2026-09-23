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
import { defaultVolumePreset, voiRange, type VoiPreset } from '../../cornerstone/presets';
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
  const grid = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [crosshairs, setCrosshairs] = useState(true);
  const [max, setMax] = useState<ViewportKey | null>(null);
  const [voiPresetName, setVoiPresetName] = useState('');
  const [volPresetName, setVolPresetName] = useState(() => defaultVolumePreset(modality));
  // "Adjust state during rendering" (React's own pattern for resetting state
  // when a prop changes) instead of an effect -- setState belongs in an
  // effect only when synchronizing with an external system, and a new
  // series' presets are derived purely from its own props.
  const [seriesKey, setSeriesKey] = useState(`${volumeId}|${modality}`);
  const nextSeriesKey = `${volumeId}|${modality}`;
  if (seriesKey !== nextSeriesKey) {
    setSeriesKey(nextSeriesKey);
    setVoiPresetName('');
    setVolPresetName(defaultVolumePreset(modality));
  }

  useEffect(() => {
    const engine = createViewerLayout(ENGINE_ID, {
      axial: axial.current!,
      sagittal: sagittal.current!,
      coronal: coronal.current!,
      volume3d: volume3d.current!,
    });
    createToolGroups(ENGINE_ID);
    let alive = true;
    // React StrictMode's dev-only mount->cleanup->remount can tear this
    // engine down (destroyViewerLayout) while showVolume's promise is still
    // in flight; when it then resumes and touches the now-destroyed engine,
    // it rejects. That's an expected artifact of the discarded first attempt,
    // not a real failure -- only surface it if this effect instance is still
    // the live one.
    void showVolume(engine, volumeId, modality).then(
      () => {
        if (alive) setReady(true);
      },
      (e: unknown) => {
        if (alive) console.error('showVolume failed', e);
      },
    );
    return () => {
      alive = false;
      setReady(false);
      destroyToolGroups();
      destroyViewerLayout(engine);
    };
  }, [volumeId, modality]);

  // Toggling `max` changes the grid's own column/row template, not the grid
  // container's own box size, so it needs its own explicit resize() call --
  // the ResizeObserver below won't fire for it.
  useEffect(() => {
    getRenderingEngine(ENGINE_ID)?.resize(true);
  }, [max]);

  // Cornerstone doesn't observe its own canvas elements, so a window/layout
  // resize leaves the four viewports rendering at their old size until
  // something tells the engine to re-measure.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => getRenderingEngine(ENGINE_ID)?.resize(true));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const engine = () => getRenderingEngine(ENGINE_ID);
  const mpr = () => MPR_IDS.map((id) => engine()!.getViewport(id) as Types.IVolumeViewport);
  const vol3d = () => engine()!.getViewport(VIEWPORT_IDS.volume3d) as Types.IVolumeViewport;

  const onVoiPreset = (p: VoiPreset) => {
    setVoiPresetName(p.name);
    for (const vp of mpr()) {
      vp.setProperties({ voiRange: voiRange(p) });
      vp.render();
    }
  };
  const onVolumePreset = (name: string) => {
    setVolPresetName(name);
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
    setVoiPresetName('');
    setVolPresetName(defaultVolumePreset(modality));
    void showVolume(e, volumeId, modality)
      .then(() => {
        // Re-invoking setToolActive/setToolPassive unconditionally re-runs
        // CrosshairsTool's onSetToolActive/onSetToolPassive, which recomputes
        // its center from the viewports' cameras -- which resetProperties()
        // above just put back to the default framing. That re-centres the
        // crosshairs without reaching into CrosshairsTool's private
        // (underscore-prefixed, untyped) recompute method directly.
        setCrosshairsActive(crosshairs);
      })
      .catch((err: unknown) => console.error('showVolume failed', err));
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
        voiPresetName={voiPresetName}
        onVoiPreset={onVoiPreset}
        volPresetName={volPresetName}
        onVolumePreset={onVolumePreset}
        onInvert={onInvert}
        onReset={onReset}
      />
      <div
        ref={grid}
        className={`flex-1 grid gap-1 p-1 min-h-0 ${max ? 'grid-cols-1 grid-rows-1' : 'grid-cols-2 grid-rows-2'}`}
      >
        {(['axial', 'sagittal', 'coronal', 'volume3d'] as ViewportKey[]).map(panel)}
      </div>
    </div>
  );
}
