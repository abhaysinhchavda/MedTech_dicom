import { init as coreInit } from '@cornerstonejs/core';
import {
  init as toolsInit,
  addTool,
  AngleTool,
  CrosshairsTool,
  EllipticalROITool,
  LengthTool,
  PanTool,
  ProbeTool,
  StackScrollTool,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

let ready: Promise<void> | null = null;

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function initCornerstone(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (!hasWebGL2()) throw new Error('WebGL2 required');
    await coreInit();
    toolsInit();
    dicomImageLoaderInit({
      maxWebWorkers: Math.max(1, Math.floor((navigator.hardwareConcurrency ?? 2) / 2)),
    });
    // @cornerstonejs/dicom-image-loader's xhrRequest (imageLoader/internal/xhrRequest.js)
    // rejects an in-flight image fetch with the raw XMLHttpRequest object --
    // not an Error -- from xhr.onabort/onerror. Nothing upstream attaches a
    // .catch to that per-image promise, so cancelling a load (e.g.
    // cache.removeVolumeLoadObject() when a series switch or unmount aborts
    // volume.ts's loadVolume, including React StrictMode's dev-only
    // mount->cleanup->remount cycle) reliably surfaces as an unhandled
    // promise rejection. It carries no diagnostic value beyond what the
    // IMAGE_LOAD_ERROR event already reports (handled in
    // cornerstone/volume.ts's onErr), so swallow specifically -- and only --
    // rejections shaped like this one.
    window.addEventListener('unhandledrejection', (e) => {
      if (e.reason instanceof XMLHttpRequest) e.preventDefault();
    });
    // Cornerstone keeps a global tool registry separate from tool groups. A
    // group's addTool(name) silently does nothing for a tool that was never
    // registered here, so every tool the app uses has to appear in this list.
    for (const T of [
      WindowLevelTool,
      PanTool,
      ZoomTool,
      StackScrollTool,
      CrosshairsTool,
      TrackballRotateTool,
      LengthTool,
      AngleTool,
      ProbeTool,
      EllipticalROITool,
    ])
      addTool(T);
  })();
  return ready;
}
