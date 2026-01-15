import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { runShellCommand } from "../utils/runShellCommand";

const logger = log.scope("cosmwasm_handlers");
const handle = createLoggedHandler(logger);

export interface CosmwasmVersionResult {
  cosmwasmVersion: string | null;
}

export function registerCosmwasmHandlers() {
  /**
   * Check cosmwasm CLI version
   */
  handle("cosmwasm-version", async (): Promise<CosmwasmVersionResult> => {
    logger.info("IPC: cosmwasm-version called");
    let cosmwasmVersion: string | null = null;
    try {
      cosmwasmVersion = await runShellCommand(`wasmd version`);
    } catch (err) {
      logger.error("Failed to get cosmwasm CLI version:", err);
    }
    return {
      cosmwasmVersion,
    };
  });
}
