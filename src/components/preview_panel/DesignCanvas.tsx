import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtom, useAtomValue } from "jotai";
import Konva from "konva";
import { Maximize2, Palette, X, ZoomIn, ZoomOut } from "lucide-react";
import { designStateAtom } from "@/atoms/designAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import type { DesignBriefData, DesignInterfaceData } from "@/ipc/types/design";
import { loadDesignFonts } from "./designFonts";
import { DesignOptionsPicker } from "./DesignOptionsPicker";

// Widest a rendered frame is shown at inline; larger canvases scale down to fit.
const MAX_FRAME_WIDTH = 900;

// Zoom is a multiplier over the fit-to-view scale: 1 = the whole screen visible.
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

const clamp = (value: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, value));

/**
 * Renders one interface by executing the AI-authored Konva drawing code.
 *
 * - "inline": fits to width, static, and clicking it opens the full-page view.
 * - "fullscreen": fits the whole screen and supports zoom (buttons + Ctrl/Cmd
 *   wheel toward the cursor) and drag-to-pan.
 *
 * We own the Stage/Layer, scaling, and crispness; the design code only adds
 * shapes to the layer we hand it (see the design_interface tool's contract).
 */
function MockupStage({
  data,
  mode,
  onExpand,
}: {
  data: DesignInterfaceData;
  mode: "inline" | "fullscreen";
  onExpand?: () => void;
}) {
  const isFullscreen = mode === "fullscreen";
  const outerRef = useRef<HTMLDivElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: MAX_FRAME_WIDTH, height: 0 });

  useEffect(() => {
    const el = outerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit-to-view scale. Inline fits width (never past the native size or the max
  // frame width); fullscreen fits the whole screen within the available area.
  const fitScale = isFullscreen
    ? size.width && size.height
      ? Math.min(size.width / data.width, size.height / data.height)
      : 1
    : Math.min(size.width, MAX_FRAME_WIDTH, data.width) / data.width;

  const displayWidth = data.width * fitScale;
  const displayHeight = data.height * fitScale;

  // Latest layout numbers in a ref so the build effect (which should only re-run
  // when the design code changes) and the imperative wheel handler read current
  // values without depending on them.
  const layoutRef = useRef({ displayWidth, displayHeight, fitScale });
  layoutRef.current = { displayWidth, displayHeight, fitScale };

  // Clamp a stage position so zoomed-in content can't be panned entirely out of
  // the viewport (z is the zoom multiplier, i.e. effectiveScale / fitScale).
  const clampPos = useCallback((pos: { x: number; y: number }, z: number) => {
    const { displayWidth: dw, displayHeight: dh } = layoutRef.current;
    const minX = Math.min(0, dw * (1 - z));
    const minY = Math.min(0, dh * (1 - z));
    return {
      x: Math.min(0, Math.max(minX, pos.x)),
      y: Math.min(0, Math.max(minY, pos.y)),
    };
  }, []);

  // Zoom to `targetZoom`, keeping the focal point (viewport coords; defaults to
  // the viewport center) fixed on screen. Drives both the buttons and the wheel.
  const zoomTo = useCallback(
    (targetZoom: number, focal?: { x: number; y: number }) => {
      const stage = stageRef.current;
      if (!stage) return;
      const {
        displayWidth: dw,
        displayHeight: dh,
        fitScale: fs,
      } = layoutRef.current;
      const newZoom = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
      const oldScale = stage.scaleX();
      const fx = focal?.x ?? dw / 2;
      const fy = focal?.y ?? dh / 2;
      // The world-space point currently under the focal point stays put.
      const worldX = (fx - stage.x()) / oldScale;
      const worldY = (fy - stage.y()) / oldScale;
      const newScale = fs * newZoom;
      const rawPos = { x: fx - worldX * newScale, y: fy - worldY * newScale };
      const pos = newZoom <= 1 ? { x: 0, y: 0 } : clampPos(rawPos, newZoom);
      stage.scale({ x: newScale, y: newScale });
      stage.position(pos);
      stage.draggable(newZoom > 1);
      stage.batchDraw();
      setZoom(newZoom);
    },
    [clampPos],
  );

  // Build the stage and run the AI-authored Konva code. Rebuilds only when the
  // design changes — resize and zoom are applied below without re-running code.
  useEffect(() => {
    const container = stageContainerRef.current;
    if (!container) return;

    setError(null);
    const {
      displayWidth: dw,
      displayHeight: dh,
      fitScale: fs,
    } = layoutRef.current;
    const stage = new Konva.Stage({ container, width: dw, height: dh });
    stage.scale({ x: fs, y: fs });

    const layer = new Konva.Layer();
    stage.add(layer);

    // Paint the frame background before running the design code.
    layer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: data.width,
        height: data.height,
        fill: data.background,
      }),
    );

    try {
      // eslint-disable-next-line no-new-func
      const build = new Function(
        "Konva",
        "layer",
        "width",
        "height",
        data.code,
      );
      build(Konva, layer, data.width, data.height);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    layer.draw();

    // The first draw above can land before the mockup's fonts finish loading,
    // in which case canvas silently substitutes a default face. Redraw once
    // they're ready (no-op on the common path, where they're already cached).
    let cancelled = false;
    loadDesignFonts().then(() => {
      if (!cancelled) layer.draw();
    });

    const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
      // Ctrl/Cmd + wheel zooms; a plain wheel keeps scrolling the page.
      if (!e.evt.ctrlKey && !e.evt.metaKey) return;
      e.evt.preventDefault();
      const pointer = stage.getPointerPosition();
      const current = stage.scaleX() / layoutRef.current.fitScale;
      const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
      zoomTo(current * factor, pointer ?? undefined);
    };
    if (isFullscreen) stage.on("wheel", handleWheel);

    stageRef.current = stage;
    setZoom(1);
    return () => {
      cancelled = true;
      stage.destroy();
      stageRef.current = null;
    };
  }, [data, isFullscreen, zoomTo]);

  // Apply viewport size, zoom, and crispness whenever they change (resize/zoom),
  // without rebuilding the scene.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.width(displayWidth);
    stage.height(displayHeight);
    stage.scale({ x: fitScale * zoom, y: fitScale * zoom });
    stage.draggable(zoom > 1);
    stage.dragBoundFunc((pos) => clampPos(pos, stage.scaleX() / fitScale));
    stage.position(
      zoom <= 1 ? { x: 0, y: 0 } : clampPos(stage.position(), zoom),
    );

    // Render at native resolution × devicePixelRatio so a frame scaled down to
    // fit keeps full detail in the backing store and downscales crisply.
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // Cap the multiplier so very large frames don't create an oversized canvas.
    stage
      .getLayers()[0]
      ?.getCanvas()
      .setPixelRatio(Math.min(dpr / fitScale, 4));
    stage.batchDraw();
  }, [displayWidth, displayHeight, fitScale, zoom, clampPos]);

  const atMin = zoom <= MIN_ZOOM + 1e-3;
  const atMax = zoom >= MAX_ZOOM - 1e-3;

  return (
    <div
      ref={outerRef}
      className={
        isFullscreen
          ? "flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-6"
          : "w-full"
      }
      style={isFullscreen ? undefined : { maxWidth: MAX_FRAME_WIDTH }}
    >
      <div
        className={
          isFullscreen
            ? "relative overflow-hidden rounded-lg shadow-2xl"
            : "relative overflow-hidden rounded-lg border border-border shadow-sm"
        }
        style={{ width: displayWidth, height: displayHeight }}
        onClick={isFullscreen ? (e) => e.stopPropagation() : onExpand}
        onKeyDown={
          isFullscreen
            ? undefined
            : (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onExpand?.();
                }
              }
        }
        role={isFullscreen ? undefined : "button"}
        tabIndex={isFullscreen ? undefined : 0}
        aria-label={isFullscreen ? undefined : `Open ${data.name} full screen`}
      >
        <div
          ref={stageContainerRef}
          style={{
            width: displayWidth,
            height: displayHeight,
            cursor: isFullscreen ? (zoom > 1 ? "grab" : "default") : "zoom-in",
          }}
        />

        {/* Inline: an affordance that clicking opens the full-page view. */}
        {!isFullscreen && !error && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-border bg-background/90 p-1.5 shadow-sm backdrop-blur">
            <Maximize2 size={14} className="text-muted-foreground" />
          </div>
        )}

        {/* Fullscreen: zoom controls. */}
        {isFullscreen && !error && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-border bg-background/90 p-0.5 shadow-sm backdrop-blur">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={atMin}
              onClick={() => zoomTo(zoom - ZOOM_STEP)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              aria-label="Reset zoom"
              onClick={() => zoomTo(1)}
              className="w-12 text-center text-xs tabular-nums text-muted-foreground hover:text-foreground"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={atMax}
              onClick={() => zoomTo(zoom + ZOOM_STEP)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-xs text-red-500">
            Couldn't render this screen: {error}
          </div>
        )}
      </div>
    </div>
  );
}

