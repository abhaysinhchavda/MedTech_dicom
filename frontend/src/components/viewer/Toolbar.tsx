import {
  ArrowCounterClockwise,
  ArrowsOutCardinal,
  Circle,
  CircleHalf,
  Crosshair,
  DownloadSimple,
  Ruler,
  Target,
  Triangle,
  type Icon,
} from '@phosphor-icons/react';
import { voiPresetsFor, volumePresetsFor, type VoiPreset } from '../../cornerstone/presets';
import type { MprTool } from '../../cornerstone/toolGroups';
import { Button } from '../ui/Button';

export interface ToolbarProps {
  modality: string | null;
  tool: MprTool;
  onTool: (t: MprTool) => void;
  voiPresetName: string;
  onVoiPreset: (p: VoiPreset) => void;
  volPresetName: string;
  onVolumePreset: (name: string) => void;
  onInvert: () => void;
  onReset: () => void;
  dirty: boolean;
  saving: boolean;
  canMeasure: boolean;
  onSave: () => void;
  reportUrl: string | null;
}

const SELECT =
  'rounded-control border border-line bg-raised px-2 py-1.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong disabled:opacity-40';
const FIELD = 'flex items-center gap-2 text-xs text-faint';

// Exactly one of these owns left-drag at a time, which is why they render as
// one mutually exclusive group rather than as independent toggles.
const MODES: { id: MprTool; label: string; Icon: Icon }[] = [
  { id: 'crosshairs', label: 'Crosshairs', Icon: Crosshair },
  { id: 'windowLevel', label: 'Window', Icon: CircleHalf },
  { id: 'Length', label: 'Length', Icon: Ruler },
  { id: 'Angle', label: 'Angle', Icon: Triangle },
  { id: 'Probe', label: 'Probe', Icon: Target },
  { id: 'EllipticalROI', label: 'Ellipse', Icon: Circle },
  { id: 'Bidirectional', label: 'Bidirectional', Icon: ArrowsOutCardinal },
];

const isMeasure = (id: MprTool) => id !== 'crosshairs' && id !== 'windowLevel';

export function Toolbar(p: ToolbarProps) {
  const voi = voiPresetsFor(p.modality);
  const vol = volumePresetsFor(p.modality);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tool mode">
        {MODES.map(({ id, label, Icon: ModeIcon }) => {
          const blocked = !p.canMeasure && isMeasure(id);
          return (
            <Button
              key={id}
              active={p.tool === id}
              disabled={blocked}
              title={
                blocked ? 'This series has no frame of reference, so it cannot be measured' : label
              }
              onClick={() => p.onTool(id)}
            >
              <ModeIcon aria-hidden size={15} />
              {label}
            </Button>
          );
        })}
      </div>

      <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />

      <Button title="Invert greyscale (I)" onClick={p.onInvert}>
        <CircleHalf aria-hidden size={15} />
        Invert
      </Button>
      <Button title="Reset cameras and window (R)" onClick={p.onReset}>
        <ArrowCounterClockwise aria-hidden size={15} />
        Reset
      </Button>

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

      <div className="ml-auto flex items-center gap-3">
        {p.reportUrl && (
          <a
            className="flex items-center gap-1.5 text-xs text-accent hover:underline"
            href={p.reportUrl}
            download
          >
            <DownloadSimple aria-hidden size={14} />
            Download report
          </a>
        )}
        <Button
          variant={p.dirty ? 'primary' : 'quiet'}
          disabled={!p.dirty || p.saving}
          onClick={p.onSave}
        >
          {p.saving ? 'Saving' : p.dirty ? 'Save measurements' : 'Saved'}
        </Button>
      </div>
    </div>
  );
}
