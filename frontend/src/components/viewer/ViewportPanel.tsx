import { forwardRef } from 'react';
import { useViewportState } from '../../hooks/useViewportState';
import { ViewportOverlay } from './ViewportOverlay';

export interface ViewportPanelProps {
  engineId: string;
  viewportId: string;
  label: string;
  ready: boolean;
  is3d?: boolean;
  onMaximize?: () => void;
}

export const ViewportPanel = forwardRef<HTMLDivElement, ViewportPanelProps>(function ViewportPanel(
  { engineId, viewportId, label, ready, is3d, onMaximize },
  ref,
) {
  const state = useViewportState(engineId, viewportId, ready);
  return (
    <div
      className="relative bg-black border border-neutral-800 min-h-0"
      onDoubleClick={onMaximize}
      data-testid={`panel-${label}`}
    >
      <div ref={ref} className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />
      <ViewportOverlay label={label} state={state} is3d={is3d} />
    </div>
  );
});
