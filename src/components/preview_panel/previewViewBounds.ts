import type { PreviewViewBounds } from "@/ipc/types";

export interface MeasuredRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reads the renderer's zoom factor.
 *
 * `getBoundingClientRect()` reports CSS pixels inside the zoomed frame, while
 * `WebContentsView.setBounds()` expects DIPs relative to the window's content
 * area. Multiplying by the zoom factor converts between the two.
 */
export function getRendererZoomFactor(): number {
  const electronApi = (
    window as Window & {
      electron?: { webFrame?: { getZoomFactor?: () => number } };
    }
  ).electron;

  const factor = electronApi?.webFrame?.getZoomFactor?.();
  return typeof factor === "number" && Number.isFinite(factor) && factor > 0
    ? factor
    : 1;
}

export function computePreviewViewBounds(
  rect: MeasuredRect,
  zoomFactor: number,
): PreviewViewBounds {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;

  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.max(0, Math.round(rect.width * zoom)),
    height: Math.max(0, Math.round(rect.height * zoom)),
  };
}

export function boundsEqual(
  a: PreviewViewBounds | null,
  b: PreviewViewBounds | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}
