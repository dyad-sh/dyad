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
  chatAgentMcpServerIds: [],
  chatAgentMcpToolKeys: [],
  chatAgentMcpWorkflowKeys: [],
  researchPlugins: {
    travelSearch: {
      enabled: true,
      market: "AU",
      locale: "en-AU",
      currency: "AUD",
    },
    duckDuckGo: { enabled: true },
    coinGecko: { enabled: true, plan: "public" },
    weather: {
      enabled: true,
      temperatureUnit: "celsius",
      windSpeedUnit: "kmh",
      forecastDays: 7,
    },
    maps: { enabled: true, style: "dark" },
    skyscanner: {
      enabled: false,
      market: "AU",
      locale: "en-AU",
      currency: "AUD",
    },
    amadeus: {
      enabled: false,
      environment: "test",
      currency: "AUD",
    },
    duffel: { enabled: false },
  },
  chatAgentSystemAccess: {
    terminal: false,
    browser: false,
    computer: false,
  },
};

const CRASH_SENTINEL_FILE = "session.lock";
const RENDERER_CRASH_FILE = "renderer-crash.json";
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

export type RendererCrashPerformanceSnapshot = NonNullable<
  UserSettings["lastKnownPerformance"]
>;

export interface RendererCrashRecord {
  reason: string;
  exitCode?: number;
  timestamp: number;
  count: number;
  performance?: RendererCrashPerformanceSnapshot;
}

function getRendererCrashPath(): string {
  return path.join(getUserDataPath(), RENDERER_CRASH_FILE);
}

// Record a renderer crash so we can send a telemetry event on the next renderer
// load. The renderer is dead at the time of writing, so the event cannot be
// captured directly; we persist a small JSON record and forward it once the
// renderer IPC bridge comes back up. If the renderer crashes again before the
// record is consumed, we keep the latest reason/exitCode and bump `count`.
export function recordRendererCrash(
  details: Omit<RendererCrashRecord, "count" | "timestamp"> &
    Partial<Pick<RendererCrashRecord, "timestamp">>,
): void {
  try {
    const previous = readRendererCrashRecord();
    const record: RendererCrashRecord = {
      reason: details.reason,
      exitCode: details.exitCode,
      timestamp: details.timestamp ?? Date.now(),
      count: (previous?.count ?? 0) + 1,
      // Latest snapshot wins; if the caller didn't supply one (e.g. settings
      // unreadable at crash time) fall back to whatever the previous record
      // had so we don't lose pre-existing context.
      performance: details.performance ?? previous?.performance,
    };
    const filePath = getRendererCrashPath();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record));
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    logger.error("Error writing renderer crash record:", error);
  }
}

export function readRendererCrashRecord(): RendererCrashRecord | null {
  try {
    const filePath = getRendererCrashPath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const reason = typeof raw.reason === "string" ? raw.reason : "unknown";
    const exitCode =
      typeof raw.exitCode === "number" ? raw.exitCode : undefined;
    const timestamp =
      typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
    const count =
      typeof raw.count === "number" && raw.count > 0 ? raw.count : 1;
    const performance = parseRendererCrashPerformance(raw.performance);
    return { reason, exitCode, timestamp, count, performance };
  } catch (error) {
    logger.error("Error reading renderer crash record:", error);
    return null;
  }
}

export function clearRendererCrashRecord(): void {
  try {
    fs.unlinkSync(getRendererCrashPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("Error clearing renderer crash record:", error);
    }
  }
}

