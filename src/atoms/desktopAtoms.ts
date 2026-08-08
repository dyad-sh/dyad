import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { DesktopWindowState } from "@/lib/desktop/window_manager";
import { DEFAULT_DOCK_PINS } from "@/lib/desktop/desktop_apps";
import { DEFAULT_WORKSPACES, type Workspace } from "@/lib/desktop/workspaces";
import {
  DEFAULT_PANEL_CONFIG,
  type PanelConfig,
} from "@/lib/desktop/panel_config";

/**
 * Whether the app presents as the Linux-style desktop. Presentation only:
 * every feature keeps its own state wherever it already lives.
 */
export const desktopModeAtom = atomWithStorage<boolean>(
  "desktop-mode-enabled",
  false,
);

/** Open desktop windows, persisted so the workspace survives a restart. */
export const desktopWindowsAtom = atomWithStorage<DesktopWindowState[]>(
  "desktop-mode-windows",
  [],
);

/** Apps pinned to the dock. */
export const desktopDockPinsAtom = atomWithStorage<string[]>(
  "desktop-mode-dock-pins",
  DEFAULT_DOCK_PINS,
);

/** Launcher visibility is session-only; it should never reopen on restart. */
export const desktopLauncherOpenAtom = atom(false);

/** Virtual workspaces and which one is showing. */
export const desktopWorkspacesAtom = atomWithStorage<Workspace[]>(
  "desktop-mode-workspaces",
  DEFAULT_WORKSPACES,
);

export const activeWorkspaceAtom = atomWithStorage<string>(
  "desktop-mode-active-workspace",
  DEFAULT_WORKSPACES[0].id,
);

/** Panel placement, size and hide behaviour. */
export const desktopPanelConfigAtom = atomWithStorage<PanelConfig>(
  "desktop-mode-panel",
  DEFAULT_PANEL_CONFIG,
);

/** Overlays are session-only: neither should reappear on restart. */
export const desktopOverviewOpenAtom = atom(false);
export const desktopQuickSettingsOpenAtom = atom(false);
