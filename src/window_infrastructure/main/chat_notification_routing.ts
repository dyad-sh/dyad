import { BrowserWindow, type WebContents } from "electron";
import type { VisibleEntity, WindowSessionId } from "../types";
import type { WindowEndpoint, WindowRegistry } from "./window_registry";

export function chatNotificationTarget(
  windows: WindowRegistry,
  entity: VisibleEntity,
  enableMultiWindow: boolean,
): WindowSessionId | null {
  const showing = windows.findWindowsShowing(entity)[0];
  if (showing) return showing;
  if (entity.kind === "chat") {
    const owner = windows.findWindowsOwningChat(entity.id)[0];
    if (owner) return owner;
  }

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

export function deliverChatNavigationToExistingWindow(
  windows: WindowRegistry,
  windowSessionId: WindowSessionId,
  payload: { chatId: number; appId: number },
  resolveWindow: (endpoint: WindowEndpoint) => BrowserWindow | null = (
    endpoint,
  ) => BrowserWindow.fromWebContents(endpoint as WebContents),
): boolean {
  const endpoint = windows.endpointForSession(windowSessionId);
  if (!endpoint) return false;

  try {
    if (endpoint.isDestroyed()) {
      windows.unregister(endpoint.id);
      return false;
    }
    const targetWindow = resolveWindow(endpoint);
    if (!targetWindow) {
      windows.unregister(endpoint.id);
      return false;
    }
    revealWindow(targetWindow);
    endpoint.send("window:navigate-to-chat", payload);
    return true;
  } catch (error) {
    windows.unregister(endpoint.id);
    console.warn(
      "Failed to route chat navigation to an existing window",
      error,
    );
    return false;
  }
}
