/**
 * Desktop panel configuration: where it sits, how tall, and how it hides.
 *
 * The geometry is computed here rather than in CSS so the window area's
 * viewport can account for it — windows must never be laid out underneath the
 * panel and become unreachable.
 */

export type PanelEdge = "bottom" | "top" | "left" | "right";
export type PanelSize = "compact" | "comfortable";
export type PanelHide = "always-visible" | "auto-hide";

export type PanelConfig = {
  edge: PanelEdge;
  size: PanelSize;
  hide: PanelHide;
};

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  edge: "bottom",
  size: "comfortable",
  hide: "always-visible",
};

export const PANEL_THICKNESS: Record<PanelSize, number> = {
  compact: 40,
  comfortable: 52,
};

export function isVerticalPanel(edge: PanelEdge): boolean {
  return edge === "left" || edge === "right";
}

/**
 * Space the panel takes from the desktop. An auto-hiding panel reserves
 * nothing — windows use the full screen and the panel floats over them.
 */
export function panelReservedSpace(config: PanelConfig): number {
  return config.hide === "auto-hide" ? 0 : PANEL_THICKNESS[config.size];
}

/** The area left for windows once the panel has taken its space. */
export function desktopArea(
  screen: { width: number; height: number },
  config: PanelConfig,
): { width: number; height: number } {
  const reserved = panelReservedSpace(config);
  return isVerticalPanel(config.edge)
    ? { width: Math.max(0, screen.width - reserved), height: screen.height }
    : { width: screen.width, height: Math.max(0, screen.height - reserved) };
}

/** Whether a pointer position should reveal an auto-hidden panel. */
export function shouldRevealPanel(
  config: PanelConfig,
  pointer: { x: number; y: number },
  screen: { width: number; height: number },
  triggerPx = 4,
): boolean {
  if (config.hide !== "auto-hide") return false;
  switch (config.edge) {
    case "bottom":
      return pointer.y >= screen.height - triggerPx;
    case "top":
      return pointer.y <= triggerPx;
    case "left":
      return pointer.x <= triggerPx;
    case "right":
      return pointer.x >= screen.width - triggerPx;
  }
}
