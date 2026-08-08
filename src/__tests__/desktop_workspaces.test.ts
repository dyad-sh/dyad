import { describe, expect, it } from "vitest";

import {
  addWorkspace,
  adjacentWorkspaceId,
  DEFAULT_WORKSPACES,
  removeWorkspace,
  renameWorkspace,
  reorderWorkspaces,
  resolveActiveWorkspace,
} from "@/lib/desktop/workspaces";
import {
  DEFAULT_PANEL_CONFIG,
  desktopArea,
  PANEL_THICKNESS,
  panelReservedSpace,
  shouldRevealPanel,
} from "@/lib/desktop/panel_config";
import {
  moveWindowToWorkspace,
  openWindow,
  windowsOnWorkspace,
  frontWindow,
} from "@/lib/desktop/window_manager";

const SCREEN = { width: 1400, height: 900 };
let n = 0;
const id = () => `id${(n += 1)}`;

describe("workspaces", () => {
  it("ships four named workspaces", () => {
    expect(DEFAULT_WORKSPACES.map((w) => w.name)).toEqual([
      "Home",
      "AI",
      "Development",
      "Media",
    ]);
  });

  it("adds and renames", () => {
    let workspaces = addWorkspace(DEFAULT_WORKSPACES, id);
    expect(workspaces).toHaveLength(5);
    workspaces = renameWorkspace(workspaces, workspaces[4].id, "Research");
    expect(workspaces[4].name).toBe("Research");
  });

  it("ignores an empty rename", () => {
    const renamed = renameWorkspace(DEFAULT_WORKSPACES, "home", "   ");
    expect(renamed[0].name).toBe("Home");
  });

  it("reassigns windows when a workspace is removed", () => {
    const result = removeWorkspace(DEFAULT_WORKSPACES, "ai", "ai");
    expect(result.workspaces).toHaveLength(3);
    // Windows must land somewhere reachable, and the view must follow.
    expect(result.reassignTo).toBe("dev");
    expect(result.activeId).toBe("dev");
  });

  it("keeps the active workspace when removing a different one", () => {
    const result = removeWorkspace(DEFAULT_WORKSPACES, "media", "home");
    expect(result.activeId).toBe("home");
  });

  it("refuses to remove the last workspace", () => {
    const single = [{ id: "only", name: "Only" }];
    const result = removeWorkspace(single, "only", "only");
    expect(result.workspaces).toBe(single);
  });

  it("reorders", () => {
    const moved = reorderWorkspaces(DEFAULT_WORKSPACES, 0, 2);
    expect(moved.map((w) => w.id)).toEqual(["ai", "dev", "home", "media"]);
  });

  it("wraps when switching past either end", () => {
    expect(adjacentWorkspaceId(DEFAULT_WORKSPACES, "media", 1)).toBe("home");
    expect(adjacentWorkspaceId(DEFAULT_WORKSPACES, "home", -1)).toBe("media");
  });

  it("recovers from a stale persisted active id", () => {
    expect(resolveActiveWorkspace(DEFAULT_WORKSPACES, "deleted")).toBe("home");
  });
});

describe("windows across workspaces", () => {
  it("shows only this workspace's windows, plus pinned ones", () => {
    let windows = openWindow([], "chat", SCREEN, id, "home");
    windows = openWindow(windows, "settings", SCREEN, id, "ai");
    windows = openWindow(windows, "jarvis", SCREEN, id, null);

    const onHome = windowsOnWorkspace(windows, "home");
    expect(onHome.map((w) => w.appId).sort()).toEqual(["chat", "jarvis"]);
  });

  it("lets the same app be open on two workspaces", () => {
    let windows = openWindow([], "chat", SCREEN, id, "home");
    windows = openWindow(windows, "chat", SCREEN, id, "ai");
    expect(windows).toHaveLength(2);
  });

  it("still focuses rather than duplicating within one workspace", () => {
    let windows = openWindow([], "chat", SCREEN, id, "home");
    windows = openWindow(windows, "chat", SCREEN, id, "home");
    expect(windows).toHaveLength(1);
  });

  it("moves a window to another workspace", () => {
    let windows = openWindow([], "chat", SCREEN, id, "home");
    windows = moveWindowToWorkspace(windows, windows[0].id, "dev");
    expect(windowsOnWorkspace(windows, "home")).toHaveLength(0);
    expect(windowsOnWorkspace(windows, "dev")).toHaveLength(1);
  });

  it("scopes the front window to the active workspace", () => {
    let windows = openWindow([], "chat", SCREEN, id, "home");
    windows = openWindow(windows, "settings", SCREEN, id, "ai");
    // The newest window is frontmost overall but lives elsewhere.
    expect(frontWindow(windows, "home")?.appId).toBe("chat");
  });
});

describe("panel geometry", () => {
  it("reserves space so windows never sit under the panel", () => {
    const area = desktopArea(SCREEN, DEFAULT_PANEL_CONFIG);
    expect(area.height).toBe(
      SCREEN.height - PANEL_THICKNESS[DEFAULT_PANEL_CONFIG.size],
    );
    expect(area.width).toBe(SCREEN.width);
  });

  it("takes width instead of height when docked to a side", () => {
    const area = desktopArea(SCREEN, {
      ...DEFAULT_PANEL_CONFIG,
      edge: "left",
    });
    expect(area.width).toBe(SCREEN.width - PANEL_THICKNESS.comfortable);
    expect(area.height).toBe(SCREEN.height);
  });

  it("reserves nothing while auto-hiding", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, hide: "auto-hide" as const };
    expect(panelReservedSpace(config)).toBe(0);
    expect(desktopArea(SCREEN, config).height).toBe(SCREEN.height);
  });

  it("reveals an auto-hidden panel only at its own edge", () => {
    const config = { ...DEFAULT_PANEL_CONFIG, hide: "auto-hide" as const };
    expect(shouldRevealPanel(config, { x: 700, y: 899 }, SCREEN)).toBe(true);
    expect(shouldRevealPanel(config, { x: 700, y: 400 }, SCREEN)).toBe(false);
    expect(shouldRevealPanel(config, { x: 700, y: 2 }, SCREEN)).toBe(false);
  });

  it("never reveals a panel that is always visible", () => {
    expect(
      shouldRevealPanel(DEFAULT_PANEL_CONFIG, { x: 700, y: 899 }, SCREEN),
    ).toBe(false);
  });
});