/** Full-page overlay showing a single interface with zoom + pan. */
function FullscreenMockup({
  data,
  onClose,
}: {
  data: DesignInterfaceData;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${data.name} full screen`}
    >
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">
            {data.name}
          </h3>
          {data.purpose && (
            <p className="truncate text-xs text-white/60">{data.purpose}</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close full screen"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>
      <MockupStage data={data} mode="fullscreen" />
    </div>,
    document.body,
  );
}

function InterfaceFrame({ data }: { data: DesignInterfaceData }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{data.name}</h3>
        {data.purpose && (
          <span className="text-xs text-muted-foreground">{data.purpose}</span>
        )}
      </div>
      <MockupStage
        data={data}
        mode="inline"
        onExpand={() => setFullscreen(true)}
      />
      {data.notes && (
        <p className="mt-2 max-w-[900px] text-xs text-muted-foreground">
          {data.notes}
        </p>
      )}
      {fullscreen && (
        <FullscreenMockup data={data} onClose={() => setFullscreen(false)} />
      )}
    </div>
  );
}

function DesignBriefHeader({ brief }: { brief: DesignBriefData }) {
  const swatches: { label: string; color: string }[] = [
    { label: "Primary", color: brief.palette.primary },
    { label: "Secondary", color: brief.palette.secondary },
    { label: "Accent", color: brief.palette.accent },
    { label: "Background", color: brief.palette.background },
    { label: "Surface", color: brief.palette.surface },
    { label: "Text", color: brief.palette.text },
  ];

  return (
    <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Palette size={16} className="text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">
          {brief.appName}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {brief.designDirection}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {swatches.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-5 w-5 rounded border border-border"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-muted-foreground">
              {s.label}
              <span className="ml-1 font-mono uppercase">{s.color}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium">Typography:</span>{" "}
        {brief.typography.headingFont} / {brief.typography.bodyFont}
      </div>
    </div>
  );
}

export function DesignCanvas() {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [designState, setDesignState] = useAtom(designStateAtom);

  const brief = selectedChatId
    ? designState.briefByChatId.get(selectedChatId)
    : undefined;
  const pendingOptions = selectedChatId
    ? designState.pendingOptionsByChatId.get(selectedChatId)
    : undefined;

  const clearPendingOptions = useCallback(
    (chatId: number) => {
      setDesignState((prev) => {
        const next = new Map(prev.pendingOptionsByChatId);
        next.delete(chatId);
        return { ...prev, pendingOptionsByChatId: next };
      });
    },
    [setDesignState],
  );
  const interfaces = useMemo(() => {
    if (!selectedChatId) return [];
    const map = designState.interfacesByChatId.get(selectedChatId);
    return map ? Array.from(map.values()) : [];
  }, [designState, selectedChatId]);

  if (!brief && interfaces.length === 0 && !pendingOptions) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Palette size={32} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No designs yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Describe your app in the chat. Design mode will ask a few questions,
          agree on a visual system, and generate interface mockups here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="design-canvas">
      {pendingOptions && selectedChatId && (
        <DesignOptionsPicker
          key={pendingOptions.requestId}
          chatId={selectedChatId}
          data={pendingOptions}
          onResolved={clearPendingOptions}
        />
      )}
      {brief && <DesignBriefHeader brief={brief} />}
      {interfaces.map((data) => (
        <InterfaceFrame key={data.id} data={data} />
      ))}
    </div>
  );
}
