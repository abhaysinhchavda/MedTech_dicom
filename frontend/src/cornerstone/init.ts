import { init as coreInit } from '@cornerstonejs/core';
import {
  init as toolsInit,
  addTool,
  CrosshairsTool,
  PanTool,
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
    for (const T of [
      WindowLevelTool,
      PanTool,
      ZoomTool,
      StackScrollTool,
      CrosshairsTool,
      TrackballRotateTool,
    ])
      addTool(T);
  })();
  return ready;
}
