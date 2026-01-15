import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { runShellCommand } from "../utils/runShellCommand";

const logger = log.scope("cairo_handlers");
const handle = createLoggedHandler(logger);

export interface CairoVersionResult {
  cairoVersion: string | null;
}

export function registerCairoHandlers() {
  /**
   * Check Cairo CLI version
   */
  handle("cairo-version", async (): Promise<CairoVersionResult> => {
    logger.info("IPC: cairo-version called");
    let cairoVersion: string | null = null;
    try {
      cairoVersion = await runShellCommand(`scarb --version`);
    } catch (err) {
      logger.error("Failed to get Cairo CLI version:", err);
    }
    return {
      cairoVersion,
    };
  });
}
