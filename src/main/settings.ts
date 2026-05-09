import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "../paths/paths";
import {
  StoredUserSettingsSchema,
  UserSettingsSchema,
  type UserSettings,
  Secret,
  VertexProviderSetting,
  migrateStoredSettings,
} from "../lib/schemas";
import {
  BrowserWindow,
  safeStorage,
  type WebContents,
  type BrowserWindow as BrowserWindowInstance,
} from "electron";
import { v4 as uuidv4 } from "uuid";
import log from "electron-log";
import { DEFAULT_TEMPLATE_ID } from "@/shared/templates";
import { DEFAULT_THEME_ID } from "@/shared/themes";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import {
  getRemoteDesktopConfig,
  type RemoteDesktopConfig,
} from "@/ipc/shared/remote_desktop_config";

const logger = log.scope("settings");

// IF YOU NEED TO UPDATE THIS, YOU'RE PROBABLY DOING SOMETHING WRONG!
// Need to maintain backwards compatibility!
const DEFAULT_SETTINGS: UserSettings = {
  selectedModel: {
    name: "auto",
    provider: "auto",
  },
  providerSettings: {},
  telemetryConsent: "unset",
  telemetryUserId: uuidv4(),
  hasRunBefore: false,
  experiments: {},
  enableProLazyEditsMode: true,
  enableProSmartFilesContextMode: true,
  selectedChatMode: "build",
  enableAutoFixProblems: false,
  enableAutoUpdate: true,
  releaseChannel: "stable",
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  selectedThemeId: DEFAULT_THEME_ID,
  isRunning: false,
  lastKnownPerformance: undefined,
  // Enabled by default in 0.33.0-beta.1
  enableNativeGit: true,
  autoExpandPreviewPanel: true,
  enableContextCompaction: true,
  previewIdleTimeoutPolicy: "default",
};

const CRASH_SENTINEL_FILE = "session.lock";
const SETTINGS_FILE = "user-settings.json";
const RESTORE_SETTINGS_DOCS_URL =
  "https://www.dyad.sh/docs/guides/migrate-restore#restoring-settings-from-backup";
interface RendererErrorToast {
  message: string;
  action?: {
    label: string;
    url: string;
  };
}

const pendingRendererErrors: RendererErrorToast[] = [];
const rendererErrorToastReadyWebContents = new WeakSet<WebContents>();

export function getSettingsFilePath(): string {
  return path.join(getUserDataPath(), SETTINGS_FILE);
}

function getCrashSentinelPath(): string {
  return path.join(getUserDataPath(), CRASH_SENTINEL_FILE);
}

export function writeCrashSentinel(): void {
  try {
    fs.writeFileSync(getCrashSentinelPath(), String(Date.now()));
  } catch (error) {
    logger.error("Error writing crash sentinel:", error);
  }
}

export function clearCrashSentinel(): void {
  try {
    fs.unlinkSync(getCrashSentinelPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("Error clearing crash sentinel:", error);
    }
  }
}

export function crashSentinelExists(): boolean {
  return fs.existsSync(getCrashSentinelPath());
}

