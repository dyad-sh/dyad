/**
 * Vault IPC Handlers
 * Handles IPC communication for Vault v2 backup/restore operations
 */

import log from "electron-log";
import { app } from "electron";
import { createLoggedHandler } from "./safe_handle";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { readSettings, writeSettings } from "../../main/settings";
import { VaultClient, type VaultBackup } from "../../vault/vault_client";
import {
  validateVaultConfig,
  maskKey,
  DEFAULT_VAULT_URL,
  DEFAULT_VAULT_ANON_KEY,
  hasEnvDefaults,
  isVaultConfigured,
} from "../../vault/vault_config";
import type { VaultAuthSession } from "../../lib/schemas";

/**
 * Vault authentication status reason codes.
 * Used to provide clear feedback on why authentication failed or succeeded.
 */
export type VaultAuthReason =
  | "AUTHENTICATED"
  | "AUTHENTICATED_ANONYMOUS"
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "TOKEN_REFRESH_FAILED"
  | "CONFIG_MISSING";

const logger = log.scope("vault_handlers");
const handle = createLoggedHandler(logger);

/**
 * Get vault configuration from settings with fallback to env vars
 */
function getVaultConfig(): { url: string; anonKey: string } {
  const settings = readSettings();
  return {
    url: settings.vault?.supabaseUrl || DEFAULT_VAULT_URL,
    anonKey: settings.vault?.supabaseAnonKey?.value || DEFAULT_VAULT_ANON_KEY,
  };
}

/**
 * Get access token from settings for Vault authentication.
 * First checks for Vault-specific auth session, then falls back to Supabase org tokens.
 */
async function getVaultAccessToken(): Promise<string | null> {
  const settings = readSettings();

  // First, check for Vault-specific auth session
  const vaultSession = settings.vault?.authSession;
  if (vaultSession?.accessToken?.value) {
    // Check if token is expired
    const now = Date.now();
    if (vaultSession.expiresAt > now) {
      return vaultSession.accessToken.value;
    }
    // Token expired, try to refresh
    if (vaultSession.refreshToken?.value) {
      try {
        const refreshed = await refreshVaultSession(
          vaultSession.refreshToken.value,
        );
        if (refreshed) {
          return refreshed.accessToken.value;
        }
      } catch (error) {
        logger.warn("Failed to refresh vault session:", error);
      }
    }
  }

  // Fall back to Supabase organization token
  const organizations = settings.supabase?.organizations;
  if (!organizations) {
    return null;
  }

  const orgSlugs = Object.keys(organizations);
  if (orgSlugs.length === 0) {
    return null;
  }

  const firstOrg = organizations[orgSlugs[0]];
  return firstOrg?.accessToken?.value || null;
}

/**
 * Create a Supabase client for Vault authentication
 */
function createVaultSupabaseClient() {
  const config = getVaultConfig();
  if (!config.url || !config.anonKey) {
    throw new Error(
      "Vault is not configured. Please set URL and publishable key.",
    );
  }

  // Dynamic import to avoid bundling issues
  // We use node-fetch compatible approach for Electron main process
  return {
    url: config.url,
    anonKey: config.anonKey,
  };
}

/**
 * Sign in to Vault using email and password
 */
async function signInToVault(
  email: string,
  password: string,
): Promise<VaultAuthSession> {
  const { url, anonKey } = createVaultSupabaseClient();

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error_description || error.message || "Sign in failed",
    );
  }

  const data = await response.json();

  const session: VaultAuthSession = {
    accessToken: { value: data.access_token },
    refreshToken: { value: data.refresh_token },
    userEmail: data.user?.email || email,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Store session in settings
  const settings = readSettings();
  writeSettings({
    vault: {
      ...settings.vault,
      authSession: session,
    },
  });

  logger.info(`Vault sign-in successful for: ${maskEmail(email)}`);
  return session;
}

/**
 * Sign up for Vault using email and password
 */
