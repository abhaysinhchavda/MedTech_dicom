import { Enums, getRenderingEngine, utilities, type Types } from '@cornerstonejs/core';
import { useEffect, useReducer } from 'react';

export interface ViewportState {
  sliceIndex: number;
  numSlices: number;
  voi: { lower: number; upper: number } | null;
  zoom: number;
}
export type ViewportEvent =
  | { type: 'slice'; sliceIndex: number; numSlices: number }
  | { type: 'voi'; lower: number; upper: number }
  | { type: 'zoom'; zoom: number };
export const initialViewportState: ViewportState = {
  sliceIndex: 0,
  numSlices: 0,
  voi: null,
  zoom: 1,
};

export function viewportReducer(s: ViewportState, e: ViewportEvent): ViewportState {
  switch (e.type) {
    case 'slice':
      return { ...s, sliceIndex: e.sliceIndex, numSlices: e.numSlices };
    case 'voi':
      return { ...s, voi: { lower: e.lower, upper: e.upper } };
    case 'zoom':
      return { ...s, zoom: e.zoom };
  }
}

export function useViewportState(
  engineId: string,
  viewportId: string,
  enabled: boolean,
): ViewportState {
  const [state, dispatch] = useReducer(viewportReducer, initialViewportState);
  useEffect(() => {
    if (!enabled) return;
    const vp = getRenderingEngine(engineId)?.getViewport(viewportId) as
      Types.IVolumeViewport | undefined;
    if (!vp) return;
    const el = vp.element;
    const readSlice = () => {
      try {
        const d = utilities.getImageSliceDataForVolumeViewport(vp);
        dispatch({ type: 'slice', sliceIndex: d.imageIndex, numSlices: d.numberOfSlices });
      } catch {
        /* volume not attached yet */
      }
    };
    const onVoi = (e: Event) => {
      const r = (e as CustomEvent<{ range: { lower: number; upper: number } }>).detail.range;
      dispatch({ type: 'voi', lower: r.lower, upper: r.upper });
    };
    const onCam = () => {
      readSlice();
      dispatch({ type: 'zoom', zoom: vp.getZoom() });
    };
    const events = [Enums.Events.VOLUME_NEW_IMAGE, Enums.Events.IMAGE_RENDERED];
    el.addEventListener(Enums.Events.VOI_MODIFIED, onVoi);
    el.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
    for (const ev of events) el.addEventListener(ev, readSlice);
    readSlice();
    // VolumeViewport's getProperties() override can return null/undefined
    // before a volume is attached, unlike the base Viewport signature.
    const props = vp.getProperties();
    if (props?.voiRange)
      dispatch({ type: 'voi', lower: props.voiRange.lower, upper: props.voiRange.upper });
    return () => {
      el.removeEventListener(Enums.Events.VOI_MODIFIED, onVoi);
      el.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      for (const ev of events) el.removeEventListener(ev, readSlice);
    };
  }, [engineId, viewportId, enabled]);
  return state;
}
