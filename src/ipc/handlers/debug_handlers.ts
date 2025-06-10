import { ipcMain } from "electron";
import { platform, arch } from "os";
import { SystemDebugInfo, ChatLogsData } from "../ipc_types";
import { readSettings } from "../../main/settings";

import log from "electron-log";
import path from "path";
import fs from "fs";
import { runShellCommand } from "../utils/runShellCommand";
import { extractCodebase } from "../../utils/codebase";
import { db } from "../../db";
import { chats, apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import { LargeLanguageModel } from "@/lib/schemas";
import { validateChatContext } from "../utils/context_paths_utils";

// Shared function to get system debug info
async function getSystemDebugInfo({
  linesOfLogs,
  level,
}: {
  linesOfLogs: number;
  level: "warn" | "info";
}): Promise<SystemDebugInfo> {
  console.log("Getting system debug info");

  // Get Node.js and pnpm versions
  let nodeVersion: string | null = null;
  let pnpmVersion: string | null = null;
  let nodePath: string | null = null;
  try {
    nodeVersion = await runShellCommand("node --version");
  } catch (err) {
    console.error("Failed to get Node.js version:", err);
  }

  try {
    pnpmVersion = await runShellCommand("pnpm --version");
  } catch (err) {
    console.error("Failed to get pnpm version:", err);
  }

  try {
    if (platform() === "win32") {
      nodePath = await runShellCommand("where.exe node");
    } else {
      nodePath = await runShellCommand("which node");
    }
  } catch (err) {
    console.error("Failed to get node path:", err);
  }

  // Get Dyad version from package.json
  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  let dyadVersion = "unknown";
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    dyadVersion = packageJson.version;
  } catch (err) {
    console.error("Failed to read package.json:", err);
  }

  // Get telemetry info from settings
  const settings = readSettings();
  const telemetryId = settings.telemetryUserId || "unknown";

  // Get logs from electron-log
  let logs = "";
  try {
    const logPath = log.transports.file.getFile().path;
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, "utf8");

      const logLines = logContent.split("\n").filter((line) => {
        if (level === "info") {
          return true;
        }
        // Example line:
        // [2025-06-09 13:55:05.209] [debug] (runShellCommand) Command "which node" succeeded with code 0: /usr/local/bin/node
        const logLevelRegex = /\[.*?\] \[(\w+)\]/;
        const match = line.match(logLevelRegex);
        if (!match) {
          // Include non-matching lines (like stack traces) when filtering for warnings
          return true;
        }
        const logLevel = match[1];
        if (level === "warn") {
          return logLevel === "warn" || logLevel === "error";
        }
        return true;
      });

      logs = logLines.slice(-linesOfLogs).join("\n");
    }
  } catch (err) {
    console.error("Failed to read log file:", err);
    logs = `Error reading logs: ${err}`;
  }

  return {
    nodeVersion,
    pnpmVersion,
    nodePath,
    telemetryId,
    selectedLanguageModel:
      serializeModelForDebug(settings.selectedModel) || "unknown",
    telemetryConsent: settings.telemetryConsent || "unknown",
    telemetryUrl: "https://us.i.posthog.com", // Hardcoded from renderer.tsx
    dyadVersion,
    platform: process.platform,
    architecture: arch(),
    logs,
  };
}

export function registerDebugHandlers() {
  ipcMain.handle(
    "get-system-debug-info",
    async (): Promise<SystemDebugInfo> => {
      console.log("IPC: get-system-debug-info called");
      return getSystemDebugInfo({
        linesOfLogs: 20,
        level: "warn",
      });
    },
  );

  ipcMain.handle(
    "get-chat-logs",
    async (_, chatId: number): Promise<ChatLogsData> => {
      console.log(`IPC: get-chat-logs called for chat ${chatId}`);

      try {
        // We can retrieve a lot more lines here because we're not limited by the
        // GitHub issue URL length limit.
        const debugInfo = await getSystemDebugInfo({
          linesOfLogs: 1_000,
          level: "info",
        });

        // Get chat data from database
        const chatRecord = await db.query.chats.findFirst({
          where: eq(chats.id, chatId),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            },
          },
        });

        if (!chatRecord) {
          throw new Error(`Chat with ID ${chatId} not found`);
        }

        // Format the chat to match the Chat interface
        const chat = {
          id: chatRecord.id,
          title: chatRecord.title || "Untitled Chat",
          messages: chatRecord.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            approvalState: msg.approvalState,
          })),
        };

        // Get app data from database
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, chatRecord.appId),
        });

        if (!app) {
          throw new Error(`App with ID ${chatRecord.appId} not found`);
        }

        // Extract codebase
        const appPath = getDyadAppPath(app.path);
        const codebase = (
          await extractCodebase({
            appPath,
            chatContext: validateChatContext(app.chatContext),
          })
        ).formattedOutput;

        return {
          debugInfo,
          chat,
          codebase,
        };
      } catch (error) {
        console.error(`Error in get-chat-logs:`, error);
        throw error;
      }
    },
  );

  console.log("Registered debug IPC handlers");
}

function serializeModelForDebug(model: LargeLanguageModel): string {
  return `${model.provider}:${model.name} | customId: ${model.customModelId}`;
}