async function signUpForVault(
  email: string,
  password: string,
): Promise<VaultAuthSession> {
  const { url, anonKey } = createVaultSupabaseClient();

  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error_description || error.message || "Sign up failed",
    );
  }

  const data = await response.json();

  // If email confirmation is required, user won't have tokens yet
  if (!data.access_token) {
    throw new Error(
      "Please check your email to confirm your account, then sign in.",
    );
  }

  const session: VaultAuthSession = {
    accessToken: { value: data.access_token },
    refreshToken: { value: data.refresh_token },
    userEmail: data.user?.email || email,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Store session in settings
  const settings = readSettings();
  writeSettings({
    vault: {
      ...settings.vault,
      authSession: session,
    },
  });

  logger.info(`Vault sign-up successful for: ${maskEmail(email)}`);
  return session;
}

/**
 * Refresh Vault session using refresh token
 */
async function refreshVaultSession(
  refreshToken: string,
): Promise<VaultAuthSession | null> {
  const { url, anonKey } = createVaultSupabaseClient();

  const response = await fetch(
    `${url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  const session: VaultAuthSession = {
    accessToken: { value: data.access_token },
    refreshToken: { value: data.refresh_token },
    userEmail: data.user?.email || "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Update stored session
  const settings = readSettings();
  writeSettings({
    vault: {
      ...settings.vault,
      authSession: session,
    },
  });

  logger.info("Vault session refreshed");
  return session;
}

/**
 * Sign out from Vault
 */
function signOutFromVault(): void {
  const settings = readSettings();
  if (settings.vault) {
    writeSettings({
      vault: {
        ...settings.vault,
        authSession: undefined,
      },
    });
  }
  logger.info("Vault sign-out completed");
}

/**
 * Sign in anonymously to Vault.
 * Creates a new anonymous user that can use RLS-protected resources.
 * Anonymous users have auth.uid() but no email.
 */
async function signInAnonymously(): Promise<VaultAuthSession> {
  const { url, anonKey } = createVaultSupabaseClient();

  logger.info("Attempting anonymous sign-in to Vault...");

  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      // Supabase anonymous sign-in uses empty email/password or special endpoint
      // For Supabase, we use the signUp endpoint with a flag for anonymous
      data: { is_anonymous: true },
    }),
  });

  // If standard signup doesn't support anonymous, try the dedicated endpoint
  if (!response.ok) {
    // Try the anonymous sign-in endpoint (Supabase v2.64+)
    const anonResponse = await fetch(
      `${url}/auth/v1/token?grant_type=anonymous`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
        },
        body: JSON.stringify({}),
      },
    );

    if (!anonResponse.ok) {
      const error = await anonResponse.json().catch(() => ({}));
      logger.error("Anonymous sign-in failed:", error);
      throw new Error(
        error.error_description ||
          error.message ||
          "Anonymous sign-in not supported. Enable anonymous sign-ins in Supabase Dashboard.",
      );
    }

    const anonData = await anonResponse.json();
    return createAnonymousSession(anonData);
  }

  const data = await response.json();
  return createAnonymousSession(data);
}

/**
 * Helper to create and persist an anonymous session.
 */
function createAnonymousSession(data: any): VaultAuthSession {
  const session: VaultAuthSession = {
    accessToken: { value: data.access_token },
    refreshToken: { value: data.refresh_token },
    userEmail: "anonymous",
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    isAnonymous: true,
    userId: data.user?.id,
  };

  // Store session in settings
  const settings = readSettings();
  writeSettings({
    vault: {
      ...settings.vault,
      authSession: session,
    },
  });

  logger.info(
    "Anonymous sign-in successful, userId:",
    data.user?.id?.slice(0, 8),
  );
  return session;
}

/**
 * Auto-initialize Vault configuration from environment defaults.
 * Called on first Vault access if saved config is missing but env defaults exist.
 * Returns true if config was auto-populated.
 */
function autoInitializeVaultConfig(): boolean {
  const settings = readSettings();
  const hasExistingConfig = isVaultConfigured(
    settings.vault?.supabaseUrl || "",
    settings.vault?.supabaseAnonKey?.value || "",
  );

  if (hasExistingConfig) {
    logger.debug("Vault already configured, skipping auto-init");
    return false;
  }

  if (!hasEnvDefaults()) {
    logger.debug("No env defaults available for Vault auto-init");
    return false;
  }

  // Auto-populate from environment
  logger.info("Auto-initializing Vault config from environment defaults");
  writeSettings({
    vault: {
      ...settings.vault,
      supabaseUrl: DEFAULT_VAULT_URL,
      supabaseAnonKey: { value: DEFAULT_VAULT_ANON_KEY },
    },
  });

  return true;
}

/**
 * Ensure Vault has a valid auth session.
 * If no session exists and config is valid, attempt anonymous sign-in.
 * Returns the access token or throws if authentication fails.
 */
async function ensureVaultAuth(): Promise<string> {
  // First, try auto-init if needed
  autoInitializeVaultConfig();

  // Check current auth status
  const authStatus = getVaultAuthStatus();

  if (authStatus.isAuthenticated) {
    const token = await getVaultAccessToken();
    if (token) return token;
  }

  // If session expired, try to refresh
  if (authStatus.reason === "SESSION_EXPIRED") {
    const settings = readSettings();
    const refreshToken = settings.vault?.authSession?.refreshToken?.value;
    if (refreshToken) {
      logger.info("Session expired, attempting refresh...");
      const refreshed = await refreshVaultSession(refreshToken);
      if (refreshed) {
        return refreshed.accessToken.value;
      }
    }
  }

  // No valid session - try anonymous sign-in
  logger.info("No valid session, attempting anonymous sign-in...");
  try {
    const session = await signInAnonymously();
    return session.accessToken.value;
  } catch (error) {
    logger.error("Failed to establish Vault auth:", error);
    throw new Error(
      "Not authenticated. Please sign in to use Vault, or enable anonymous sign-ins in your Supabase project.",
    );
  }
}

/**
 * Structured Vault auth status result
 */
export interface VaultAuthStatusResult {
  isAuthenticated: boolean;
  reason: VaultAuthReason;
  userEmail?: string;
  userId?: string;
  expiresAt?: number;
  isAnonymous?: boolean;
}

/**
 * Get current Vault auth status with detailed reason
 */
function getVaultAuthStatus(): VaultAuthStatusResult {
  const settings = readSettings();
  const config = getVaultConfig();

  // Check if Vault is configured
  if (!config.url || !config.anonKey) {
    return {
      isAuthenticated: false,
      reason: "CONFIG_MISSING",
    };
  }

  const session = settings.vault?.authSession;

  if (!session?.accessToken?.value) {
    return {
      isAuthenticated: false,
      reason: "NO_SESSION",
    };
  }

  const now = Date.now();
  if (session.expiresAt <= now) {
    return {
      isAuthenticated: false,
      reason: "SESSION_EXPIRED",
      userEmail: session.userEmail,
      expiresAt: session.expiresAt,
      isAnonymous: session.isAnonymous,
    };
  }

  return {
    isAuthenticated: true,
    reason: session.isAnonymous ? "AUTHENTICATED_ANONYMOUS" : "AUTHENTICATED",
    userEmail: session.userEmail,
    userId: session.userId,
    expiresAt: session.expiresAt,
    isAnonymous: session.isAnonymous,
  };
}

/**
 * Mask email for logging (show only first 2 chars and domain)
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const maskedLocal = local.length > 2 ? local.slice(0, 2) + "***" : "***";
  return `${maskedLocal}@${domain}`;
}

/**
 * Create a VaultClient instance with current configuration
 */
function createVaultClient(): VaultClient {
  const config = getVaultConfig();
  return new VaultClient({
    supabaseUrl: config.url,
    supabaseAnonKey: config.anonKey,
    getAccessToken: getVaultAccessToken,
  });
}

// IPC Types for Vault operations
export interface VaultStatusResponse {
  isAuthenticated: boolean;
  organizationName?: string;
}

export interface VaultBackupParams {
  appId: number;
  notes?: string;
}

export interface VaultRestoreParams {
  backupId: string;
  targetPath: string;
}

export interface VaultProgressEvent {
  stage: string;
  progress: number;
}

export interface VaultSettingsResponse {
  supabaseUrl: string;
  hasAnonKey: boolean;
  maskedAnonKey: string;
}

export interface VaultTestConnectionResult {
  success: boolean;
  status: "connected" | "needs_login" | "invalid_url" | "invalid_key" | "error";
  message: string;
  authReason?: VaultAuthReason;
}

export interface VaultDiagnostics {
  timestamp: string;
  supabaseUrl: string;
  hasAnonKey: boolean;
  maskedAnonKey: string;
  isAuthenticated: boolean;
  authReason: VaultAuthReason;
  isAnonymous: boolean;
  userId: string | null;
  userEmail: string | null;
  expiresAt: string | null; // ISO timestamp or null
  supabaseOrgSlug: string | null;
  lastError: string | null;
  autoConfigAvailable: boolean;
}

export function registerVaultHandlers() {
  /**
   * Get vault authentication status
   */
  handle("vault:get-status", async (): Promise<VaultStatusResponse> => {
    const token = await getVaultAccessToken();
    const settings = readSettings();
    const organizations = settings.supabase?.organizations;

    if (!token || !organizations) {
      return { isAuthenticated: false };
    }

    const orgSlugs = Object.keys(organizations);
    return {
      isAuthenticated: true,
      organizationName: orgSlugs[0] || undefined,
    };
  });

  /**
   * List all backups for the current user
   */
  handle("vault:list-backups", async (): Promise<VaultBackup[]> => {
    const client = createVaultClient();
    return client.listBackups();
  });

  /**
   * Create a backup for an app
   */
  handle(
    "vault:create-backup",
    async (_, params: VaultBackupParams): Promise<VaultBackup> => {
      const { appId, notes } = params;

      // Get app details from database
      const appData = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!appData) {
        throw new Error(`App not found: ${appId}`);
      }

      const client = createVaultClient();
      const appVersion = app.getVersion();

      logger.info(`Creating backup for app: ${appData.name} (${appId})`);

      const backup = await client.createBackup({
        projectName: appData.name,
        projectPath: appData.path,
        appVersion,
        notes,
        onProgress: (stage, progress) => {
          logger.debug(`Backup progress: ${stage} (${progress}%)`);
        },
      });

      logger.info(`Backup created: ${backup.id}`);
      return backup;
    },
  );

  /**
   * Restore a backup to a target path
   */
  handle(
    "vault:restore-backup",
    async (_, params: VaultRestoreParams): Promise<void> => {
      const { backupId, targetPath } = params;

      const client = createVaultClient();

      logger.info(`Restoring backup: ${backupId} to ${targetPath}`);

      await client.restoreBackup({
        backupId,
        targetPath,
        onProgress: (stage, progress) => {
          logger.debug(`Restore progress: ${stage} (${progress}%)`);
        },
      });

      logger.info("Backup restored successfully");
    },
  );

  /**
   * Delete a backup
   */
  handle(
    "vault:delete-backup",
    async (_, { backupId }: { backupId: string }): Promise<void> => {
      const client = createVaultClient();

      logger.info(`Deleting backup: ${backupId}`);
      await client.deleteBackup(backupId);
      logger.info("Backup deleted");
    },
  );

  /**
   * Get vault configuration (for debugging/setup)
   */
  handle(
    "vault:get-config",
    async (): Promise<{ url: string; configured: boolean }> => {
      const config = getVaultConfig();
      return {
        url: config.url,
        configured: config.anonKey.length > 0,
      };
    },
  );

  /**
   * Get vault settings for the settings UI
   */
  handle("vault:get-settings", async (): Promise<VaultSettingsResponse> => {
    const config = getVaultConfig();
    return {
      supabaseUrl: config.url,
      hasAnonKey: config.anonKey.length > 0,
      maskedAnonKey: maskKey(config.anonKey),
    };
  });

  /**
   * Save vault settings
   */
  handle(
    "vault:save-settings",
    async (
      _,
      params: { supabaseUrl: string; supabaseAnonKey: string },
    ): Promise<{ success: boolean; error?: string }> => {
      const { supabaseUrl, supabaseAnonKey } = params;

      // Validate configuration
      const validation = validateVaultConfig(supabaseUrl, supabaseAnonKey);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // Save to settings
      writeSettings({
        vault: {
          supabaseUrl: supabaseUrl.trim(),
          supabaseAnonKey: { value: supabaseAnonKey.trim() },
        },
      });

      logger.info(
        `Vault settings saved: URL=${supabaseUrl}, key=${maskKey(supabaseAnonKey)}`,
      );
      return { success: true };
    },
  );

  /**
   * Test vault connection
   * Validates config, attempts session refresh, and tests Edge Function connectivity
   */
  handle(
    "vault:test-connection",
    async (): Promise<VaultTestConnectionResult> => {
      const config = getVaultConfig();

      // Step 1: Validate config
      if (!config.url) {
        return {
          success: false,
          status: "invalid_url",
          message: "Supabase URL is not configured",
          authReason: "CONFIG_MISSING",
        };
      }

      if (!config.anonKey) {
        return {
          success: false,
          status: "invalid_key",
          message: "Publishable key is not configured",
          authReason: "CONFIG_MISSING",
        };
      }

      // Step 2: Check auth status and attempt refresh if expired
      const authStatus = getVaultAuthStatus();
      logger.info(`Test connection - auth status: ${authStatus.reason}`);

      if (authStatus.reason === "SESSION_EXPIRED") {
        // Try to refresh the session
        const settings = readSettings();
        const refreshToken = settings.vault?.authSession?.refreshToken?.value;
        if (refreshToken) {
          logger.info("Attempting to refresh expired session...");
          const refreshed = await refreshVaultSession(refreshToken);
          if (!refreshed) {
            return {
              success: false,
              status: "needs_login",
              message:
                "Session expired and refresh failed. Please sign in again.",
              authReason: "TOKEN_REFRESH_FAILED",
            };
          }
          logger.info("Session refreshed successfully");
        } else {
          return {
            success: false,
            status: "needs_login",
            message: "Session expired. Please sign in to Vault.",
            authReason: "SESSION_EXPIRED",
          };
        }
      }

      // Step 3: Check if we have a valid token
      const token = await getVaultAccessToken();
      if (!token) {
        return {
          success: false,
          status: "needs_login",
          message: "No active session. Sign in to Vault to enable backups.",
          authReason: authStatus.reason,
        };
      }

      // Step 4: Test end-to-end connectivity with edge function
      try {
        const client = createVaultClient();
        await client.listBackups();

        return {
          success: true,
          status: "connected",
          message: "Successfully connected to Vault",
          authReason: "AUTHENTICATED",
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        logger.error(
          `Vault connection test failed: ${errorMessage}, URL=${config.url}, key=${maskKey(config.anonKey)}`,
        );

        // Categorize errors
        if (
          errorMessage.includes("401") ||
          errorMessage.includes("unauthorized") ||
          errorMessage.includes("Invalid or expired token")
        ) {
          return {
            success: false,
            status: "needs_login",
            message: "Session expired. Please sign in to Vault again.",
            authReason: "SESSION_EXPIRED",
          };
        }

        if (
          errorMessage.includes("403") ||
          errorMessage.includes("forbidden")
        ) {
          return {
            success: false,
            status: "invalid_key",
            message: "Access denied. Check your publishable key.",
          };
        }

        if (
          errorMessage.includes("fetch") ||
          errorMessage.includes("network") ||
          errorMessage.includes("ENOTFOUND") ||
          errorMessage.includes("Failed to fetch")
        ) {
          return {
            success: false,
            status: "invalid_url",
            message: "Cannot reach server. Check URL and internet connection.",
          };
        }

        return {
          success: false,
          status: "error",
          message: errorMessage,
        };
      }
    },
  );

  /**
   * Get vault diagnostics for support
   * Returns sanitized info (no full keys or tokens)
   */
  handle("vault:get-diagnostics", async (): Promise<VaultDiagnostics> => {
    const config = getVaultConfig();
    const settings = readSettings();
    const organizations = settings.supabase?.organizations;
    const orgSlugs = organizations ? Object.keys(organizations) : [];
    const authStatus = getVaultAuthStatus();

    // Format expiry timestamp safely
    let expiresAtFormatted: string | null = null;
    if (authStatus.expiresAt) {
      try {
        expiresAtFormatted = new Date(authStatus.expiresAt).toISOString();
      } catch {
        expiresAtFormatted = `Invalid timestamp: ${authStatus.expiresAt}`;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      supabaseUrl: config.url,
      hasAnonKey: config.anonKey.length > 0,
      maskedAnonKey: maskKey(config.anonKey),
      isAuthenticated: authStatus.isAuthenticated,
      authReason: authStatus.reason,
      isAnonymous: authStatus.isAnonymous || false,
      userId: authStatus.userId || null,
      userEmail: authStatus.userEmail || null,
      expiresAt: expiresAtFormatted,
      supabaseOrgSlug: orgSlugs[0] || null,
      lastError: null,
      autoConfigAvailable: hasEnvDefaults(),
    };
  });

  /**
   * Sign in to Vault with email and password
   */
  handle(
    "vault:auth-sign-in",
    async (
      _,
      params: { email: string; password: string; isSignUp?: boolean },
    ): Promise<{ success: boolean; error?: string; userEmail?: string }> => {
      try {
        let session: VaultAuthSession;
        if (params.isSignUp) {
          session = await signUpForVault(params.email, params.password);
        } else {
          session = await signInToVault(params.email, params.password);
        }
        return { success: true, userEmail: session.userEmail };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Authentication failed";
        logger.error(`Vault auth failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  /**
   * Sign out from Vault
   */
  handle("vault:auth-sign-out", async (): Promise<{ success: boolean }> => {
    signOutFromVault();
    return { success: true };
  });

  /**
   * Get Vault auth status with detailed reason
   */
  handle("vault:auth-status", async (): Promise<VaultAuthStatusResult> => {
    return getVaultAuthStatus();
  });

  /**
   * Refresh Vault session manually
   */
  handle(
    "vault:auth-refresh",
    async (): Promise<{ success: boolean; error?: string }> => {
      const settings = readSettings();
      const refreshToken = settings.vault?.authSession?.refreshToken?.value;

      if (!refreshToken) {
        return { success: false, error: "No refresh token available" };
      }

      try {
        const session = await refreshVaultSession(refreshToken);
        if (session) {
          logger.info("Manual session refresh successful");
          return { success: true };
        }
        return { success: false, error: "Session refresh failed" };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Refresh failed";
        logger.error(`Manual session refresh failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  /**
   * Sign in anonymously to Vault.
   * Creates a new anonymous user session.
   */
  handle(
    "vault:auth-anonymous",
    async (): Promise<{
      success: boolean;
      error?: string;
      userId?: string;
    }> => {
      try {
        const session = await signInAnonymously();
        return { success: true, userId: session.userId };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Anonymous sign-in failed";
        logger.error(`Vault anonymous auth failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  /**
   * Auto-initialize Vault configuration from environment defaults.
   * Returns true if config was auto-populated.
   */
  handle(
    "vault:auto-init",
    async (): Promise<{ success: boolean; wasInitialized: boolean }> => {
      const wasInitialized = autoInitializeVaultConfig();
      return { success: true, wasInitialized };
    },
  );

  /**
   * Ensure Vault has a valid auth session.
   * Attempts auto-config and anonymous sign-in if needed.
   */
  handle(
    "vault:ensure-auth",
    async (): Promise<{
      success: boolean;
      error?: string;
      authStatus?: VaultAuthStatusResult;
    }> => {
      try {
        await ensureVaultAuth();
        const authStatus = getVaultAuthStatus();
        return { success: true, authStatus };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to establish auth";
        logger.error(`Vault ensure-auth failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
