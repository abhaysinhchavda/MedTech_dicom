import {
  CrosshairsTool,
  Enums,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { MPR_IDS, VIEWPORT_IDS } from './viewports';

export const MPR_TOOL_GROUP = 'mpr';
export const VOL_TOOL_GROUP = 'vol3d';
const { MouseBindings, KeyboardBindings } = Enums;
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
  setCrosshairsActive(true);

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

export function setCrosshairsActive(on: boolean): void {
  const mpr = ToolGroupManager.getToolGroup(MPR_TOOL_GROUP);
  if (!mpr) return;
  if (on) {
    mpr.setToolPassive(WindowLevelTool.toolName);
    mpr.setToolActive(CrosshairsTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  } else {
    mpr.setToolDisabled(CrosshairsTool.toolName);
    mpr.setToolActive(WindowLevelTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  }
}

export function destroyToolGroups(): void {
  for (const id of [MPR_TOOL_GROUP, VOL_TOOL_GROUP])
    if (ToolGroupManager.getToolGroup(id)) ToolGroupManager.destroyToolGroup(id);
}
