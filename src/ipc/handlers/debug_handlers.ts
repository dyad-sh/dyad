import { BrowserWindow, clipboard } from "electron";
import { platform, arch } from "os";
import { readSettings } from "../../main/settings";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { miscContracts, SESSION_DEBUG_SCHEMA_VERSION } from "../types/misc";
import type { SystemDebugInfo } from "../types/system";
import type { SessionDebugBundle } from "../types/misc";
import type { UserSettings } from "@/lib/schemas";
import type { AiMessagesJsonV6 } from "../../db/schema";

import log from "electron-log";
import path from "path";
import fs from "fs";
import { runShellCommand } from "../utils/runShellCommand";
import { extractCodebase } from "../../utils/codebase";
import { db } from "../../db";
import {
  chats,
  apps,
  language_model_providers,
  language_models,
  mcpServers,
} from "../../db/schema";
import { eq } from "drizzle-orm";
import { getConeyAppPath } from "../../paths/paths";
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

  // Get Coney version from package.json
  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  let coneyVersion = "unknown";
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    coneyVersion = packageJson.version;
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
    coneyVersion,
    platform: process.platform,
    architecture: arch(),
    logs,
  };
}

function serializeModelForDebug(model: {
  provider: string;
  name: string;
  customModelId?: number;
}): string {
  return `${model.provider}:${model.name} | customId: ${model.customModelId}`;
}

/**
 * Extracts non-sensitive settings for the debug bundle.
 * All Secret fields (API keys, OAuth tokens) are excluded.
 * Provider setup status is derived as boolean flags only.
 */
function sanitizeSettingsForDebug(settings: UserSettings) {
  // Build provider setup status: { providerName: hasApiKey }
  const providerSetupStatus: Record<string, boolean> = {};
  if (settings.providerSettings) {
    for (const [provider, providerSetting] of Object.entries(
      settings.providerSettings,
    )) {
      providerSetupStatus[provider] = !!providerSetting?.apiKey?.value;
    }
  }

  return {
    selectedModel: {
      name: settings.selectedModel.name,
      provider: settings.selectedModel.provider,
      customModelId: settings.selectedModel.customModelId,
    },
    selectedChatMode: settings.selectedChatMode ?? null,
    defaultChatMode: settings.defaultChatMode ?? null,
    autoApproveChanges: settings.autoApproveChanges ?? null,
    enableConeyPro: settings.enableConeyPro ?? null,
    thinkingBudget: settings.thinkingBudget ?? null,
    maxChatTurnsInContext: settings.maxChatTurnsInContext ?? null,
    enableAutoFixProblems: settings.enableAutoFixProblems ?? null,
    enableNativeGit: settings.enableNativeGit ?? null,
    enableAutoUpdate: settings.enableAutoUpdate,
    releaseChannel: settings.releaseChannel,
    runtimeMode2: settings.runtimeMode2 ?? null,
    zoomLevel: settings.zoomLevel ?? null,
    previewDeviceMode: settings.previewDeviceMode ?? null,
    enableProLazyEditsMode: settings.enableProLazyEditsMode ?? null,
    proLazyEditsMode: settings.proLazyEditsMode ?? null,
    enableProSmartFilesContextMode:
      settings.enableProSmartFilesContextMode ?? null,
    enableProWebSearch: settings.enableProWebSearch ?? null,
    proSmartContextOption: settings.proSmartContextOption ?? null,
    enableSupabaseWriteSqlMigration:
      settings.enableSupabaseWriteSqlMigration ?? null,
    agentToolConsents: settings.agentToolConsents ?? null,
    experiments: settings.experiments
      ? Object.fromEntries(
          Object.entries(settings.experiments).filter(
            ([, v]) => typeof v === "boolean",
          ),
        )
      : null,
    customNodePath: settings.customNodePath ?? null,
    providerSetupStatus,
  };
}

/**
 * Strips base64 image data from AI SDK messages JSON.
 * Replaces image content with "[stripped]" and adds _strippedByteLength metadata.
 * This keeps the bundle size manageable while preserving message structure.
 *
 * Works on the raw JSON representation to avoid tight coupling with AI SDK types.
 */
function stripImagesFromAiMessagesJson(json: AiMessagesJsonV6 | null): unknown {
  if (!json || !json.messages) return json;

  // Work on raw JSON to avoid AI SDK type constraints when modifying content
  const raw = JSON.parse(JSON.stringify(json));
  for (const msg of raw.messages) {
    if (!Array.isArray(msg.content)) continue;
    for (let i = 0; i < msg.content.length; i++) {
      const part = msg.content[i];
      if (
        part.type === "image" &&
        typeof part.image === "string" &&
        part.image.length > 200
      ) {
        msg.content[i] = {
          ...part,
          _strippedByteLength: part.image.length,
          image: "[stripped]",
        };
      } else if (
        part.type === "file" &&
        typeof part.data === "string" &&
        part.data.length > 200
      ) {
        msg.content[i] = {
          ...part,
          _strippedByteLength: part.data.length,
          data: "[stripped]",
        };
      }
    }
  }
  return raw;
}

/**
 * Reads application logs from the electron-log file.
 */
function readAppLogs(linesOfLogs: number, level: "warn" | "info"): string {
  try {
    const logPath = log.transports.file.getFile().path;
    if (!fs.existsSync(logPath)) return "";

    const logContent = fs.readFileSync(logPath, "utf8");
    const logLines = logContent.split("\n").filter((line) => {
      if (level === "info") return true;
      const logLevelRegex = /\[.*?\] \[(\w+)\]/;
      const match = line.match(logLevelRegex);
      if (!match) return true;
      const logLevel = match[1];
      if (level === "warn") {
        return logLevel === "warn" || logLevel === "error";
      }
      return true;
    });

    return logLines.slice(-linesOfLogs).join("\n");
  } catch (err) {
    console.error("Failed to read log file:", err);
    return `Error reading logs: ${err}`;
  }
}

