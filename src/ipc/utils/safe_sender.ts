import log from "electron-log";

export interface SafeSender {
  isDestroyed(): boolean;
  isCrashed?(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

/**
 * Sends an IPC message to the renderer only if the provided `WebContents` is
 * still alive. This prevents `Object has been destroyed` errors that can occur
 * when asynchronous callbacks attempt to communicate after the window has
 * already been closed (e.g. during e2e test teardown).
 */
export function safeSend(
  sender: SafeSender | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!sender) return;
  if (sender.isDestroyed()) return;
  if (typeof sender.isCrashed === "function" && sender.isCrashed()) return;

  try {
    sender.send(channel, ...args);
  } catch (error) {
    log.debug(
      `safeSend: failed to send on channel "${channel}" because: ${(error as Error).message}`,
    );
  }
}
