import { describe, expect, it } from "vitest";

import {
  boundsForSnap,
  clampBounds,
  closeWindow,
  COMPACT_VIEWPORT_WIDTH,
  focusWindow,
  frontWindow,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  minimizeWindow,
  moveWindow,
  openWindow,
  resizeWindow,
  setWindowBounds,
  snapTargetForPointer,
  snapWindow,
  toggleMaximize,
  type DesktopWindowState,
} from "@/lib/desktop/window_manager";

const VIEWPORT = { width: 1400, height: 900 };
let nextId = 0;
const createId = () => `w${(nextId += 1)}`;

function open(windows: DesktopWindowState[] = [], appId = "chat") {
  return openWindow(windows, appId, VIEWPORT, createId);
}

describe("opening windows", () => {
  it("creates a window with sensible bounds and focus", () => {
    const windows = open();
    expect(windows).toHaveLength(1);
    expect(windows[0].minimized).toBe(false);
    expect(windows[0].bounds.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
    expect(frontWindow(windows)?.appId).toBe("chat");
  });

  it("cascades subsequent windows instead of stacking exactly", () => {
    const windows = open(open(), "settings");
    expect(windows[1].bounds.x).toBeGreaterThan(windows[0].bounds.x);
    expect(windows[1].bounds.y).toBeGreaterThan(windows[0].bounds.y);
  });

  it("focuses and restores an app that is already open, never duplicating", () => {
    let windows = open();
    windows = minimizeWindow(windows, windows[0].id);
    windows = open(windows, "chat");
    expect(windows).toHaveLength(1);
    expect(windows[0].minimized).toBe(false);
  });

  it("opens maximised on a compact screen so nothing is unreachable", () => {
    const small = { width: COMPACT_VIEWPORT_WIDTH - 100, height: 600 };
    const windows = openWindow([], "chat", small, createId);
    expect(windows[0].maximized).toBe(true);
    expect(windows[0].bounds.width).toBe(small.width);
  });
});

describe("focus and stacking", () => {
  it("brings the focused window to the front", () => {
    let windows = open(open(), "settings");
    const [first, second] = windows;
    expect(frontWindow(windows)?.id).toBe(second.id);

    windows = focusWindow(windows, first.id);
    expect(frontWindow(windows)?.id).toBe(first.id);
  });

  it("is a no-op when the window is already frontmost", () => {
    const windows = open();
    expect(focusWindow(windows, windows[0].id)).toBe(windows);
  });

  it("restores a minimised window on focus", () => {
    let windows = open();
    windows = minimizeWindow(windows, windows[0].id);
    windows = focusWindow(windows, windows[0].id);
    expect(windows[0].minimized).toBe(false);
  });

  it("ignores a window that does not exist", () => {
    const windows = open();
    expect(focusWindow(windows, "missing")).toBe(windows);
  });
});

describe("minimise, maximise, close", () => {
  it("minimising hides the window from the front but keeps it", () => {
    let windows = open();
    windows = minimizeWindow(windows, windows[0].id);
    expect(windows).toHaveLength(1);
    expect(frontWindow(windows)).toBeUndefined();
  });

  it("maximise fills the viewport and restore puts the window back", () => {
    let windows = open();
    const original = windows[0].bounds;

    windows = toggleMaximize(windows, windows[0].id, VIEWPORT);
    expect(windows[0].bounds).toEqual({ x: 0, y: 0, ...VIEWPORT });
    expect(windows[0].maximized).toBe(true);

    windows = toggleMaximize(windows, windows[0].id, VIEWPORT);
    expect(windows[0].bounds).toEqual(original);
    expect(windows[0].maximized).toBe(false);
  });

  it("closing removes only that window", () => {
    let windows = open(open(), "settings");
    windows = closeWindow(windows, windows[0].id);
    expect(windows).toHaveLength(1);
    expect(windows[0].appId).toBe("settings");
  });
});

describe("moving and resizing", () => {
  it("moves within the viewport", () => {
    let windows = open();
    windows = moveWindow(windows, windows[0].id, 200, 100, VIEWPORT);
    expect(windows[0].bounds.x).toBe(200);
    expect(windows[0].bounds.y).toBe(100);
  });

  it("never lets the title bar leave the viewport", () => {
    let windows = open();
    windows = moveWindow(windows, windows[0].id, 99_999, 99_999, VIEWPORT);
    expect(windows[0].bounds.x).toBeLessThanOrEqual(VIEWPORT.width - 120);
    expect(windows[0].bounds.y).toBeLessThanOrEqual(VIEWPORT.height - 48);

    windows = moveWindow(windows, windows[0].id, -99_999, -99_999, VIEWPORT);
    expect(windows[0].bounds.y).toBeGreaterThanOrEqual(0);
  });

  it("enforces minimum window dimensions", () => {
    let windows = open();
    windows = resizeWindow(windows, windows[0].id, 10, 10, VIEWPORT);
    expect(windows[0].bounds.width).toBe(MIN_WINDOW_WIDTH);
    expect(windows[0].bounds.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it("moving a maximised window un-maximises it", () => {
    let windows = open();
    windows = toggleMaximize(windows, windows[0].id, VIEWPORT);
    windows = moveWindow(windows, windows[0].id, 100, 100, VIEWPORT);
    expect(windows[0].maximized).toBe(false);
  });
});

describe("snapping", () => {
  it("maps pointer positions to snap targets", () => {
    expect(snapTargetForPointer(4, 450, VIEWPORT)).toBe("left");
    expect(snapTargetForPointer(1396, 450, VIEWPORT)).toBe("right");
    expect(snapTargetForPointer(700, 4, VIEWPORT)).toBe("maximize");
    expect(snapTargetForPointer(4, 40, VIEWPORT)).toBe("top-left");
    expect(snapTargetForPointer(1396, 40, VIEWPORT)).toBe("top-right");
    expect(snapTargetForPointer(4, 860, VIEWPORT)).toBe("bottom-left");
    expect(snapTargetForPointer(1396, 860, VIEWPORT)).toBe("bottom-right");
  });

  it("does not snap in the middle of the desktop or at the dock edge", () => {
    expect(snapTargetForPointer(700, 450, VIEWPORT)).toBeNull();
    expect(snapTargetForPointer(700, 896, VIEWPORT)).toBeNull();
  });

  it("halves and quarters tile the viewport exactly", () => {
    const left = boundsForSnap("left", VIEWPORT);
    const right = boundsForSnap("right", VIEWPORT);
    expect(left.width + right.width).toBe(VIEWPORT.width);

    const tl = boundsForSnap("top-left", VIEWPORT);
    const br = boundsForSnap("bottom-right", VIEWPORT);
    expect(tl.height + br.height).toBe(VIEWPORT.height);
  });

  it("remembers where the window was for un-snapping", () => {
    let windows = open();
    const original = windows[0].bounds;
    windows = snapWindow(windows, windows[0].id, "left", VIEWPORT);
    expect(windows[0].bounds.width).toBe(VIEWPORT.width / 2);
    expect(windows[0].restoreBounds).toEqual(original);
  });

  it("snapping to the top counts as maximised", () => {
    let windows = open();
    windows = snapWindow(windows, windows[0].id, "maximize", VIEWPORT);
    expect(windows[0].maximized).toBe(true);
  });
});

describe("setWindowBounds", () => {
  it("moves and resizes in one operation, as a left-edge drag needs", () => {
    let windows = open();
    windows = setWindowBounds(
      windows,
      windows[0].id,
      { x: 120, y: 80, width: 640, height: 480 },
      VIEWPORT,
    );
    expect(windows[0].bounds).toEqual({
      x: 120,
      y: 80,
      width: 640,
      height: 480,
    });
  });

  it("still clamps against the viewport and minimums", () => {
    let windows = open();
    windows = setWindowBounds(
      windows,
      windows[0].id,
      { x: -5000, y: -5000, width: 10, height: 10 },
      VIEWPORT,
    );
    expect(windows[0].bounds.width).toBe(MIN_WINDOW_WIDTH);
    expect(windows[0].bounds.y).toBeGreaterThanOrEqual(0);
  });

  it("un-maximises the window it reshapes", () => {
    let windows = open();
    windows = toggleMaximize(windows, windows[0].id, VIEWPORT);
    windows = setWindowBounds(
      windows,
      windows[0].id,
      { x: 50, y: 50, width: 700, height: 500 },
      VIEWPORT,
    );
    expect(windows[0].maximized).toBe(false);
  });
});

describe("clampBounds", () => {
  it("shrinks a window larger than the viewport", () => {
    const clamped = clampBounds(
      { x: 0, y: 0, width: 5000, height: 5000 },
      VIEWPORT,
    );
    expect(clamped.width).toBe(VIEWPORT.width);
    expect(clamped.height).toBe(VIEWPORT.height);
  });
});
