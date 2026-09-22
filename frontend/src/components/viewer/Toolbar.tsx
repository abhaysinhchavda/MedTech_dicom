import { voiPresetsFor, volumePresetsFor, type VoiPreset } from '../../cornerstone/presets';
import { Button } from '../ui/Button';

export interface ToolbarProps {
  modality: string | null;
  crosshairs: boolean;
  onCrosshairs: (on: boolean) => void;
  onVoiPreset: (p: VoiPreset) => void;
  onVolumePreset: (name: string) => void;
  onInvert: () => void;
  onReset: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const voi = voiPresetsFor(p.modality);
  const vol = volumePresetsFor(p.modality);
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-neutral-900 border-b border-neutral-800 text-sm">
      <Button active={p.crosshairs} onClick={() => p.onCrosshairs(!p.crosshairs)}>
        Crosshairs
      </Button>
      <label className="flex items-center gap-1">
        MPR window
        <select
          aria-label="MPR window"
          className="bg-neutral-800 rounded px-1"
          defaultValue=""
          disabled={voi.length === 0}
          onChange={(e) => {
            const s = voi.find((x) => x.name === e.target.value);
            if (s) p.onVoiPreset(s);
          }}
        >
          <option value="" disabled>
            {voi.length ? 'preset…' : 'from header'}
          </option>
          {voi.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        3D preset
        <select
          aria-label="3D preset"
          className="bg-neutral-800 rounded px-1"
          defaultValue={vol[0]}
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
      <Button onClick={p.onInvert}>Invert</Button>
      <Button onClick={p.onReset}>Reset</Button>
    </div>
  );
}
