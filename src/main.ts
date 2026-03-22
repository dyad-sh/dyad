import { app, BrowserWindow, dialog, Menu, session } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "./ipc/ipc_host";
import dotenv from "dotenv";
// @ts-ignore
import started from "electron-squirrel-startup";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import log from "electron-log";
import {
  getSettingsFilePath,
  readSettings,
  writeSettings,
} from "./main/settings";
import { handleSupabaseOAuthReturn } from "./supabase_admin/supabase_return_handler";
import { handleJoyProReturn } from "./main/pro";
import { IS_TEST_BUILD } from "./ipc/utils/test_utils";
import { BackupManager } from "./backup_manager";
import { getDatabasePath, initializeDatabase } from "./db";
import { loadVaultConfigFromDisk } from "./lib/local_vault_service";
import { UserSettings } from "./lib/schemas";
import { handleNeonOAuthReturn } from "./neon_admin/neon_return_handler";
import {
  AddMcpServerConfigSchema,
  AddMcpServerPayload,
  AddPromptDataSchema,
  AddPromptPayload,
} from "./ipc/deep_link_data";
import {
  startPerformanceMonitoring,
  stopPerformanceMonitoring,
} from "./utils/performance_monitor";
import { cleanupOldAiMessagesJson } from "./pro/main/ipc/handlers/local_agent/ai_messages_cleanup";
import { startTaskExecutor } from "./lib/kanban_task_executor";
import { ensureOllamaCredentialInN8n } from "./ipc/handlers/n8n_handlers";
import { getOpenClawGateway } from "./lib/openclaw_gateway_service";
import { startAllServices } from "./ipc/handlers/services_handlers";
import { consolidateAgentMemories } from "./lib/agent_memory_engine";
import {
  startFlywheelScheduler,
  stopFlywheelScheduler,
} from "./lib/data_flywheel";
import { getTailscaleConfig, getTailscaleStatus } from "./lib/tailscale_service";
import fs from "fs";

log.errorHandler.startCatching();
log.eventLogger.startLogging();
log.scope.labelPadding = false;

const logger = log.scope("main");

// Load environment variables from .env file (explicit path for Electron CWD robustness)
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config(); // also try CWD-based .env as secondary source

// Register IPC handlers before app is ready
registerIpcHandlers();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Decide the git directory depending on environment
function resolveLocalGitDirectory() {
  if (!app.isPackaged) {
    // Dev: app.getAppPath() is the project root
    return path.join(app.getAppPath(), "node_modules/dugite/git");
  }

  // Packaged app: git is bundled via extraResource
  return path.join(process.resourcesPath, "git");
}

const gitDir = resolveLocalGitDirectory();
if (fs.existsSync(gitDir)) {
  process.env.LOCAL_GIT_DIRECTORY = gitDir;
}

// https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app#main-process-mainjs
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("joycreate", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("joycreate");
}

