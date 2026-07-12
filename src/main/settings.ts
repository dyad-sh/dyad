import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "../paths/paths";
import {
  LastKnownPerformanceSchema,
  SecretSchema,
  StoredUserSettingsSchema,
  UserSettingsSchema,
  type UserSettings,
  Secret,
  VertexProviderSetting,
  migrateStoredSettings,
} from "../lib/schemas";
import {
  app,
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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ZodError } from "zod";
import {
  getRecoveryStats,
  recoverLegacySafeStorageSecret,
} from "./safe_storage_legacy";

const logger = log.scope("settings");

// WARNING: Do not change values once it's been
// set in DEFAULT_SETTINGS.
//
// It is OK to add new fields to DEFAULT_SETTINGS.
// However, be VERY careful about removing fields from DEFAULT_SETTINGS.
// (Exported for the unit-test harness; production code should go through
// readSettings instead of using this directly.)
export const DEFAULT_SETTINGS: UserSettings = {
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
  enableAppBlueprint: true,
  enableAutoUpdate: true,
  releaseChannel: "stable",
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  selectedThemeId: DEFAULT_THEME_ID,
  isRunning: false,
  lastKnownPerformance: undefined,
  // Enabled by default in 0.33.0-beta.1
  enableNativeGit: true,
  enableSandboxScriptExecution: true,
  enableMcpToolSearch: true,
  enableCodeExplorer: true,
  autoApproveNonSchemaSql: true,
  autoExpandPreviewPanel: true,
  enableContextCompaction: true,
  enablePnpmMinimumReleaseAgeWarning: true,
  previewIdleTimeoutPolicy: "default",
  nodeRuntimePreference: "system",
  disablePreviewNodeAutoInstall: false,
};

const CRASH_SENTINEL_FILE = "session.lock";
const RENDERER_CRASH_FILE = "renderer-crash.json";
const SETTINGS_FILE = "user-settings.json";
const RESTORE_SETTINGS_DOCS_URL =
  "https://www.dyad.sh/docs/guides/migrate-restore#restoring-settings-from-backup";
let initialLoadIsFirstSession = false;

export function setInitialLoadIsFirstSession(value: boolean): void {
  initialLoadIsFirstSession = value;
}

export function getInitialLoadIsFirstSession(): boolean {
  return initialLoadIsFirstSession;
}

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

interface CrashSentinelData {
  ts: number;
  // The chat that was last streaming this session, captured at stream start so
  // the crash dialog can offer to upload it. Absent if no stream ran.
  activeChatId?: number;
}

export function writeCrashSentinel(): void {
  try {
    const data: CrashSentinelData = { ts: Date.now() };
    fs.writeFileSync(getCrashSentinelPath(), JSON.stringify(data));
  } catch (error) {
    logger.error("Error writing crash sentinel:", error);
  }
}

// Records the chat that just started streaming into the existing sentinel,
// preserving its timestamp. The sentinel's lifecycle (created at startup,
// deleted on clean exit) scopes this to the current session automatically.
export function setSentinelActiveChat(chatId: number): void {
  try {
    const existing = readCrashSentinel();
    const sentinelPath = getCrashSentinelPath();
    const data: CrashSentinelData = {
      ts: existing?.ts ?? readLegacyCrashSentinelTimestamp(sentinelPath),
      activeChatId: chatId,
    };
    fs.writeFileSync(sentinelPath, JSON.stringify(data));
  } catch (error) {
    logger.error("Error updating crash sentinel active chat:", error);
  }
}

function readLegacyCrashSentinelTimestamp(sentinelPath: string): number {
  try {
    const legacyTimestamp = Number(fs.readFileSync(sentinelPath, "utf8"));
    if (Number.isFinite(legacyTimestamp) && legacyTimestamp > 0) {
      return legacyTimestamp;
    }
  } catch {
    // Missing or malformed legacy sentinels can be replaced with a fresh timestamp.
  }
  return Date.now();
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

// Reads and parses the sentinel. Returns null if missing or not a JSON object
// (e.g. the legacy bare-timestamp format from older builds). That's harmless:
// crash detection is existence-based, and only activeChatId is consumed, so a
// null here just means no chat to offer for upload.
export function readCrashSentinel(): CrashSentinelData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(getCrashSentinelPath(), "utf-8"));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    if (typeof parsed.ts !== "number") {
      return null;
    }
    const activeChatId =
      typeof parsed.activeChatId === "number" ? parsed.activeChatId : undefined;
    return { ts: parsed.ts, activeChatId };
  } catch {
    return null;
  }
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