export function readSettings(): UserSettings {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
    return readExistingSettingsFile(filePath);
  } catch (error) {
    logger.error("Error reading settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export function resolveEffectiveSettings(
  settings: UserSettings,
  remoteConfig: RemoteDesktopConfig | null,
): UserSettings {
  if (typeof settings.blockUnsafeNpmPackages === "boolean") {
    return settings;
  }

  return {
    ...settings,
    blockUnsafeNpmPackages:
      remoteConfig?.defaults?.blockUnsafeNpmPackages ?? true,
  };
}

export async function readEffectiveSettings(): Promise<UserSettings> {
  const settings = readSettings();
  const remoteConfig = await getRemoteDesktopConfig();
  return resolveEffectiveSettings(settings, remoteConfig);
}

export function writeSettings(settings: Partial<UserSettings>): void {
  try {
    const filePath = getSettingsFilePath();
    const settingsForWrite = readSettingsForWrite(filePath);
    const newSettings = { ...settingsForWrite.settings, ...settings };
    if (newSettings.githubAccessToken) {
      newSettings.githubAccessToken = encrypt(
        newSettings.githubAccessToken.value,
      );
    }
    if (newSettings.vercelAccessToken) {
      newSettings.vercelAccessToken = encrypt(
        newSettings.vercelAccessToken.value,
      );
    }
    if (newSettings.supabase) {
      // Encrypt legacy tokens (kept for backwards compat)
      if (newSettings.supabase.accessToken) {
        newSettings.supabase.accessToken = encrypt(
          newSettings.supabase.accessToken.value,
        );
      }
      if (newSettings.supabase.refreshToken) {
        newSettings.supabase.refreshToken = encrypt(
          newSettings.supabase.refreshToken.value,
        );
      }
      // Encrypt tokens for each organization in the organizations map
      if (newSettings.supabase.organizations) {
        for (const orgId in newSettings.supabase.organizations) {
          const org = newSettings.supabase.organizations[orgId];
          if (org.accessToken) {
            org.accessToken = encrypt(org.accessToken.value);
          }
          if (org.refreshToken) {
            org.refreshToken = encrypt(org.refreshToken.value);
          }
        }
      }
    }
    if (newSettings.neon) {
      if (newSettings.neon.accessToken) {
        newSettings.neon.accessToken = encrypt(
          newSettings.neon.accessToken.value,
        );
      }
      if (newSettings.neon.refreshToken) {
        newSettings.neon.refreshToken = encrypt(
          newSettings.neon.refreshToken.value,
        );
      }
    }
    for (const provider in newSettings.providerSettings) {
      if (newSettings.providerSettings[provider].apiKey) {
        newSettings.providerSettings[provider].apiKey = encrypt(
          newSettings.providerSettings[provider].apiKey.value,
        );
      }
      // Encrypt Vertex service account key if present
      const v = newSettings.providerSettings[provider] as VertexProviderSetting;
      if (provider === "vertex" && v?.serviceAccountKey) {
        v.serviceAccountKey = encrypt(v.serviceAccountKey.value);
      }
    }
    // Use StoredUserSettingsSchema for writing to maintain backwards compatibility
    const validatedSettings = StoredUserSettingsSchema.parse(newSettings);
    writeSettingsFileAtomically(
      filePath,
      JSON.stringify(validatedSettings, null, 2),
      {
        preserveUnreadableBackup: settingsForWrite.wasUnreadable,
      },
    );
  } catch (error) {
    logger.error("Error writing settings:", error);
  }
}

function readExistingSettingsFile(filePath: string): UserSettings {
  const rawSettings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const combinedSettings: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
  };
  const supabase = combinedSettings.supabase;
  if (supabase) {
    // Decrypt legacy tokens (kept but ignored)
    if (supabase.refreshToken) {
      const decrypted = decryptStoredSecret(
        supabase.refreshToken,
        "Supabase refresh token",
      );
      if (decrypted) {
        supabase.refreshToken = decrypted;
      } else {
        delete supabase.refreshToken;
      }
    }
    if (supabase.accessToken) {
      const decrypted = decryptStoredSecret(
        supabase.accessToken,
        "Supabase access token",
      );
      if (decrypted) {
        supabase.accessToken = decrypted;
      } else {
        delete supabase.accessToken;
      }
    }
    // Decrypt tokens for each organization in the organizations map
    if (supabase.organizations) {
      for (const orgId in supabase.organizations) {
        const org = supabase.organizations[orgId];
        const accessToken = org.accessToken
          ? decryptStoredSecret(
              org.accessToken,
              `Supabase access token for organization ${orgId}`,
            )
          : undefined;
        const refreshToken = org.refreshToken
          ? decryptStoredSecret(
              org.refreshToken,
              `Supabase refresh token for organization ${orgId}`,
            )
          : undefined;

        if (!accessToken || !refreshToken) {
          delete supabase.organizations[orgId];
          continue;
        }

        org.accessToken = accessToken;
        org.refreshToken = refreshToken;
      }
    }
  }
  const neon = combinedSettings.neon;
  if (neon) {
    if (neon.refreshToken) {
      const decrypted = decryptStoredSecret(
        neon.refreshToken,
        "Neon refresh token",
      );
      if (decrypted) {
        neon.refreshToken = decrypted;
      } else {
        delete neon.refreshToken;
      }
    }
    if (neon.accessToken) {
      const decrypted = decryptStoredSecret(
        neon.accessToken,
        "Neon access token",
      );
      if (decrypted) {
        neon.accessToken = decrypted;
      } else {
        delete neon.accessToken;
      }
    }
  }
  if (combinedSettings.githubAccessToken) {
    const decrypted = decryptStoredSecret(
      combinedSettings.githubAccessToken,
      "GitHub access token",
    );
    if (decrypted) {
      combinedSettings.githubAccessToken = decrypted;
    } else {
      delete combinedSettings.githubAccessToken;
    }
  }
  if (combinedSettings.vercelAccessToken) {
    const decrypted = decryptStoredSecret(
      combinedSettings.vercelAccessToken,
      "Vercel access token",
    );
    if (decrypted) {
      combinedSettings.vercelAccessToken = decrypted;
    } else {
      delete combinedSettings.vercelAccessToken;
    }
  }
  for (const provider in combinedSettings.providerSettings) {
    if (combinedSettings.providerSettings[provider].apiKey) {
      const decrypted = decryptStoredSecret(
        combinedSettings.providerSettings[provider].apiKey,
        `${provider} API key`,
      );
      if (decrypted) {
        combinedSettings.providerSettings[provider].apiKey = decrypted;
      } else {
        delete combinedSettings.providerSettings[provider].apiKey;
      }
    }
    // Decrypt Vertex service account key if present
    const v = combinedSettings.providerSettings[
      provider
    ] as VertexProviderSetting;
    if (provider === "vertex" && v?.serviceAccountKey) {
      const decrypted = decryptStoredSecret(
        v.serviceAccountKey,
        "Vertex service account key",
      );
      if (decrypted) {
        v.serviceAccountKey = decrypted;
      } else {
        delete v.serviceAccountKey;
      }
    }
  }

  // Validate stored settings (allows deprecated values like "agent" chat mode)
  const storedSettings = StoredUserSettingsSchema.parse(combinedSettings);
  // "conservative" is deprecated, use undefined to use the default value
  if (storedSettings.proSmartContextOption === "conservative") {
    storedSettings.proSmartContextOption = undefined;
  }
  // Migrate stored settings to active settings (converts deprecated values)
  const migratedSettings = migrateStoredSettings(storedSettings);
  // Validate the migrated settings against the active schema
  return UserSettingsSchema.parse(migratedSettings);
}