export async function onReady() {
  try {
    const backupManager = new BackupManager({
      settingsFile: getSettingsFilePath(),
      dbFile: getDatabasePath(),
    });
    await backupManager.initialize();
  } catch (e) {
    logger.error("Error initializing backup manager", e);
  }
  initializeDatabase();

  // Restore vault config from disk (if vault was previously initialized)
  loadVaultConfigFromDisk();

  // Cleanup old ai_messages_json entries to prevent database bloat
  cleanupOldAiMessagesJson();

  const settings = readSettings();

  // Check if app was force-closed
  if (settings.isRunning) {
    logger.warn("App was force-closed on previous run");

    // Store performance data to send after window is created
    if (settings.lastKnownPerformance) {
      logger.warn("Last known performance:", settings.lastKnownPerformance);
      pendingForceCloseData = settings.lastKnownPerformance;
    }
  }

  // Set isRunning to true at startup
  writeSettings({ isRunning: true });

  // Start performance monitoring
  startPerformanceMonitoring();

  await onFirstRunMaybe(settings);
  createWindow();

  // ── Auto-start autonomous services after window is created ──
  // Delay to let external services (n8n, Ollama) finish booting
  setTimeout(async () => {
    const svcLogger = log.scope("services-init");

    // 1. Start all backend services (n8n, Celestia, Ollama)
    try {
      const results = await startAllServices();
      for (const svc of results) {
        svcLogger.info(`${svc.name}: ${svc.running ? "running" : svc.error || "not started"}`);
      }
    } catch (err) {
      svcLogger.warn("Backend services auto-start failed:", err);
    }

    // 2. Start the autonomous task executor
    try {
      startTaskExecutor();
      svcLogger.info("Task executor auto-started");
    } catch (err) {
      svcLogger.warn("Task executor auto-start failed:", err);
    }

    // 3. Initialize OpenClaw gateway with persistent watchdog
    const ensureOpenClaw = async () => {
      const gw = getOpenClawGateway();
      const state = gw.getGatewayState();
      if (state.status === "connected") return;
      try {
        await gw.initialize();
        svcLogger.info("OpenClaw gateway initialized");
      } catch (err) {
        svcLogger.warn("OpenClaw gateway init failed, watchdog will retry:", err);
      }
    };
    await ensureOpenClaw();

    // Watchdog: check every 30s and re-init if not connected
    const openClawWatchdog = setInterval(() => {
      ensureOpenClaw().catch(() => {});
    }, 30_000);
    app.on("will-quit", () => clearInterval(openClawWatchdog));

    // 3. Auto-provision Ollama credential in n8n (best-effort)
    try {
      const result = await ensureOllamaCredentialInN8n();
      if (result.success) {
        svcLogger.info(
          result.created
            ? `Ollama credential created in n8n: ${result.credentialId}`
            : `Ollama credential already exists: ${result.credentialId}`,
        );
      } else {
        svcLogger.warn("n8n Ollama credential skipped:", result.error);
      }
    } catch (err) {
      svcLogger.warn("n8n Ollama credential provision failed:", err);
    }

    // 4. Start periodic memory consolidation (every 30 minutes)
    const memoryConsolidationInterval = setInterval(() => {
      consolidateAgentMemories().catch((err) =>
        svcLogger.warn("Memory consolidation failed:", err),
      );
    }, 30 * 60 * 1000);

    app.on("will-quit", () => {
      clearInterval(memoryConsolidationInterval);
      stopFlywheelScheduler();
    });
    svcLogger.info("Memory consolidation scheduler started (30 min interval)");

    // 5. Start flywheel training scheduler (checks every 6 hours)
    startFlywheelScheduler();
  }, 8000);

  logger.info("Auto-update enabled=", settings.enableAutoUpdate);
  if (settings.enableAutoUpdate) {
    // Technically we could just pass the releaseChannel directly to the host,
    // but this is more explicit and falls back to stable if there's an unknown
    // release channel.
    const postfix = settings.releaseChannel === "beta" ? "beta" : "stable";
    const host = `https://api.joycreate.app/v1/update/${postfix}`;
    logger.info("Auto-update release channel=", postfix);
    updateElectronApp({
      logger,
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "DisciplesofLove/JoyCreate",
        host,
      },
    }); // additional configuration options available
  }
}

export async function onFirstRunMaybe(settings: UserSettings) {
  if (!settings.hasRunBefore) {
    await promptMoveToApplicationsFolder();
    writeSettings({
      hasRunBefore: true,
    });
  }
  if (IS_TEST_BUILD) {
    writeSettings({
      isTestMode: true,
    });
  }
}

/**
 * Ask the user if the app should be moved to the
 * applications folder.
 */
async function promptMoveToApplicationsFolder(): Promise<void> {
  // Why not in e2e tests?
  // There's no way to stub this dialog in time, so we just skip it
  // in e2e testing mode.
  if (IS_TEST_BUILD) return;
  if (process.platform !== "darwin") return;
  if (app.isInApplicationsFolder()) return;
  logger.log("Prompting user to move to applications folder");

  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Move to Applications Folder", "Do Not Move"],
    defaultId: 0,
    message: "Move to Applications Folder? (required for auto-update)",
  });

  if (response === 0) {
    logger.log("User chose to move to applications folder");
    app.moveToApplicationsFolder();
  } else {
    logger.log("User chose not to move to applications folder");
  }
}

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
}