// Lenient parser for the performance block on a renderer-crash record.
// We deliberately accept partial data rather than throwing: the record may
// have been written by an older build, and the fields are best-effort
// telemetry — losing one of them shouldn't drop the whole crash report.
function parseRendererCrashPerformance(
  raw: unknown,
): RendererCrashPerformanceSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.timestamp !== "number") {
    return undefined;
  }
  if (typeof candidate.memoryUsageMB !== "number") {
    return undefined;
  }
  const optionalNumber = (key: string): number | undefined =>
    typeof candidate[key] === "number" ? (candidate[key] as number) : undefined;
  return {
    timestamp: candidate.timestamp,
    memoryUsageMB: candidate.memoryUsageMB,
    cpuUsagePercent: optionalNumber("cpuUsagePercent"),
    systemMemoryUsageMB: optionalNumber("systemMemoryUsageMB"),
    systemMemoryTotalMB: optionalNumber("systemMemoryTotalMB"),
    systemCpuPercent: optionalNumber("systemCpuPercent"),
  };
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
    // `jarvis` holds a secret alongside ordinary preferences. A shallow merge
    // would let a caller that sends only one field drop the API key, so merge
    // this object field-by-field instead.
    if (settings.jarvis) {
      newSettings.jarvis = {
        ...settingsForWrite.settings.jarvis,
        ...settings.jarvis,
      };
    }
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
    if (newSettings.vercelAiGatewayApiKey) {
      newSettings.vercelAiGatewayApiKey = encrypt(
        newSettings.vercelAiGatewayApiKey.value,
      );
    }
    if (newSettings.vercelBlob?.token) {
      newSettings.vercelBlob.token = encrypt(
        newSettings.vercelBlob.token.value,
      );
    }
    if (newSettings.researchPlugins?.coinGecko?.apiKey) {
      newSettings.researchPlugins.coinGecko.apiKey = encrypt(
        newSettings.researchPlugins.coinGecko.apiKey.value,
      );
    }
    if (newSettings.researchPlugins?.skyscanner?.apiKey) {
      newSettings.researchPlugins.skyscanner.apiKey = encrypt(
        newSettings.researchPlugins.skyscanner.apiKey.value,
      );
    }
    if (newSettings.researchPlugins?.amadeus?.apiKey) {
      newSettings.researchPlugins.amadeus.apiKey = encrypt(
        newSettings.researchPlugins.amadeus.apiKey.value,
      );
    }
    if (newSettings.researchPlugins?.amadeus?.apiSecret) {
      newSettings.researchPlugins.amadeus.apiSecret = encrypt(
        newSettings.researchPlugins.amadeus.apiSecret.value,
      );
    }
    if (newSettings.researchPlugins?.duffel?.accessToken) {
      newSettings.researchPlugins.duffel.accessToken = encrypt(
        newSettings.researchPlugins.duffel.accessToken.value,
      );
    }
    if (newSettings.jarvis?.elevenLabsApiKey) {
      newSettings.jarvis.elevenLabsApiKey = encrypt(
        newSettings.jarvis.elevenLabsApiKey.value,
      );
    }
    if (newSettings.socialMedia) {
      const facebook = newSettings.socialMedia.facebook;
      if (facebook?.pageAccessToken) {
        facebook.pageAccessToken = encrypt(facebook.pageAccessToken.value);
      }
      const x = newSettings.socialMedia.x;
      if (x) {
        x.accessToken = encrypt(x.accessToken.value);
        if (x.authType === "oauth2") {
          if (x.clientSecret) {
            x.clientSecret = encrypt(x.clientSecret.value);
          }
          if (x.refreshToken) {
            x.refreshToken = encrypt(x.refreshToken.value);
          }
        } else {
          x.apiKey = encrypt(x.apiKey.value);
          x.apiSecret = encrypt(x.apiSecret.value);
          x.accessTokenSecret = encrypt(x.accessTokenSecret.value);
        }
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
  if (combinedSettings.vercelAiGatewayApiKey) {
    const decrypted = decryptStoredSecret(
      combinedSettings.vercelAiGatewayApiKey,
      "Vercel AI Gateway API key",
    );
    if (decrypted) {
      combinedSettings.vercelAiGatewayApiKey = decrypted;
    } else {
      delete combinedSettings.vercelAiGatewayApiKey;
    }
  }
  if (combinedSettings.vercelBlob?.token) {
    const decrypted = decryptStoredSecret(
      combinedSettings.vercelBlob.token,
      "Vercel Blob token",
    );
    if (decrypted) {
      combinedSettings.vercelBlob.token = decrypted;
    } else {
      delete combinedSettings.vercelBlob.token;
    }
  }
  if (combinedSettings.researchPlugins?.coinGecko?.apiKey) {
    const decrypted = decryptStoredSecret(
      combinedSettings.researchPlugins.coinGecko.apiKey,
      "CoinGecko API key",
    );
    if (decrypted) {
      combinedSettings.researchPlugins.coinGecko.apiKey = decrypted;
    } else {
      delete combinedSettings.researchPlugins.coinGecko.apiKey;
    }
  }
  if (combinedSettings.researchPlugins?.skyscanner?.apiKey) {
    const decrypted = decryptStoredSecret(
      combinedSettings.researchPlugins.skyscanner.apiKey,
      "Skyscanner API key",
    );
    if (decrypted) {
      combinedSettings.researchPlugins.skyscanner.apiKey = decrypted;
    } else {
      delete combinedSettings.researchPlugins.skyscanner.apiKey;
    }
  }
  if (combinedSettings.researchPlugins?.amadeus?.apiKey) {
    const decrypted = decryptStoredSecret(
      combinedSettings.researchPlugins.amadeus.apiKey,
      "Amadeus API key",
    );
    if (decrypted) {
      combinedSettings.researchPlugins.amadeus.apiKey = decrypted;
    } else {
      delete combinedSettings.researchPlugins.amadeus.apiKey;
    }
  }
  if (combinedSettings.researchPlugins?.amadeus?.apiSecret) {
    const decrypted = decryptStoredSecret(
      combinedSettings.researchPlugins.amadeus.apiSecret,
      "Amadeus API secret",
    );
    if (decrypted) {
      combinedSettings.researchPlugins.amadeus.apiSecret = decrypted;
    } else {
      delete combinedSettings.researchPlugins.amadeus.apiSecret;
    }
  }
  if (combinedSettings.researchPlugins?.duffel?.accessToken) {
    const decrypted = decryptStoredSecret(
      combinedSettings.researchPlugins.duffel.accessToken,
      "Duffel access token",
    );
    if (decrypted) {
      combinedSettings.researchPlugins.duffel.accessToken = decrypted;
    } else {
      delete combinedSettings.researchPlugins.duffel.accessToken;
    }
  }
  if (combinedSettings.jarvis?.elevenLabsApiKey) {
    const decrypted = decryptStoredSecret(
      combinedSettings.jarvis.elevenLabsApiKey,
      "ElevenLabs API key",
    );
    if (decrypted) {
      combinedSettings.jarvis.elevenLabsApiKey = decrypted;
    } else {
      delete combinedSettings.jarvis.elevenLabsApiKey;
    }
  }
  const socialMedia = combinedSettings.socialMedia;
  if (socialMedia?.facebook) {
    const decrypted = decryptStoredSecret(
      socialMedia.facebook.pageAccessToken,
      "Facebook page access token",
    );
    if (decrypted) {
      socialMedia.facebook.pageAccessToken = decrypted;
    } else {
      delete socialMedia.facebook;
    }
  }
  if (socialMedia?.x) {
    const x = socialMedia.x;
    const accessToken = decryptStoredSecret(x.accessToken, "X access token");
    if (x.authType === "oauth2" && accessToken) {
      x.accessToken = accessToken;
      if (x.clientSecret) {
        const clientSecret = decryptStoredSecret(
          x.clientSecret,
          "X OAuth client secret",
        );
        if (clientSecret) x.clientSecret = clientSecret;
        else delete x.clientSecret;
      }
      if (x.refreshToken) {
        const refreshToken = decryptStoredSecret(
          x.refreshToken,
          "X OAuth refresh token",
        );
        if (refreshToken) x.refreshToken = refreshToken;
        else delete x.refreshToken;
      }
    } else if (x.authType !== "oauth2") {
      const apiKey = decryptStoredSecret(x.apiKey, "X API key");
      const apiSecret = decryptStoredSecret(x.apiSecret, "X API secret");
      const accessTokenSecret = decryptStoredSecret(
        x.accessTokenSecret,
        "X access token secret",
      );
      if (apiKey && apiSecret && accessToken && accessTokenSecret) {
        x.apiKey = apiKey;
        x.apiSecret = apiSecret;
        x.accessToken = accessToken;
        x.accessTokenSecret = accessTokenSecret;
      } else {
        delete socialMedia.x;
      }
    } else {
      delete socialMedia.x;
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
        "Meta Human OS could not read your existing settings file, so it fell back to default settings.",
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
