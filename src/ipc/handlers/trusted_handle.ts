import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedRenderer } from "../utils/renderer_security";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => Promise<any> | any;

type TrustFailureHandler = (
  error: unknown,
  event: IpcMainInvokeEvent,
  ...args: any[]
) => Promise<any> | any;

type TrustedIpcHandlerOptions = {
  onTrustFailure?: TrustFailureHandler;
};

/**
 * Registers an invoke handler that can only be called by the trusted Dyad
 * renderer. This is the sole production entry point for `ipcMain.handle` so
 * new and legacy handlers cannot accidentally omit the renderer trust guard.
 *
 * `onTrustFailure` lets envelope-based handlers preserve their wire format.
 * Raw handlers should omit it so Electron rejects the invoke as before.
 */
export function registerTrustedIpcHandler(
  channel: string,
  handler: IpcHandler,
  options: TrustedIpcHandlerOptions = {},
): void {
  // Optional chaining: ipcMain is undefined in some unit-test environments.
  ipcMain?.handle(channel, async (event, ...args) => {
    try {
      assertTrustedRenderer(event);
    } catch (error) {
      if (options.onTrustFailure) {
        return options.onTrustFailure(error, event, ...args);
      }
      throw error;
    }
    return handler(event, ...args);
  });
}