export function registerDebugHandlers() {
  createTypedHandler(systemContracts.getSystemDebugInfo, async () => {
    console.log("IPC: get-system-debug-info called");
    return getSystemDebugInfo({
      linesOfLogs: 20,
      level: "warn",
    });
  });

  createTypedHandler(miscContracts.getSessionDebugBundle, async (_, chatId) => {
    console.log(`IPC: get-session-debug-bundle called for chat ${chatId}`);

    try {
      const settings = readSettings();

      // Get Coney version
      const packageJsonPath = path.resolve(
        __dirname,
        "..",
        "..",
        "package.json",
      );
      let coneyVersion = "unknown";
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8"),
        );
        coneyVersion = packageJson.version;
      } catch (err) {
        console.error("Failed to read package.json:", err);
      }

      // Get runtime info in parallel
      const [nodeVersion, pnpmVersion, nodePathResult] = await Promise.all([
        runShellCommand("node --version").catch(() => null),
        runShellCommand("pnpm --version").catch(() => null),
        (platform() === "win32"
          ? runShellCommand("where.exe node")
          : runShellCommand("which node")
        ).catch(() => null),
      ]);

      // Get chat with full messages from database
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

      // Get app data from database
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, chatRecord.appId),
      });

      if (!app) {
        throw new Error(`App with ID ${chatRecord.appId} not found`);
      }

      // Query custom providers, custom models, and MCP servers in parallel
      const [customProviders, customModels, mcpServerRecords, codebase] =
        await Promise.all([
          db.select().from(language_model_providers),
          db.select().from(language_models),
          db.select().from(mcpServers),
          extractCodebase({
            appPath: getConeyAppPath(app.path),
            chatContext: validateChatContext(app.chatContext),
          }).then((result) => result.formattedOutput),
        ]);

      // Read logs
      const logs = readAppLogs(1_000, "info");

      // Build the bundle
      const bundle: SessionDebugBundle = {
        schemaVersion: SESSION_DEBUG_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),

        system: {
          coneyVersion,
          platform: process.platform,
          architecture: arch(),
          nodeVersion,
          pnpmVersion,
          nodePath: nodePathResult,
          electronVersion: process.versions.electron ?? "unknown",
          telemetryId:
            settings.telemetryConsent === "opted_out"
              ? null
              : settings.telemetryUserId || "unknown",
        },

        settings: sanitizeSettingsForDebug(settings),

        app: {
          id: app.id,
          name: app.name,
          path: app.path,
          createdAt: app.createdAt.toISOString(),
          updatedAt: app.updatedAt.toISOString(),
          githubOrg: app.githubOrg,
          githubRepo: app.githubRepo,
          githubBranch: app.githubBranch,
          supabaseProjectId: app.supabaseProjectId,
          supabaseOrganizationSlug: app.supabaseOrganizationSlug,
          neonProjectId: app.neonProjectId,
          vercelProjectId: app.vercelProjectId,
          vercelProjectName: app.vercelProjectName,
          vercelDeploymentUrl: app.vercelDeploymentUrl,
          installCommand: app.installCommand,
          startCommand: app.startCommand,
          chatContext: app.chatContext ?? null,
          themeId: app.themeId,
        },

        chat: {
          id: chatRecord.id,
          appId: chatRecord.appId,
          title: chatRecord.title,
          initialCommitHash: chatRecord.initialCommitHash,
          createdAt: chatRecord.createdAt.toISOString(),
          messages: chatRecord.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
            aiMessagesJson: stripImagesFromAiMessagesJson(
              msg.aiMessagesJson ?? null,
            ),
            model: msg.model ?? null,
            totalTokens: msg.maxTokensUsed ?? null,
            approvalState: msg.approvalState ?? null,
            sourceCommitHash: msg.sourceCommitHash ?? null,
            commitHash: msg.commitHash ?? null,
            requestId: msg.requestId ?? null,
            usingFreeAgentModeQuota: msg.usingFreeAgentModeQuota ?? null,
          })),
        },

        providers: {
          customProviders: customProviders.map((p) => ({
            id: p.id,
            name: p.name,
            hasApiBaseUrl: !!p.api_base_url,
            envVarName: p.env_var_name,
          })),
          customModels: customModels.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            apiName: m.apiName,
            builtinProviderId: m.builtinProviderId,
            customProviderId: m.customProviderId,
            maxOutputTokens: m.max_output_tokens,
            contextWindow: m.context_window,
          })),
        },

        mcpServers: mcpServerRecords.map((s) => ({
          id: s.id,
          name: s.name,
          transport: s.transport,
          command: s.command,
          args: s.args,
          url: s.url,
          enabled: s.enabled,
          // envJson and headersJson intentionally excluded (may contain secrets)
        })),

        codebase,
        logs,
      };

      return bundle;
    } catch (error) {
      console.error(`Error in get-session-debug-bundle:`, error);
      throw error;
    }
  });

  console.log("Registered debug IPC handlers");

  createTypedHandler(systemContracts.takeScreenshot, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) throw new Error("No focused window to capture");

    // Capture the window's current contents as a NativeImage
    const image = await win.capturePage();
    // Validate image
    if (!image || image.isEmpty()) {
      throw new Error("Failed to capture screenshot");
    }
    // Write the image to the clipboard
    clipboard.writeImage(image);
  });
}
