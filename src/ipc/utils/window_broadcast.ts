import type { WebContents } from "electron";
import {
  windowRegistry,
  type WindowEndpoint,
} from "@/window_infrastructure/main/window_registry";
import { safeSend } from "./safe_sender";

function isWindowEndpoint(value: unknown): value is WindowEndpoint {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isInteger((value as Partial<WindowEndpoint>).id) &&
    typeof (value as Partial<WindowEndpoint>).isDestroyed === "function" &&
    typeof (value as Partial<WindowEndpoint>).send === "function"
  );
}

/**
 * Send to every live window, for a producer that has no originating sender.
 *
 * Agent tools are the case this exists for: they run inside a chat turn, not an
 * IPC handler, so there is no `event.sender` to reply through — and the surface
 * that needs the message (the recorder bar) can be in any window. Lives here
 * because `window_infrastructure/main` is off-limits outside `src/ipc`,
 * `src/main` and `src/testing` (see `state_machines/boundaries.test.ts`).
 */
export function broadcastToAllWindows(channel: string, payload: unknown): void {
  sendToLiveEndpoints(channel, payload);
}

export function broadcastToRegisteredWindows(
  origin: WebContents | null | undefined,
  channel: string,
  payload: unknown,
): void {
  if (!isWindowEndpoint(origin)) {
    safeSend(origin, channel, payload);
    return;
  }
  windowRegistry.ensureRegistered(origin);
  sendToLiveEndpoints(channel, payload);
}

/**
 * The one place the fan-out is written: both exports above differ only in how
 * they decide to broadcast, not in how they do it. Keeping the destroyed/crashed
 * guard (`safeSend`) and the endpoint cast in a single place means a change to
 * the send semantics can't reach one caller and miss the other.
 */
function sendToLiveEndpoints(channel: string, payload: unknown): void {
  for (const endpoint of windowRegistry.liveEndpoints()) {
    safeSend(endpoint as WebContents, channel, payload);
  }
}
