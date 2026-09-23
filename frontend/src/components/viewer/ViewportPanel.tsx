import { forwardRef } from 'react';
import { CornersIn, CornersOut } from '@phosphor-icons/react';
import { useViewportState } from '../../hooks/useViewportState';
import { ViewportOverlay } from './ViewportOverlay';

export interface ViewportPanelProps {
  engineId: string;
  viewportId: string;
  label: string;
  ready: boolean;
  is3d?: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export const ViewportPanel = forwardRef<HTMLDivElement, ViewportPanelProps>(function ViewportPanel(
  { engineId, viewportId, label, ready, is3d, maximized, onMaximize },
  ref,
) {
  // The 3D volume viewport has no slice/VOI/zoom overlay (see ViewportOverlay
  // below), so it doesn't need to subscribe to viewport state -- and
  // readSlice() (utilities.getImageSliceDataForVolumeViewport) throws on a
  // VOLUME_3D viewport on every rotation frame's CAMERA_MODIFIED, since that
  // util only supports MPR-style volume viewports.
  const state = useViewportState(engineId, viewportId, ready && !is3d);
  const Icon = maximized ? CornersIn : CornersOut;
  return (
    <div
      className="group relative min-h-0 overflow-hidden rounded-control border border-line bg-void transition-colors duration-150 focus-within:border-accent/60 hover:border-line-strong"
      onDoubleClick={onMaximize}
      data-testid={`panel-${label}`}
    >
      <div ref={ref} className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />
      <ViewportOverlay label={label} state={state} is3d={is3d} />
      {onMaximize && (
        <button
          type="button"
          onClick={onMaximize}
          aria-label={`${maximized ? 'Restore' : 'Maximize'} ${label}`}
          className="press absolute top-1.5 right-1.5 rounded-control border border-line bg-surface/80 p-1 text-muted opacity-0 transition duration-150 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
        >
          <Icon aria-hidden size={14} />
        </button>
      )}
    </div>
  );
});
