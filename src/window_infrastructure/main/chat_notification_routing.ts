import type { BrowserWindow } from "electron";
import type { VisibleEntity, WindowSessionId } from "../types";
import type { WindowRegistry } from "./window_registry";

export function chatNotificationTarget(
  windows: WindowRegistry,
  entity: VisibleEntity,
  enableMultiWindow: boolean,
): WindowSessionId | null {
  const showing = windows.findWindowsShowing(entity)[0];
  if (showing) return showing;

  const endpoints = windows.liveEndpoints();
  if (enableMultiWindow && endpoints.length !== 1) return null;
  return (
    windows.routePresentation({ effect: "ordinary", entity }) ??
    (endpoints[0]
      ? (windows.sessionForWebContents(endpoints[0].id) ?? null)
      : null)
  );
}

export function revealWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
