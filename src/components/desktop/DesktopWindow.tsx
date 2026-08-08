import {
  Component,
  memo,
  useCallback,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, Minus, RefreshCw, X } from "lucide-react";

import type {
  DesktopWindowState,
  SnapKind,
  Viewport,
  WindowBounds,
} from "@/lib/desktop/window_manager";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  snapTargetForPointer,
} from "@/lib/desktop/window_manager";
import { cn } from "@/lib/utils";

/**
 * One feature crashing must take down its window, not the desktop. Retry
 * remounts the feature; the underlying data lives in stores and is untouched.
 */
class WindowErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="desktop-window-error">
          <p>This application ran into a problem.</p>
          <p className="desktop-window-error-detail">
            {this.state.error.message}
          </p>
          <div className="desktop-window-error-actions">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
            >
              <RefreshCw className="size-3.5" /> Retry
            </button>
            <button type="button" onClick={this.props.onClose}>
              <X className="size-3.5" /> Close
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type ResizeAxis = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_AXES: ResizeAxis[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * The frame a resize gesture produces. Edges containing west or north move
 * the origin as they change the size; minimums are enforced against the
 * anchored edge so the window never slides while pinned at its smallest.
 */
function resizedBounds(
  base: WindowBounds,
  axis: ResizeAxis,
  dx: number,
  dy: number,
): WindowBounds {
  let { x, y, width, height } = base;
  if (axis.includes("e")) width = base.width + dx;
  if (axis.includes("s")) height = base.height + dy;
  if (axis.includes("w")) {
    width = Math.max(MIN_WINDOW_WIDTH, base.width - dx);
    x = base.x + (base.width - width);
  }
  if (axis.includes("n")) {
    height = Math.max(MIN_WINDOW_HEIGHT, base.height - dy);
    y = base.y + (base.height - height);
  }
  return {
    x,
    y,
    width: Math.max(MIN_WINDOW_WIDTH, width),
    height: Math.max(MIN_WINDOW_HEIGHT, height),
  };
}

/**
 * Re-renders only when the app itself changes. Dragging and resizing touch
 * the frame's style, and must not re-render a streaming chat on every pointer
 * event.
 */
const WindowContent = memo(function WindowContent({
  component: App,
}: {
  component: ComponentType;
}) {
  return <App />;
});

export function DesktopWindow({
  window: win,
  title,
  component,
  isFront,
  viewport,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onMove,
  onResizeBounds,
  onSnap,
  onSnapPreview,
}: {
  window: DesktopWindowState;
  title: string;
  component: ComponentType;
  isFront: boolean;
  viewport: Viewport;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onMove: (x: number, y: number) => void;
  onResizeBounds: (bounds: WindowBounds) => void;
  onSnap: (kind: SnapKind) => void;
  onSnapPreview: (kind: SnapKind | null) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    frame: number | null;
    snap: SnapKind | null;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    base: WindowBounds;
    axis: ResizeAxis;
    frame: number | null;
  } | null>(null);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      // Buttons in the title bar are not drag handles.
      if ((event.target as HTMLElement).closest("button")) return;
      if (win.maximized) return;
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseX: win.bounds.x,
        baseY: win.bounds.y,
        frame: null,
        snap: null,
      };
    },
    [win.bounds.x, win.bounds.y, win.maximized],
  );

  const dragMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      // Transform on the frame, committed to state only on release: pointer
      // events must never re-render the window's content.
      if (drag.frame === null) {
        drag.frame = requestAnimationFrame(() => {
          drag.frame = null;
          const el = frameRef.current;
          if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
        });
      }
      const snap = snapTargetForPointer(event.clientX, event.clientY, viewport);
      if (snap !== drag.snap) {
        drag.snap = snap;
        onSnapPreview(snap);
      }
    },
    [onSnapPreview, viewport],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      const el = frameRef.current;
      if (el) el.style.transform = "";
      onSnapPreview(null);

      if (drag.snap) {
        onSnap(drag.snap);
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (dx !== 0 || dy !== 0) onMove(drag.baseX + dx, drag.baseY + dy);
    },
    [onMove, onSnap, onSnapPreview],
  );

  const startResize = useCallback(
    (axis: ResizeAxis) => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      resizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        base: win.bounds,
        axis,
        frame: null,
      };
    },
    [win.bounds],
  );

  const resizeMove = useCallback((event: React.PointerEvent) => {
    const resize = resizeRef.current;
    if (!resize || event.pointerId !== resize.pointerId) return;
    if (resize.frame !== null) return;
    resize.frame = requestAnimationFrame(() => {
      resize.frame = null;
      const el = frameRef.current;
      if (!el) return;
      const next = resizedBounds(
        resize.base,
        resize.axis,
        event.clientX - resize.startX,
        event.clientY - resize.startY,
      );
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
      el.style.width = `${next.width}px`;
      el.style.height = `${next.height}px`;
    });
  }, []);

  const endResize = useCallback(
    (event: React.PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || event.pointerId !== resize.pointerId) return;
      resizeRef.current = null;
      if (resize.frame !== null) cancelAnimationFrame(resize.frame);
      onResizeBounds(
        resizedBounds(
          resize.base,
          resize.axis,
          event.clientX - resize.startX,
          event.clientY - resize.startY,
        ),
      );
      const el = frameRef.current;
      if (el) {
        el.style.left = "";
        el.style.top = "";
        el.style.width = "";
        el.style.height = "";
      }
    },
    [onResizeBounds],
  );

  return (
    <div
      ref={frameRef}
      role="dialog"
      aria-label={title}
      className={cn(
        "desktop-window",
        isFront && "is-front",
        win.maximized && "is-maximized",
      )}
      style={{
        left: win.bounds.x,
        top: win.bounds.y,
        width: win.bounds.width,
        height: win.bounds.height,
        zIndex: win.z,
        display: win.minimized ? "none" : undefined,
      }}
      onPointerDownCapture={onFocus}
      data-testid={`desktop-window-${win.appId}`}
    >
      <header
        className="desktop-window-titlebar"
        onPointerDown={startDrag}
        onPointerMove={dragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onToggleMaximize}
      >
        <span className="desktop-window-title">{title}</span>
        <div className="desktop-window-controls">
          <button
            type="button"
            aria-label={`Minimise ${title}`}
            onClick={onMinimize}
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={
              win.maximized ? `Restore ${title}` : `Maximise ${title}`
            }
            onClick={onToggleMaximize}
          >
            {win.maximized ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
          </button>
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="desktop-window-close"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="desktop-window-body">
        <WindowErrorBoundary onClose={onClose}>
          <WindowContent component={component} />
        </WindowErrorBoundary>
      </div>

      {!win.maximized &&
        RESIZE_AXES.map((axis) => (
          <div
            key={axis}
            className={`desktop-resize desktop-resize-${axis}`}
            onPointerDown={startResize(axis)}
            onPointerMove={resizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        ))}
    </div>
  );
}