function decryptStoredSecret(data: Secret, label: string): Secret | undefined {
  try {
    const encryptionType = data.encryptionType;
    return {
      value: decrypt(data),
      encryptionType,
    };
  } catch (error) {
    if (isSafeStorageNotReadyError(error)) {
      throw error;
    }
    logger.warn(`Could not decrypt ${label}; ignoring stored secret.`, error);
    return undefined;
  }
}

function isSafeStorageNotReadyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("safeStorage cannot be used before app is ready")
  );
}

function readSettingsForWrite(filePath: string): {
  settings: UserSettings;
  wasUnreadable: boolean;
} {
  if (!fs.existsSync(filePath)) {
    return { settings: DEFAULT_SETTINGS, wasUnreadable: false };
  }

  try {
    return {
      settings: readExistingSettingsFile(filePath),
      wasUnreadable: false,
    };
  } catch (error) {
    logger.error("Existing settings file is unreadable:", error);
    notifyRendererError({
      message:
        "Dyad could not read your existing settings file, so it fell back to default settings.",
      action: {
        label: "Read restore docs",
        url: RESTORE_SETTINGS_DOCS_URL,
      },
    });
    return { settings: DEFAULT_SETTINGS, wasUnreadable: true };
  }
}

function notifyRendererError(payload: RendererErrorToast): void {
  const windows = BrowserWindow.getAllWindows().filter((window) =>
    rendererErrorToastReadyWebContents.has(window.webContents),
  );
  if (windows.length === 0) {
    pendingRendererErrors.push(payload);
    return;
  }
  sendRendererErrorToast(windows, payload);
}

export function notifyRendererErrorToastListenerReady(
  webContents: WebContents,
): void {
  rendererErrorToastReadyWebContents.add(webContents);
  const window = BrowserWindow.fromWebContents(webContents);
  if (window) {
    flushPendingRendererErrors([window]);
  }
}

function flushPendingRendererErrors(windows: BrowserWindowInstance[]): void {
  if (pendingRendererErrors.length === 0) {
    return;
  }

  const pending = pendingRendererErrors.splice(0);
  for (const payload of pending) {
    sendRendererErrorToast(windows, payload);
  }
}

function sendRendererErrorToast(
  windows: BrowserWindowInstance[],
  payload: RendererErrorToast,
): void {
  for (const window of windows) {
    window.webContents.send("toast:error", payload);
  }
}

function writeSettingsFileAtomically(
  filePath: string,
  contents: string,
  options: { preserveUnreadableBackup?: boolean } = {},
): void {
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const backupFilePath = `${filePath}.bak`;
  const recoveryBackupFilePath = `${filePath}.recovery-${Date.now()}.bak`;

  try {
    fs.writeFileSync(tempFilePath, contents);
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(
        filePath,
        options.preserveUnreadableBackup
          ? recoveryBackupFilePath
          : backupFilePath,
      );
    }
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (cleanupError) {
      logger.warn("Failed to remove temporary settings file:", cleanupError);
    }
    throw error;
  }
}

export function encrypt(data: string): Secret {
  const trimmed = data.trim();
  if (safeStorage.isEncryptionAvailable() && !IS_TEST_BUILD) {
    return {
      value: safeStorage.encryptString(trimmed).toString("base64"),
      encryptionType: "electron-safe-storage",
    };
  }
  return {
    value: trimmed,
    encryptionType: "plaintext",
  };
}

export function decrypt(data: Secret): string {
  if (data.encryptionType === "electron-safe-storage") {
    return safeStorage.decryptString(Buffer.from(data.value, "base64")).trim();
  }
  return data.value.trim();
}
