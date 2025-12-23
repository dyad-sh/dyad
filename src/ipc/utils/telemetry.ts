import { BrowserWindow } from "electron";
import log from "electron-log";
import { TelemetryEventPayload } from "../ipc_types";

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
