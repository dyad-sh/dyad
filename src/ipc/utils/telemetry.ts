import { BrowserWindow } from "electron";
import log from "electron-log";
import { TelemetryEventPayload } from "@/ipc/types";

const logger = log.scope("telemetry");

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
      windows[0].webContents.send("telemetry:event", {
        eventName,
        properties,
      } satisfies TelemetryEventPayload);
    }
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
  sendTelemetryEvent("$exception", {
    exception_name: err.name,
    exception_message: err.message,
    exception_stack_trace: err.stack,
    ...context,
  });
}
