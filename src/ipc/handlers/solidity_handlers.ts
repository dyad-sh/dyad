import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { runShellCommand } from "../utils/runShellCommand";

const logger = log.scope("solidity_handlers");
const handle = createLoggedHandler(logger);

export interface SolidityVersionResult {
  solcVersion: string | null;
}

export function registerSolidityHandlers() {
  /**
   * Check Solidity CLI version
   */
  handle("solidity-version", async (): Promise<SolidityVersionResult> => {
    logger.info("IPC: solidity-version called");
    let solcVersion: string | null = null;
    try {
      solcVersion = await runShellCommand(`solc --version`);
    } catch (err) {
      console.error("Failed to get solidity CLI version:", err);
    }
    return {
      solcVersion,
    };
  });
}
