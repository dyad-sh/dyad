import type { WebContents } from "electron";
import log from "electron-log";

// In web mode this is set by the server to broadcast via WebSocket
let _webBroadcast: ((channel: string, payload: unknown) => void) | null = null;

/**
 * Called once by the Express server to enable WebSocket push events in web mode.
 * When set, safeSend(null, ...) routes through this broadcaster instead of Electron IPC.
 */
export function setWebBroadcaster(
  fn: (channel: string, payload: unknown) => void,
): void {
  _webBroadcast = fn;
}

/**
 * Sends an IPC message to the renderer only if the provided `WebContents` is
 * still alive. This prevents `Object has been destroyed` errors that can occur
 * when asynchronous callbacks attempt to communicate after the window has
 * already been closed (e.g. during e2e test teardown).
 *
 * In web mode, pass `null` as the sender — the message is broadcast via WebSocket.
 */
export function safeSend(
  sender: WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  // Web mode: broadcast via WebSocket
  if (!sender && _webBroadcast) {
    _webBroadcast(channel, args[0] ?? null);
    return;
  }

  if (!sender) return;
  if (sender.isDestroyed()) return;
  // @ts-ignore – `isCrashed` exists at runtime but is not in the type defs
  if (typeof sender.isCrashed === "function" && sender.isCrashed()) return;

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – allow variadic args beyond `data`
    sender.send(channel, ...args);
  } catch (error) {
    log.debug(
      `safeSend: failed to send on channel "${channel}" because: ${(error as Error).message}`,
    );
  }
}
