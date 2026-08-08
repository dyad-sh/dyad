/**
 * Window management for Desktop Mode: pure functions over an array of window
 * states, so every behaviour is unit-testable and the React layer stays thin.
 *
 * A "window" here is a Meta Human OS feature hosted in a movable frame inside
 * the app — never a real operating-system window.
 */

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Viewport = { width: number; height: number };

export type DesktopWindowState = {
  /** Unique per window instance. */
  id: string;
  /** Which registered app this window shows. */
  appId: string;
  /** Workspace this window lives on; null means "on every workspace". */
  workspaceId: string | null;
  bounds: WindowBounds;
  minimized: boolean;
  maximized: boolean;
  /** Where to put the window back when it leaves maximised/snapped state. */
  restoreBounds: WindowBounds | null;
  /** Stacking order; highest is frontmost. */
  z: number;
};

export const MIN_WINDOW_WIDTH = 360;
export const MIN_WINDOW_HEIGHT = 240;

const DEFAULT_WIDTH = 860;
const DEFAULT_HEIGHT = 560;
/** Each newly opened window steps down-right from the last. */
const CASCADE_STEP = 32;

/** Screens narrower than this open every window maximised. */
export const COMPACT_VIEWPORT_WIDTH = 900;

function maxZ(windows: DesktopWindowState[]): number {
  return windows.reduce((top, w) => Math.max(top, w.z), 0);
}

/** Windows shown on a workspace: its own, plus any pinned to all. */
export function windowsOnWorkspace(
  windows: DesktopWindowState[],
  workspaceId: string,
): DesktopWindowState[] {
  return windows.filter(
    (w) => w.workspaceId === null || w.workspaceId === workspaceId,
  );
}

export function frontWindow(
  windows: DesktopWindowState[],
  workspaceId?: string,
): DesktopWindowState | undefined {
  const scoped = workspaceId
    ? windowsOnWorkspace(windows, workspaceId)
    : windows;
  const visible = scoped.filter((w) => !w.minimized);
  if (visible.length === 0) return undefined;
  return visible.reduce((front, w) => (w.z > front.z ? w : front));
}

/** Moves a window to another workspace, or pins it to all with null. */
export function moveWindowToWorkspace(
  windows: DesktopWindowState[],
  id: string,
  workspaceId: string | null,
): DesktopWindowState[] {
  return windows.map((w) => (w.id === id ? { ...w, workspaceId } : w));
}

/** Keeps at least the title bar reachable, whatever happened to the numbers. */
export function clampBounds(
  bounds: WindowBounds,
  viewport: Viewport,
): WindowBounds {
  const width = Math.max(
    MIN_WINDOW_WIDTH,
    Math.min(bounds.width, viewport.width),
  );
  const height = Math.max(
    MIN_WINDOW_HEIGHT,
    Math.min(bounds.height, viewport.height),
  );
  const x = Math.min(Math.max(bounds.x, -width + 120), viewport.width - 120);
  const y = Math.min(Math.max(bounds.y, 0), viewport.height - 48);
  return { x, y, width, height };
}

function cascadeBounds(
  windows: DesktopWindowState[],
  viewport: Viewport,
): WindowBounds {
  const offset = (windows.length % 8) * CASCADE_STEP;
  const width = Math.min(DEFAULT_WIDTH, viewport.width - 48);
  const height = Math.min(DEFAULT_HEIGHT, viewport.height - 48);
  return clampBounds(
    { x: 48 + offset, y: 24 + offset, width, height },
    viewport,
  );
}

/**
 * Opens an app. One window per app: if it is already open it is focused and
 * restored rather than duplicated — that is what a dock click means.
 */
export function openWindow(
  windows: DesktopWindowState[],
  appId: string,
  viewport: Viewport,
  createId: () => string = () => crypto.randomUUID(),
  workspaceId: string | null = null,
): DesktopWindowState[] {
  // Only match a window the current workspace can actually see, so the same
  // app can be open on two workspaces independently.
  const existing = windows.find(
    (w) =>
      w.appId === appId &&
      (w.workspaceId === null || w.workspaceId === workspaceId),
  );
  if (existing) {
    return windows.map((w) =>
      w.id === existing.id
        ? { ...w, minimized: false, z: maxZ(windows) + 1 }
        : w,
    );
  }

  const compact = viewport.width < COMPACT_VIEWPORT_WIDTH;
  const next: DesktopWindowState = {
    id: createId(),
    appId,
    workspaceId,
    bounds: compact
      ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
      : cascadeBounds(windows, viewport),
    minimized: false,
    // Small screens get maximised windows so nothing ends up unreachable.
    maximized: compact,
    restoreBounds: compact ? cascadeBounds(windows, viewport) : null,
    z: maxZ(windows) + 1,
  };
  return [...windows, next];
}

export function closeWindow(
  windows: DesktopWindowState[],
  id: string,
): DesktopWindowState[] {
  return windows.filter((w) => w.id !== id);
}

