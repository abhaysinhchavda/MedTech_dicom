import {
  AngleTool,
  BidirectionalTool,
  CrosshairsTool,
  EllipticalROITool,
  Enums,
  LengthTool,
  PanTool,
  ProbeTool,
  StackScrollTool,
  ToolGroupManager,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import type { ToolName } from '../api/types';
import { MPR_IDS, VIEWPORT_IDS } from './viewports';

export const MPR_TOOL_GROUP = 'mpr';
export const VOL_TOOL_GROUP = 'vol3d';
const { MouseBindings, KeyboardBindings } = Enums;

export type MprTool = 'crosshairs' | 'windowLevel' | ToolName;

// Measurement tools go on the MPR group only. The 3D volume viewport has no
// in-plane geometry to measure against.
const MEASURE_TOOLS = [LengthTool, AngleTool, ProbeTool, EllipticalROITool, BidirectionalTool];
const LINE_COLORS: Record<string, string> = {
  [VIEWPORT_IDS.axial]: 'rgb(200, 0, 0)',
  [VIEWPORT_IDS.sagittal]: 'rgb(200, 200, 0)',
  [VIEWPORT_IDS.coronal]: 'rgb(0, 200, 0)',
};

export function createToolGroups(engineId: string): void {
  destroyToolGroups();
  const mpr = ToolGroupManager.createToolGroup(MPR_TOOL_GROUP)!;
  for (const id of MPR_IDS) mpr.addViewport(id, engineId);
  mpr.addTool(WindowLevelTool.toolName);
  mpr.addTool(PanTool.toolName);
  mpr.addTool(ZoomTool.toolName);
  mpr.addTool(StackScrollTool.toolName);
  mpr.addTool(CrosshairsTool.toolName, {
    getReferenceLineColor: (id: string) => LINE_COLORS[id] ?? 'rgb(255,255,255)',
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => true,
    getReferenceLineSlabThicknessControlsOn: () => false,
  });
  mpr.setToolActive(PanTool.toolName, {
    bindings: [
      { mouseButton: MouseBindings.Auxiliary },
      { mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift },
    ],
  });
  mpr.setToolActive(ZoomTool.toolName, {
    bindings: [
      { mouseButton: MouseBindings.Secondary },
      { mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Ctrl },
    ],
  });
  mpr.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }],
  });
  for (const Tool of MEASURE_TOOLS) mpr.addTool(Tool.toolName);
  setActiveMprTool('crosshairs');

  const vol = ToolGroupManager.createToolGroup(VOL_TOOL_GROUP)!;
  vol.addViewport(VIEWPORT_IDS.volume3d, engineId);
  vol.addTool(TrackballRotateTool.toolName);
  vol.addTool(PanTool.toolName);
  vol.addTool(ZoomTool.toolName);
  vol.setToolActive(TrackballRotateTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Primary }],
  });
  vol.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Auxiliary }],
  });
  vol.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Secondary }, { mouseButton: MouseBindings.Wheel }],
  });
}

const PRIMARY = [{ mouseButton: MouseBindings.Primary }];

/**
 * Exactly one tool owns left-drag at a time.
 *
 * Everything else that could own it is set passive, so existing annotations
 * still render and can be grabbed by their handles. Crosshairs is the
 * exception and is disabled outright, because its reference lines stay
 * interactive while passive and would swallow the drag.
 */
export function setActiveMprTool(tool: MprTool): void {
  const mpr = ToolGroupManager.getToolGroup(MPR_TOOL_GROUP);
  if (!mpr) return;
  mpr.setToolDisabled(CrosshairsTool.toolName);
  mpr.setToolPassive(WindowLevelTool.toolName);
  for (const Tool of MEASURE_TOOLS) mpr.setToolPassive(Tool.toolName);

  if (tool === 'crosshairs') mpr.setToolActive(CrosshairsTool.toolName, { bindings: PRIMARY });
  else if (tool === 'windowLevel')
    mpr.setToolActive(WindowLevelTool.toolName, { bindings: PRIMARY });
  else mpr.setToolActive(tool, { bindings: PRIMARY });
}

export function destroyToolGroups(): void {
  for (const id of [MPR_TOOL_GROUP, VOL_TOOL_GROUP])
    if (ToolGroupManager.getToolGroup(id)) ToolGroupManager.destroyToolGroup(id);
}