// Parse the performance block on a renderer-crash record with the same
// schema the performance monitor writes, so the two cannot drift. Best
// effort: a record from a different build may not match the current
// schema; drop the performance block rather than the whole crash record.
function parseRendererCrashPerformance(
  raw: unknown,
): RendererCrashPerformanceSnapshot | undefined {
  const parsed = LastKnownPerformanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function readSettings(): UserSettings {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
    return readExistingSettingsFile(filePath).settings;
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

export function rewriteRecoveredSafeStorageSecretsAfterKeychainUnlock(): number {
  const recoveredBefore = getRecoveryStats().recovered;
  let settings: UserSettings;
  try {
    settings = readExistingSettingsFile(getSettingsFilePath()).settings;
  } catch (error) {
    const recoveredCount = getRecoveryStats().recovered - recoveredBefore;
    if (recoveredCount > 0) {
      logger.warn(
        `Skipped rewriting ${recoveredCount} recovered safeStorage secret(s) after Keychain unlock because settings could not be read safely.`,
        error,
      );
    } else {
      logger.info("Recovered 0 secret(s) after Keychain unlock.");
    }
    return 0;
  }
  const recoveredCount = getRecoveryStats().recovered - recoveredBefore;
  if (recoveredCount <= 0) {
    logger.info("Recovered 0 secret(s) after Keychain unlock.");
    return 0;
  }
  if (
    !tryWriteSettings(
      settings,
      "rewriting settings after legacy safeStorage Keychain unlock",
    )
  ) {
    return 0;
  }
  logger.info(`Recovered ${recoveredCount} secret(s) after Keychain unlock.`);
  return recoveredCount;
}

/**
 * Merges and persists user settings.
 *
 * Secret-clearing contract: set a secret field to `undefined` to explicitly
 * clear it. Omitting/deleting the key is treated as an accidental omission from
 * a consumer read, so preserved locked ciphertext may be re-injected.
 */
export function writeSettings(settings: Partial<UserSettings>): void {
  try {
    const filePath = getSettingsFilePath();
    const settingsForWrite = readSettingsForWrite(filePath);
    const newSettings = { ...settingsForWrite.settings, ...settings };
    // Decide which still-locked ciphertext secrets must survive this write, and
    // strip untouched ones out so the encryption pass below can't corrupt them.
    const preservedToReinject = reconcilePreservedSecrets(
      newSettings,
      settings,
      settingsForWrite.settings,
      settingsForWrite.preserved,
    );
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
    // Write the preserved ciphertext back verbatim — NOT through encrypt(), which
    // would double-encrypt it (or, in test builds, turn ciphertext into plaintext).
    for (const { path, secret } of preservedToReinject) {
      setAtPath(newSettings, path, {
        value: secret.value,
        encryptionType: secret.encryptionType,
      });
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
    throw toSettingsWriteError(error);
  }
}

export function tryWriteSettings(
  settings: Partial<UserSettings>,
  context: string,
): boolean {
  try {
    writeSettings(settings);
    return true;
  } catch (error) {
    logger.error(`Failed to write settings while ${context}:`, error);
    return false;
  }
}

function toSettingsWriteError(error: unknown): DyadError {
  if (error instanceof DyadError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const kind =
    error instanceof ZodError
      ? DyadErrorKind.Validation
      : DyadErrorKind.External;
  return new DyadError(`Failed to write settings: ${message}`, kind, {
    cause: error,
  });
}

// A secret that failed to decrypt but whose ciphertext must be preserved on disk
// so a later session can recover it once the encryption key is available again.
// `path` locates the field within a settings object; `secret` is the untouched
// stored ciphertext (never passed back through encrypt()).
interface PreservedSecret {
  path: string[];
  secret: Secret;
}

interface DecryptContext {
  // When true (the write path) a secret that fails to decrypt is kept verbatim as
  // ciphertext and recorded in `preserved`; when false (the consumer read path) it
  // is dropped so the UI shows "not connected".
  preserveUndecryptable: boolean;
  preserved: PreservedSecret[];
}

// Warn at most once per field per process. Reads happen constantly, so a failed
// decrypt must not spam the log on every read.
const warnedPreservedSecrets = new Set<string>();

function readExistingSettingsFile(
  filePath: string,
  options: { preserveUndecryptable?: boolean } = {},
): { settings: UserSettings; preserved: PreservedSecret[] } {
  const rawSettings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const combinedSettings: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    hasRunBefore: rawSettings.hasRunBefore ?? true,
  };
  const ctx: DecryptContext = {
    preserveUndecryptable: options.preserveUndecryptable ?? false,
    preserved: [],
  };
  const supabase = combinedSettings.supabase;
  if (supabase) {
    // Decrypt legacy tokens (kept but ignored)
    if (supabase.refreshToken) {
      const resolved = resolveStoredSecret(
        supabase.refreshToken,
        "Supabase refresh token",
        ["supabase", "refreshToken"],
        ctx,
      );
      if (resolved) {
        supabase.refreshToken = resolved;
      } else {
        delete supabase.refreshToken;
      }
    }
    if (supabase.accessToken) {
      const resolved = resolveStoredSecret(
        supabase.accessToken,
        "Supabase access token",
        ["supabase", "accessToken"],
        ctx,
      );
      if (resolved) {
        supabase.accessToken = resolved;
      } else {
        delete supabase.accessToken;
      }
    }
    // Decrypt tokens for each organization in the organizations map
    if (supabase.organizations) {
      for (const orgId in supabase.organizations) {
        const org = supabase.organizations[orgId];
        const accessToken = org.accessToken
          ? resolveStoredSecret(
              org.accessToken,
              `Supabase access token for organization ${orgId}`,
              ["supabase", "organizations", orgId, "accessToken"],
              ctx,
            )
          : undefined;
        const refreshToken = org.refreshToken
          ? resolveStoredSecret(
              org.refreshToken,
              `Supabase refresh token for organization ${orgId}`,
              ["supabase", "organizations", orgId, "refreshToken"],
              ctx,
            )
          : undefined;

        // In preserve mode a failed decrypt returns the ciphertext (truthy), so the
        // org is only dropped when a token field is genuinely absent. In drop mode a
        // failed decrypt returns undefined, keeping the original "drop the whole org"
        // behavior for the consumer-facing read.
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
      const resolved = resolveStoredSecret(
        neon.refreshToken,
        "Neon refresh token",
        ["neon", "refreshToken"],
        ctx,
      );
      if (resolved) {
        neon.refreshToken = resolved;
      } else {
        delete neon.refreshToken;
      }
    }
    if (neon.accessToken) {
      const resolved = resolveStoredSecret(
        neon.accessToken,
        "Neon access token",
        ["neon", "accessToken"],
        ctx,
      );
      if (resolved) {
        neon.accessToken = resolved;
      } else {
        delete neon.accessToken;
      }
    }
  }
  if (combinedSettings.githubAccessToken) {
    const resolved = resolveStoredSecret(
      combinedSettings.githubAccessToken,
      "GitHub access token",
      ["githubAccessToken"],
      ctx,
    );
    if (resolved) {
      combinedSettings.githubAccessToken = resolved;
    } else {
      delete combinedSettings.githubAccessToken;
    }
  }
  if (combinedSettings.vercelAccessToken) {
    const resolved = resolveStoredSecret(
      combinedSettings.vercelAccessToken,
      "Vercel access token",
      ["vercelAccessToken"],
      ctx,
    );
    if (resolved) {
      combinedSettings.vercelAccessToken = resolved;
    } else {
      delete combinedSettings.vercelAccessToken;
    }
  }
  for (const provider in combinedSettings.providerSettings) {
    if (combinedSettings.providerSettings[provider].apiKey) {
      const resolved = resolveStoredSecret(
        combinedSettings.providerSettings[provider].apiKey,
        `${provider} API key`,
        ["providerSettings", provider, "apiKey"],
        ctx,
      );
      if (resolved) {
        combinedSettings.providerSettings[provider].apiKey = resolved;
      } else {
        delete combinedSettings.providerSettings[provider].apiKey;
      }
    }
    // Decrypt Vertex service account key if present
    const v = combinedSettings.providerSettings[
      provider
    ] as VertexProviderSetting;
    if (provider === "vertex" && v?.serviceAccountKey) {
      const resolved = resolveStoredSecret(
        v.serviceAccountKey,
        "Vertex service account key",
        ["providerSettings", provider, "serviceAccountKey"],
        ctx,
      );
      if (resolved) {
        v.serviceAccountKey = resolved;
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
  const settings = UserSettingsSchema.parse(migratedSettings);
  return { settings, preserved: ctx.preserved };
}

// Decrypts a stored secret. On success returns the decrypted secret. On failure:
// in preserve mode returns the untouched ciphertext (and records it so the write
// path can persist it verbatim); in drop mode returns undefined. A safeStorage
// not-ready error is always rethrown so the caller falls back to defaults.
function resolveStoredSecret(
  data: Secret,
  label: string,
  path: string[],
  ctx: DecryptContext,
): Secret | undefined {
  try {
    return {
      value: decrypt(data),
      encryptionType: data.encryptionType,
    };
  } catch (error) {
    if (isSafeStorageNotReadyError(error)) {
      throw error;
    }
    // The Keychain identity safeStorage resolved for this session may simply
    // be the wrong one for this ciphertext (issue #3837). Try decrypting with
    // the passwords of the known legacy identities read straight from the
    // Keychain. On the write path the recovered plaintext then flows through
    // the normal encrypt() pass, organically re-encrypting the secret under
    // the current session identity.
    //
    // Gate on app.isReady(): recovery shells out to the `security` CLI, which
    // blocks synchronously and can raise a Keychain permission prompt. On
    // Electron 40 a failed decrypt can happen pre-`ready` (safeStorage runs
    // before ready there), so without this gate the prompt/stall would land on
    // the cold-start path before the window exists. Skipping it pre-`ready` is
    // safe: the ciphertext is preserved (write path) or simply omitted (read
    // path) with no write, and the first post-`ready` read — readEffectiveSettings
    // in onReady, the get-user-settings IPC, or any write — performs recovery.
    const parsedSecret = SecretSchema.safeParse(data);
    if (!parsedSecret.success) {
      logger.warn(
        `Could not decrypt ${label}; stored secret shape is invalid, so it will not be preserved.`,
        parsedSecret.error,
      );
      return undefined;
    }
    const storedSecret = parsedSecret.data;
    if (
      storedSecret.encryptionType === "electron-safe-storage" &&
      app.isReady()
    ) {
      const recovered = recoverLegacySafeStorageSecret(storedSecret.value);
      if (recovered !== null) {
        logger.info(
          `Recovered ${label} using a legacy safeStorage Keychain identity.`,
        );
        return {
          value: recovered.trim(),
          encryptionType: storedSecret.encryptionType,
        };
      }
    }
    warnPreservedSecretOnce(path.join("."), label, error);
    if (ctx.preserveUndecryptable) {
      const ciphertext: Secret = {
        value: storedSecret.value,
        encryptionType: storedSecret.encryptionType,
      };
      ctx.preserved.push({ path, secret: ciphertext });
      return ciphertext;
    }
    return undefined;
  }
}

function warnPreservedSecretOnce(
  key: string,
  label: string,
  error: unknown,
): void {
  if (warnedPreservedSecrets.has(key)) {
    return;
  }
  warnedPreservedSecrets.add(key);
  logger.warn(
    `Could not decrypt ${label}; preserving the stored secret so it can be ` +
      `recovered if the encryption key becomes available again.`,
    error,
  );
}

function isSafeStorageNotReadyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("safeStorage cannot be used before app is ready")
  );
}

function getAtPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hasOwnPropertyAtPath(root: unknown, path: string[]): boolean {
  let current: unknown = root;
  for (const key of path) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, key)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

function setAtPath(root: unknown, path: string[], value: unknown): void {
  let current: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (current === null || typeof current !== "object") {
      return;
    }
    current = (current as Record<string, unknown>)[path[i]];
  }
  if (current && typeof current === "object") {
    (current as Record<string, unknown>)[path[path.length - 1]] = value;
  }
}

function deleteAtPath(root: unknown, path: string[]): void {
  const parent = getAtPath(root, path.slice(0, -1));
  if (parent && typeof parent === "object") {
    delete (parent as Record<string, unknown>)[path[path.length - 1]];
  }
}

function isMatchingSecretValue(current: unknown, secret: Secret): boolean {
  return (
    !!current &&
    typeof current === "object" &&
    (current as Secret).value === secret.value &&
    (current as Secret).encryptionType === secret.encryptionType
  );
}

function isSupabaseOrganizationSecretPath(path: string[]): boolean {
  return (
    path.length === 4 &&
    path[0] === "supabase" &&
    path[1] === "organizations" &&
    (path[3] === "accessToken" || path[3] === "refreshToken")
  );
}

function restoreSupabaseOrganizationForPreservedSecret(
  newSettings: UserSettings,
  incomingSettings: Partial<UserSettings>,
  baselineSettings: UserSettings,
  path: string[],
): boolean {
  if (!isSupabaseOrganizationSecretPath(path)) {
    return false;
  }
  if (!getAtPath(newSettings, ["supabase", "organizations"])) {
    return false;
  }
  const organizationPath = path.slice(0, 3);
  if (
    hasOwnPropertyAtPath(incomingSettings, organizationPath) ||
    hasOwnPropertyAtPath(incomingSettings, path)
  ) {
    return false;
  }
  const baselineOrganization = getAtPath(baselineSettings, organizationPath);
  if (!baselineOrganization || typeof baselineOrganization !== "object") {
    return false;
  }
  setAtPath(newSettings, organizationPath, { ...baselineOrganization });
  return true;
}

// Given the merged settings about to be written, decides what to do with each
// secret that failed to decrypt during the read-merge. Untouched ciphertext is
// removed from `newSettings` (so the encryption pass can't double-encrypt it) and
// returned for verbatim re-injection; ciphertext that a shallow merge dropped from
// a replaced container is re-injected too. A field the caller gave a new value, or
// deliberately removed, is left alone.
function reconcilePreservedSecrets(
  newSettings: UserSettings,
  incomingSettings: Partial<UserSettings>,
  baselineSettings: UserSettings,
  preserved: PreservedSecret[],
): PreservedSecret[] {
  const toReinject: PreservedSecret[] = [];
  for (const entry of preserved) {
    const { path } = entry;
    const current = getAtPath(newSettings, path);
    if (isMatchingSecretValue(current, entry.secret)) {
      // The untouched ciphertext is still sitting in the merged settings. Remove it
      // so the encryption pass below doesn't re-encrypt (and corrupt) it; it is
      // written back verbatim after encryption.
      deleteAtPath(newSettings, path);
      toReinject.push(entry);
    } else if (current !== undefined) {
      // A new value replaced the still-locked secret (e.g. the user reconnected).
      // Let it flow through normal encryption; preservation for this field ends.
      continue;
    } else if (hasOwnPropertyAtPath(incomingSettings, path)) {
      // The caller supplied the secret key with an undefined value. Treat that as
      // an explicit clear, distinct from a readSettings()-rebuilt object where the
      // locked field was omitted because it could not be decrypted.
      continue;
    } else if (
      restoreSupabaseOrganizationForPreservedSecret(
        newSettings,
        incomingSettings,
        baselineSettings,
        path,
      )
    ) {
      deleteAtPath(newSettings, path);
      toReinject.push(entry);
    } else if (path.length > 1) {
      const parent = getAtPath(newSettings, path.slice(0, -1));
      if (parent && typeof parent === "object") {
        // A shallow merge replaced the container (e.g. providerSettings) with one
        // that omits the still-locked secret — as happens when a caller writes a
        // providerSettings object rebuilt from readSettings(), where the locked
        // field was dropped. Re-inject the ciphertext so the write doesn't lose it.
        toReinject.push(entry);
      }
      // If the container itself is gone, treat it as a deliberate removal.
    }
    // A top-level secret absent from the merge means the caller explicitly cleared
    // it (a partial with the key set to undefined); honor the removal.
  }
  return toReinject;
}

function readSettingsForWrite(filePath: string): {
  settings: UserSettings;
  wasUnreadable: boolean;
  preserved: PreservedSecret[];
} {
  if (!fs.existsSync(filePath)) {
    return { settings: DEFAULT_SETTINGS, wasUnreadable: false, preserved: [] };
  }

  try {
    // Preserve mode: secrets that fail to decrypt are kept as ciphertext so the
    // write below never destroys them.
    const { settings, preserved } = readExistingSettingsFile(filePath, {
      preserveUndecryptable: true,
    });
    return { settings, wasUnreadable: false, preserved };
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
    return { settings: DEFAULT_SETTINGS, wasUnreadable: true, preserved: [] };
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