export function focusWindow(
  windows: DesktopWindowState[],
  id: string,
): DesktopWindowState[] {
  const target = windows.find((w) => w.id === id);
  if (!target) return windows;
  const top = maxZ(windows);
  // Already frontmost and visible: nothing to change, avoid churn.
  if (target.z === top && !target.minimized) return windows;
  return windows.map((w) =>
    w.id === id ? { ...w, minimized: false, z: top + 1 } : w,
  );
}

export function minimizeWindow(
  windows: DesktopWindowState[],
  id: string,
): DesktopWindowState[] {
  return windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
}

export function toggleMaximize(
  windows: DesktopWindowState[],
  id: string,
  viewport: Viewport,
): DesktopWindowState[] {
  return windows.map((w) => {
    if (w.id !== id) return w;
    if (w.maximized) {
      return {
        ...w,
        maximized: false,
        bounds: w.restoreBounds
          ? clampBounds(w.restoreBounds, viewport)
          : w.bounds,
        restoreBounds: null,
      };
    }
    return {
      ...w,
      maximized: true,
      restoreBounds: w.bounds,
      bounds: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    };
  });
}

export function moveWindow(
  windows: DesktopWindowState[],
  id: string,
  x: number,
  y: number,
  viewport: Viewport,
): DesktopWindowState[] {
  return windows.map((w) =>
    w.id === id
      ? {
          ...w,
          maximized: false,
          bounds: clampBounds({ ...w.bounds, x, y }, viewport),
        }
      : w,
  );
}

/**
 * Sets the whole frame at once — needed for resizes from the left or top
 * edge, which move the origin and change the size in the same gesture.
 */
export function setWindowBounds(
  windows: DesktopWindowState[],
  id: string,
  bounds: WindowBounds,
  viewport: Viewport,
): DesktopWindowState[] {
  return windows.map((w) =>
    w.id === id
      ? { ...w, maximized: false, bounds: clampBounds(bounds, viewport) }
      : w,
  );
}

export function resizeWindow(
  windows: DesktopWindowState[],
  id: string,
  width: number,
  height: number,
  viewport: Viewport,
): DesktopWindowState[] {
  return windows.map((w) =>
    w.id === id
      ? {
          ...w,
          maximized: false,
          bounds: clampBounds({ ...w.bounds, width, height }, viewport),
        }
      : w,
  );
}

// --- snapping ---------------------------------------------------------------

export type SnapKind =
  | "left"
  | "right"
  | "maximize"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const EDGE_PX = 16;
const CORNER_PX = 96;

/**
 * What dropping a drag at this pointer position should snap to, if anything.
 * Corners win over edges so quarter-snaps stay reachable.
 */
export function snapTargetForPointer(
  px: number,
  py: number,
  viewport: Viewport,
): SnapKind | null {
  const nearLeft = px <= EDGE_PX;
  const nearRight = px >= viewport.width - EDGE_PX;
  const nearTop = py <= EDGE_PX;

  if (nearLeft) {
    if (py <= CORNER_PX) return "top-left";
    if (py >= viewport.height - CORNER_PX) return "bottom-left";
    return "left";
  }
  if (nearRight) {
    if (py <= CORNER_PX) return "top-right";
    if (py >= viewport.height - CORNER_PX) return "bottom-right";
    return "right";
  }
  if (nearTop) return "maximize";
  // The bottom edge is the dock's; dragging there must not snap.
  return null;
}

export function boundsForSnap(
  kind: SnapKind,
  viewport: Viewport,
): WindowBounds {
  const halfW = Math.floor(viewport.width / 2);
  const halfH = Math.floor(viewport.height / 2);
  switch (kind) {
    case "maximize":
      return { x: 0, y: 0, width: viewport.width, height: viewport.height };
    case "left":
      return { x: 0, y: 0, width: halfW, height: viewport.height };
    case "right":
      return {
        x: halfW,
        y: 0,
        width: viewport.width - halfW,
        height: viewport.height,
      };
    case "top-left":
      return { x: 0, y: 0, width: halfW, height: halfH };
    case "top-right":
      return { x: halfW, y: 0, width: viewport.width - halfW, height: halfH };
    case "bottom-left":
      return { x: 0, y: halfH, width: halfW, height: viewport.height - halfH };
    case "bottom-right":
      return {
        x: halfW,
        y: halfH,
        width: viewport.width - halfW,
        height: viewport.height - halfH,
      };
  }
}

/** Applies a snap, remembering where the window was for un-snapping. */
export function snapWindow(
  windows: DesktopWindowState[],
  id: string,
  kind: SnapKind,
  viewport: Viewport,
): DesktopWindowState[] {
  return windows.map((w) => {
    if (w.id !== id) return w;
    return {
      ...w,
      maximized: kind === "maximize",
      restoreBounds: w.restoreBounds ?? w.bounds,
      bounds: boundsForSnap(kind, viewport),
    };
  });
}
