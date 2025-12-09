import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { runShellCommand } from "../utils/runShellCommand";

const logger = log.scope("aptos_handlers");
const handle = createLoggedHandler(logger);

export interface AptosVersionResult {
  aptosMoveVersion: string | null;
}

export function registerAptosHandlers() {
  /**
   * Check Aptos Move CLI version
   */
  handle("aptos-version", async (): Promise<AptosVersionResult> => {
    logger.info("IPC: aptos-version called");
    let aptosMoveVersion: string | null = null;
    try {
      aptosMoveVersion = await runShellCommand(`aptos move --version`);
    } catch (err) {
      console.error("Failed to get Aptos Move CLI version:", err);
    }
    return {
      aptosMoveVersion,
    };
  });
}
