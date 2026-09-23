import { ArrowCounterClockwise, CircleHalf, Crosshair } from '@phosphor-icons/react';
import { voiPresetsFor, volumePresetsFor, type VoiPreset } from '../../cornerstone/presets';
import { Button } from '../ui/Button';

export interface ToolbarProps {
  modality: string | null;
  crosshairs: boolean;
  onCrosshairs: (on: boolean) => void;
  voiPresetName: string;
  onVoiPreset: (p: VoiPreset) => void;
  volPresetName: string;
  onVolumePreset: (name: string) => void;
  onInvert: () => void;
  onReset: () => void;
}

const SELECT =
  'rounded-control border border-line bg-raised px-2 py-1.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong disabled:opacity-40';
const FIELD = 'flex items-center gap-2 text-xs text-faint';

export function Toolbar(p: ToolbarProps) {
  const voi = voiPresetsFor(p.modality);
  const vol = volumePresetsFor(p.modality);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2">
      <Button
        active={p.crosshairs}
        title="Toggle crosshairs (C)"
        onClick={() => p.onCrosshairs(!p.crosshairs)}
      >
        <Crosshair aria-hidden size={15} />
        Crosshairs
      </Button>
      <Button title="Invert greyscale (I)" onClick={p.onInvert}>
        <CircleHalf aria-hidden size={15} />
        Invert
      </Button>
      <Button title="Reset cameras and window (R)" onClick={p.onReset}>
        <ArrowCounterClockwise aria-hidden size={15} />
        Reset
      </Button>

      <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />

      <label className={FIELD}>
        MPR window
        <select
          aria-label="MPR window"
          className={SELECT}
          value={p.voiPresetName}
          disabled={voi.length === 0}
          onChange={(e) => {
            const s = voi.find((x) => x.name === e.target.value);
            if (s) p.onVoiPreset(s);
          }}
        >
          <option value="" disabled>
            {voi.length ? 'preset' : 'from header'}
          </option>
          {voi.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        3D preset
        <select
          aria-label="3D preset"
          className={SELECT}
          value={p.volPresetName}
          disabled={vol.length === 0}
          onChange={(e) => p.onVolumePreset(e.target.value)}
        >
          {vol.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <p className="num ml-auto hidden text-xs text-faint lg:block">
        C crosshairs · I invert · R reset · 1-4 maximize · Esc restore
      </p>
    </div>
  );
}