let mainWindow: BrowserWindow | null = null;
let pendingForceCloseData: any = null;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: process.env.NODE_ENV === "development" ? 1280 : 960,
    minWidth: 800,
    height: 700,
    minHeight: 500,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    trafficLightPosition: {
      x: 10,
      y: 8,
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      webSecurity: true,
      // transparent: true,
    },
    // backgroundColor: "#00000001",
    // frame: false,
  });
  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "../renderer/main_window/index.html"),
    );
  }

  // Dynamically extend CSP to allow Tailscale IP if configured
  setupTailscaleCsp();

  // Send force-close event if it was detected
  if (pendingForceCloseData) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("force-close-detected", {
        performanceData: pendingForceCloseData,
      });
      pendingForceCloseData = null;
    });
  }

  // Enable native context menu on right-click
  mainWindow.webContents.on("context-menu", (event, params) => {
    // Prevent any default behavior and show our own menu
    event.preventDefault();

    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
      );
      if (params.misspelledWord) {
        const suggestions: Electron.MenuItemConstructorOptions[] =
          params.dictionarySuggestions.slice(0, 5).map((suggestion) => ({
            label: suggestion,
            click: () => {
              try {
                mainWindow?.webContents.replaceMisspelling(suggestion);
              } catch (error) {
                logger.error("Failed to replace misspelling:", error);
              }
            },
          }));
        template.push(
          { type: "separator" },
          {
            type: "submenu",
            label: `Correct "${params.misspelledWord}"`,
            submenu: suggestions,
          },
        );
      }
      template.push({ type: "separator" }, { role: "selectAll" });
    } else {
      if (params.selectionText && params.selectionText.length > 0) {
        template.push({ role: "copy" });
      }
      template.push({ role: "selectAll" });
    }

    if (process.env.NODE_ENV === "development") {
      template.push(
        { type: "separator" },
        {
          label: "Inspect Element",
          click: () =>
            mainWindow?.webContents.inspectElement(params.x, params.y),
        },
      );
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow! });
  });
};

/**
 * Dynamically extend Content-Security-Policy to include the Tailscale IP.
 * This intercepts HTTP responses and patches the CSP header so the renderer
 * can reach services on the tailnet without editing the static meta tag.
 */
function setupTailscaleCsp(): void {
  const tsConfig = getTailscaleConfig();
  if (!tsConfig.enabled || !tsConfig.exposeServices) return;

  getTailscaleStatus()
    .then((status) => {
      const ip = tsConfig.manualIp || status.tailnetIp;
      if (!ip) return;

      session.defaultSession.webRequest.onHeadersReceived(
        (details, callback) => {
          const csp =
            details.responseHeaders?.["Content-Security-Policy"]?.[0] ||
            details.responseHeaders?.["content-security-policy"]?.[0];

          if (csp && !csp.includes(ip)) {
            const tailscaleDirective = `http://${ip}:* ws://${ip}:*`;
            const patched = csp.replace(
              /connect-src\s+/,
              `connect-src ${tailscaleDirective} `,
            );
            const headerKey = details.responseHeaders?.[
              "Content-Security-Policy"
            ]
              ? "Content-Security-Policy"
              : "content-security-policy";
            callback({
              responseHeaders: {
                ...details.responseHeaders,
                [headerKey]: [patched],
              },
            });
          } else {
            callback({ cancel: false });
          }
        },
      );
      log.scope("tailscale").info(`CSP extended for Tailscale IP ${ip}`);
    })
    .catch(() => {
      // Tailscale not available — no-op
    });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // the commandLine is array of strings in which last element is deep link url
    handleDeepLinkReturn(commandLine.pop()!);
  });
  app.whenReady().then(onReady);
}

// Handle the protocol. In this case, we choose to show an Error Box.
app.on("open-url", (event, url) => {
  handleDeepLinkReturn(url);
});

