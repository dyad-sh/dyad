import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import * as fs from "fs";
import * as path from "path";
import { readSettings } from "../../main/settings";
import type { ClaudeCodeProviderSetting } from "../../lib/schemas";
import { getEnvVar } from "../utils/read_env";

const logger = log.scope("claude_code_handlers");
const handle = createLoggedHandler(logger);

export function registerClaudeCodeHandlers() {
  handle("check-claude-cli-exists", async (): Promise<boolean> => {
    const settings = readSettings();
    const claudeCodeSettings = settings?.providerSettings?.[
      "claude-code"
    ] as ClaudeCodeProviderSetting | undefined;

    // Helper function to expand ~ to home directory
    const expandHomeDir = (filePath: string): string => {
      if (filePath.startsWith("~/")) {
        const homeDir = process.env.HOME || process.env.USERPROFILE || "";
        return path.join(homeDir, filePath.slice(2));
      }
      return filePath;
    };

    // Determine path with same priority as get_model_client.ts
    // 1. User settings (claudeExecutablePath)
    // 2. Environment variable (CLAUDE_CODE_EXECUTABLE_PATH)
    // 3. Default path ($HOME/.local/bin/claude)
    const userExecutablePath = claudeCodeSettings?.claudeExecutablePath
      ? expandHomeDir(claudeCodeSettings.claudeExecutablePath)
      : undefined;
    const envExecutablePath = getEnvVar("CLAUDE_CODE_EXECUTABLE_PATH")
      ? expandHomeDir(getEnvVar("CLAUDE_CODE_EXECUTABLE_PATH")!)
      : undefined;
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const defaultClaudePath = homeDir
      ? path.join(homeDir, ".local", "bin", "claude")
      : "";

    const claudeExecutablePath =
      userExecutablePath || envExecutablePath || defaultClaudePath;

    if (!claudeExecutablePath) {
      logger.warn("No Claude CLI path configured");
      return false;
    }

    // Check if file exists and is executable
    try {
      await fs.promises.access(
        claudeExecutablePath,
        fs.constants.F_OK | fs.constants.X_OK,
      );
      logger.info(`Claude CLI found at: ${claudeExecutablePath}`);
      return true;
    } catch (error) {
      logger.warn(
        `Claude CLI not found or not executable at: ${claudeExecutablePath}`,
      );
      return false;
    }
  });
}
