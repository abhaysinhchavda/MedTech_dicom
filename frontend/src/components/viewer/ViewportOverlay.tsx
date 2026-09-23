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
  const frac = state.numSlices ? (state.sliceIndex + 1) / state.numSlices : 0;
  return (
    <>
      <div className="pointer-events-none absolute top-2 left-2 text-[11px] leading-none font-medium tracking-wide text-accent">
        {label}
      </div>

      {!is3d && (
        <>
          {/* Where this slice sits in the stack, without reading the counter:
              the only always-visible depth cue while scrolling or dragging
              the crosshairs. */}
          {state.numSlices > 1 && (
            <div className="pointer-events-none absolute top-8 bottom-8 left-1.5 w-0.5 rounded-full bg-ink/10">
              <div
                className="absolute h-2 w-full rounded-full bg-accent"
                style={{ top: `calc(${frac * 100}% - 4px)` }}
              />
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between text-[11px] leading-none text-ink/80">
            <span className="num" data-testid={`slice-${label}`}>
              {state.numSlices ? `${state.sliceIndex + 1} / ${state.numSlices}` : ''}
            </span>
            <span className="flex gap-3">
              <span className="num" data-testid={`zoom-${label}`}>
                {`${state.zoom.toFixed(2)}x`}
              </span>
              <span className="num" data-testid={`wl-${label}`}>
                {wl}
              </span>
            </span>
          </div>
        </>
      )}
    </>
  );
}
