import { BrowserWindow } from "electron";
import log from "electron-log";

const logger = log.scope("telemetry");

export interface TelemetryEventPayload {
  eventName: string;
  properties?: Record<string, unknown>;
}

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