async function handleDeepLinkReturn(url: string) {
  // example url: "joycreate://supabase-oauth-return?token=a&refreshToken=b"
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.info("Invalid deep link URL", url);
    return;
  }

  // Intentionally do NOT log the full URL which may contain sensitive tokens.
  log.log(
    "Handling deep link: protocol",
    parsed.protocol,
    "hostname",
    parsed.hostname,
  );
  if (parsed.protocol !== "joycreate:") {
    dialog.showErrorBox(
      "Invalid Protocol",
      `Expected joycreate://, got ${parsed.protocol}. Full URL: ${url}`,
    );
    return;
  }
  if (parsed.hostname === "neon-oauth-return") {
    const token = parsed.searchParams.get("token");
    const refreshToken = parsed.searchParams.get("refreshToken");
    const expiresIn = Number(parsed.searchParams.get("expiresIn"));
    if (!token || !refreshToken || !expiresIn) {
      dialog.showErrorBox(
        "Invalid URL",
        "Expected token, refreshToken, and expiresIn",
      );
      return;
    }
    handleNeonOAuthReturn({ token, refreshToken, expiresIn });
    // Send message to renderer to trigger re-render
    mainWindow?.webContents.send("deep-link-received", {
      type: parsed.hostname,
    });
    return;
  }
  if (parsed.hostname === "supabase-oauth-return") {
    const token = parsed.searchParams.get("token");
    const refreshToken = parsed.searchParams.get("refreshToken");
    const expiresIn = Number(parsed.searchParams.get("expiresIn"));
    if (!token || !refreshToken || !expiresIn) {
      dialog.showErrorBox(
        "Invalid URL",
        "Expected token, refreshToken, and expiresIn",
      );
      return;
    }
    await handleSupabaseOAuthReturn({ token, refreshToken, expiresIn });
    // Send message to renderer to trigger re-render
    mainWindow?.webContents.send("deep-link-received", {
      type: parsed.hostname,
    });
    return;
  }
  // joycreate://joycreate-pro-return?key=123&budget_reset_at=2025-05-26T16:31:13.492000Z&max_budget=100
  if (parsed.hostname === "joy-pro-return") {
    const apiKey = parsed.searchParams.get("key");
    if (!apiKey) {
      dialog.showErrorBox("Invalid URL", "Expected key");
      return;
    }
    handleJoyProReturn({
      apiKey,
    });
    // Send message to renderer to trigger re-render
    mainWindow?.webContents.send("deep-link-received", {
      type: parsed.hostname,
    });
    return;
  }
  // joycreate://add-mcp-server?name=Chrome%20DevTools&config=eyJjb21tYW5kIjpudWxsLCJ0eXBlIjoic3RkaW8ifQ%3D%3D
  if (parsed.hostname === "add-mcp-server") {
    const name = parsed.searchParams.get("name");
    const config = parsed.searchParams.get("config");
    if (!name || !config) {
      dialog.showErrorBox("Invalid URL", "Expected name and config");
      return;
    }

    try {
      const decodedConfigJson = atob(config);
      const decodedConfig = JSON.parse(decodedConfigJson);
      const parsedConfig = AddMcpServerConfigSchema.parse(decodedConfig);

      mainWindow?.webContents.send("deep-link-received", {
        type: parsed.hostname,
        payload: {
          name,
          config: parsedConfig,
        } as AddMcpServerPayload,
      });
    } catch (error) {
      logger.error("Failed to parse add-mcp-server deep link:", error);
      dialog.showErrorBox(
        "Invalid MCP Server Configuration",
        "The deep link contains malformed configuration data. Please check the URL and try again.",
      );
    }
    return;
  }
  // joycreate://add-prompt?data=<base64-encoded-json>
  if (parsed.hostname === "add-prompt") {
    const data = parsed.searchParams.get("data");
    if (!data) {
      dialog.showErrorBox("Invalid URL", "Expected data parameter");
      return;
    }

    try {
      const decodedJson = atob(data);
      const decoded = JSON.parse(decodedJson);
      const parsedData = AddPromptDataSchema.parse(decoded);

      mainWindow?.webContents.send("deep-link-received", {
        type: parsed.hostname,
        payload: parsedData as AddPromptPayload,
      });
    } catch (error) {
      logger.error("Failed to parse add-prompt deep link:", error);
      dialog.showErrorBox(
        "Invalid Prompt Data",
        "The deep link contains malformed data. Please check the URL and try again.",
      );
    }
    return;
  }
  dialog.showErrorBox("Invalid deep link URL", url);
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Only set isRunning to false when the app is properly quit by the user
app.on("will-quit", () => {
  logger.info("App is quitting, setting isRunning to false");

  // Stop performance monitoring and capture final metrics
  stopPerformanceMonitoring();

  writeSettings({ isRunning: false });
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
