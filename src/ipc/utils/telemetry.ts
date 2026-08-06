import { BrowserWindow } from "electron";
import log from "electron-log";
import {
  DyadError,
  isDyadErrorKindFilteredFromTelemetry,
} from "@/errors/dyad_error";
import { isGenericFetchFailedError } from "@/lib/posthogTelemetry";
import { TelemetryEventPayload } from "@/ipc/types";

const logger = log.scope("telemetry");
const FILTERED_EXCEPTION_MESSAGES = new Set([
  "Supabase access token not found. Please authenticate first.",
]);

/**
 * Sends a telemetry event from the main process to the renderer,
 * where PostHog can capture it.
 */
export function sendTelemetryEvent(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  try {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      sendTelemetryEventToWindow(windows[0], eventName, properties);
    }
  } catch (error) {
    logger.warn("Error sending telemetry event:", error);
  }
}

export function sendTelemetryEventToWindow(
  target: BrowserWindow,
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  try {
    target.webContents.send("telemetry:event", {
      eventName,
      properties,
    } satisfies TelemetryEventPayload);
  } catch (error) {
    logger.warn("Error sending telemetry event:", error);
  }
}

/**
 * Sends an exception from the main process to the renderer as a PostHog $exception event.
 */
export function sendTelemetryException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Unknown error"));

  if (shouldFilterTelemetryException(err)) {
    return;
  }

  sendTelemetryEvent("$exception", {
    exception_name: err.name,
    exception_message: err.message,
    exception_stack_trace: err.stack,
    ...context,
  });
}

export function shouldFilterTelemetryException(error: unknown): boolean {
  // Ahead of the kind check, which returns for every DyadError: this one is a
  // DyadError too. A non-2xx from a self-hosted Coolify is that instance
  // rejecting a request rather than a fault here, and its message carries
  // whatever that machine chose to say — which can name a host, a path or a
  // connection string. The user still sees it; nothing reports it.
  if (error instanceof Error && error.name === "CoolifyRequestError") {
    return true;
  }

  if (error instanceof DyadError) {
    return isDyadErrorKindFilteredFromTelemetry(error.kind);
  }

  if (
    error instanceof Error &&
    error.name === "RateLimitError" &&
    error.message.includes("(429)")
  ) {
    return true;
  }

  if (
    error instanceof Error &&
    isGenericFetchFailedError(error.name, error.message)
  ) {
    return true;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return FILTERED_EXCEPTION_MESSAGES.has(message);
}
