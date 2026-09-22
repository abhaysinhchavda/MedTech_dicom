import type { ViewportState } from '../../hooks/useViewportState';

export function ViewportOverlay({
  label,
  state,
  is3d,
}: {
  label: string;
  state: ViewportState;
  is3d?: boolean;
}) {
  const wl = state.voi
    ? `W ${Math.round(state.voi.upper - state.voi.lower)} / L ${Math.round(
        (state.voi.upper + state.voi.lower) / 2,
      )}`
    : '';
  return (
    <>
      <div className="absolute top-1 left-2 text-xs text-sky-300 pointer-events-none">{label}</div>
      {!is3d && (
        <div
          className="absolute bottom-1 left-2 text-xs text-neutral-300 pointer-events-none"
          data-testid={`slice-${label}`}
        >
          {state.numSlices ? `${state.sliceIndex + 1} / ${state.numSlices}` : ''}
        </div>
      )}
      {!is3d && (
        <div
          className="absolute bottom-1 right-2 text-xs text-neutral-300 pointer-events-none"
          data-testid={`wl-${label}`}
        >
          {wl}
        </div>
      )}
    </>
  );
}
