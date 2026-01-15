import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { runShellCommand } from "../utils/runShellCommand";

const logger = log.scope("vyper_handlers");
const handle = createLoggedHandler(logger);

export interface VyperVersionResult {
  vyperVersion: string | null;
}

export function registerVyperHandlers() {
  /**
   * Check Vyper CLI version
   */
  handle("vyper-version", async (): Promise<VyperVersionResult> => {
    logger.info("IPC: vyper-version called");
    let vyperVersion: string | null = null;
    try {
      vyperVersion = await runShellCommand(`vyper --version`);
    } catch (err) {
      logger.error("Failed to get Vyper CLI version:", err);
    }
    return {
      vyperVersion,
    };
  });
}
