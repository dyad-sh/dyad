import { withLock } from "../ipc/utils/lock_utils";
import { readSettings, writeSettings } from "../main/settings";
import { Api, createApiClient } from "@neondatabase/api-client";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { fetchWithRetry } from "../ipc/utils/retryWithRateLimit";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getNeonErrorMessage } from "./neon_errors";
import { getNeonOAuthErrorCode } from "./neon_oauth_errors";
import { publishQueryInvalidations } from "@/ipc/utils/query_invalidation_delivery";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { NEON_RECONNECT_REQUIRED_MESSAGE } from "@/shared/neon_auth";
import { z } from "zod";

const logger = log.scope("neon_management_client");
const refreshResponseSchema = z.object({
  accessToken: z.string().trim().min(1),
  refreshToken: z.string().trim().min(1).optional(),
  expiresIn: z.number().finite().positive(),
});

type NeonSettings = ReturnType<typeof readSettings>["neon"];
type NeonRequestConfig = Parameters<Api<unknown>["instance"]["request"]>[0] & {
  /** Set on the single retry after refreshing an access token that expired. */
  dyadNeonTokenRefreshed?: boolean;
};

/**
 * Checks if the Neon access token is expired or about to expire
 * Returns true if token needs to be refreshed
 */
function isTokenExpired(neon: NeonSettings): boolean {
  const expiresIn = neon?.expiresIn;
  if (!expiresIn) return true;

  // expiresIn is relative to when the token was saved.
  const tokenTimestamp = neon?.tokenTimestamp || 0;
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if the token is expired or about to expire (within 5 minutes)
  return currentTime >= tokenTimestamp + expiresIn - 300;
}

/**
 * Refreshes the Neon access token using the refresh token
 * Updates settings with new tokens and expiration time
 */
let refreshNeonTokenPromise: Promise<void> | null = null;

async function refreshNeonTokenOnce(): Promise<void> {
  const settings = readSettings();
  const refreshToken = settings.neon?.refreshToken?.value;

  if (settings.neon?.reconnectRequired) {
    throw new DyadError(NEON_RECONNECT_REQUIRED_MESSAGE, DyadErrorKind.Auth);
  }

  if (!isTokenExpired(settings.neon)) {
    return;
  }

  if (!refreshToken) {
    requireNeonReconnection("missing_refresh_token");
    throw new DyadError(NEON_RECONNECT_REQUIRED_MESSAGE, DyadErrorKind.Auth);
  }

  try {
    // Make request to Neon refresh endpoint. Use fetchWithRetry so a burst of
    // token refreshes (e.g. running several in-app tests back-to-back) backs
    // off on 429 instead of failing the whole flow.
    const response = await fetchWithRetry(
      "https://oauth.dyad.sh/api/integrations/neon/refresh",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      },
      "Refresh Neon token",
    );

    if (!response.ok) {
      const code = await getNeonOAuthErrorCode(response);
      // A sign-in or disconnect may have replaced the credentials while the
      // request was in flight. An old rejection must not poison the new session.
      if (!hasSameNeonCredentials(settings)) return;
      if (
        (response.status === 400 || response.status === 401) &&
        code === "invalid_grant"
      ) {
        requireNeonReconnection(code);
        throw new DyadError(
          NEON_RECONNECT_REQUIRED_MESSAGE,
          DyadErrorKind.Auth,
        );
      }
      throw new DyadError(
        `Neon token refresh failed (HTTP ${response.status}${code ? `, ${code}` : ""}). Please try again.`,
        DyadErrorKind.External,
      );
    }

    const refreshed = refreshResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!hasSameNeonCredentials(settings)) return;
    if (!refreshed.success) {
      throw new DyadError(
        "Neon token refresh returned an invalid response. Please try again.",
        DyadErrorKind.External,
      );
    }
    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = refreshed.data;

    // Update settings with new tokens
    writeSettings({
      neon: {
        ...readSettings().neon,
        accessToken: {
          value: accessToken,
        },
        refreshToken: {
          value: newRefreshToken ?? refreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000), // Store current timestamp
        reconnectRequired: false,
      },
    });
  } catch (error) {
    if (!hasSameNeonCredentials(settings)) return;
    logger.error("Error refreshing Neon token:", error);
    throw error;
  }
}

function hasSameNeonCredentials(
  previous: ReturnType<typeof readSettings>,
): boolean {
  const current = readSettings().neon;
  return (
    current?.refreshToken?.value === previous.neon?.refreshToken?.value &&
    current?.accessToken?.value === previous.neon?.accessToken?.value &&
    current?.tokenTimestamp === previous.neon?.tokenTimestamp
  );
}

/**
 * The Neon API rejected an access token that has not expired, for example
 * because the user revoked Dyad's access. Require reconnection only
 * while the rejected credentials are still the stored ones: a sign-in or
 * disconnect that landed while the request was in flight must win.
 */
function requireNeonReconnectionForRejectedCredentials(
  rejected: ReturnType<typeof readSettings>,
): void {
  if (!hasSameNeonCredentials(rejected)) return;
  requireNeonReconnection("access_token_rejected");
}

function requireNeonReconnection(
  reason: "invalid_grant" | "missing_refresh_token" | "access_token_rejected",
): void {
  const neon = readSettings().neon;
  if (!neon || neon.reconnectRequired) return;
  writeSettings({ neon: { ...neon, reconnectRequired: true } });
  publishQueryInvalidations([{ family: "provider-status", provider: "neon" }]);
  // One bounded, non-exception event per rejected credential set. Never send
  // token values or the OAuth server's arbitrary error_description.
  sendTelemetryEvent("neon:reconnect-required", { reason });
}

export function refreshNeonToken(): Promise<void> {
  if (!refreshNeonTokenPromise) {
    refreshNeonTokenPromise = refreshNeonTokenOnce().finally(() => {
      refreshNeonTokenPromise = null;
    });
  }
  return refreshNeonTokenPromise;
}

// Stable timestamp for mock branches so the apply-time staleness check in
// migration_handlers can run unconditionally (preview and apply observe the
// same value instead of two fresh `new Date()` calls reading as drift).
const MOCK_BRANCH_TIMESTAMP = "2024-01-01T00:00:00.000Z";

// Function to get the Neon API client
export async function getNeonClient(): Promise<Api<unknown>> {
  if (IS_TEST_BUILD) {
    const getMockBranchName = (branchId: string) => {
      switch (branchId) {
        case "test-main-branch-id":
          return "main";
        case "test-development-branch-id":
          return "development";
        case "test-preview-branch-id":
          return "preview";
        default:
          return branchId.replace(/^test-/, "").replace(/-branch-id$/, "");
      }
    };

    const getMockConnectionUri = (branchId: string) =>
      `postgresql://test:test@test-${getMockBranchName(branchId)}.neon.tech/test`;

    const getMockAuthBaseUrl = (branchId: string) =>
      `https://test-${getMockBranchName(branchId)}.neonauth.us-east-2.aws.neon.tech/neondb/auth`;

    // Return a mock client for testing
    return {
      createProject: async (params: any) => ({
        data: {
          project: {
            id: "test-project-id",
            name: params.project.name,
            region_id: "aws-us-east-1",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          branch: {
            id: "test-main-branch-id",
            name: "main",
            project_id: "test-project-id",
            default: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          connection_uris: [
            {
              connection_uri: getMockConnectionUri("test-main-branch-id"),
            },
          ],
        },
      }),
      createProjectBranch: async (projectId: string, params: any) => {
        const branchId = `test-${params.branch?.name || "child"}-branch-id`;
        return {
          data: {
            branch: {
              id: branchId,
              name: params.branch?.name || "development",
              project_id: projectId,
              // Schema-only branches are root branches.
              parent_id:
                params.branch?.init_source === "schema-only"
                  ? undefined
                  : params.branch?.parent_id || "test-main-branch-id",
              default: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            connection_uris: [
              {
                connection_uri: getMockConnectionUri(branchId),
              },
            ],
          },
        };
      },
      getProject: async (projectId: string) => ({
        data: {
          project: {
            id: projectId,
            name: "Test Project",
            org_id: "test-org-id",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      }),
      listProjectBranches: async ({ projectId }: { projectId: string }) => ({
        data: {
          branches: [
            {
              id: "test-main-branch-id",
              name: "main",
              project_id: projectId,
              created_at: MOCK_BRANCH_TIMESTAMP,
              updated_at: MOCK_BRANCH_TIMESTAMP,
              default: true,
            },
            {
              // A root branch, as Dyad creates it (see neon_dev_branch.ts).
              id: "test-development-branch-id",
              name: "development",
              project_id: projectId,
              created_at: MOCK_BRANCH_TIMESTAMP,
              updated_at: MOCK_BRANCH_TIMESTAMP,
              default: false,
            },
            {
              id: "test-preview-branch-id",
              name: "preview",
              project_id: projectId,
              parent_id: "test-development-branch-id",
              created_at: MOCK_BRANCH_TIMESTAMP,
              updated_at: MOCK_BRANCH_TIMESTAMP,
              default: false,
            },
          ],
        },
      }),
      listProjects: async () => ({
        data: {
          projects: [
            {
              id: "test-project-id",
              name: "Test Project",
              region_id: "aws-us-east-2",
              platform_id: "aws",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      }),
      listOrganizations: async () => ({
        data: {
          organizations: [
            {
              id: "test-org-id",
              name: "Test Organization",
            },
          ],
        },
      }),
      deleteProjectBranch: async (projectId: string, branchId: string) => ({
        data: {
          branch: {
            id: branchId,
            project_id: projectId,
          },
        },
      }),
      deleteProject: async (projectId: string) => ({
        data: { project: { id: projectId } },
      }),
      getNeonAuth: async (projectId: string, branchId: string) => ({
        data: {
          auth_provider: "better_auth",
          auth_provider_project_id: "test-auth-project-id",
          branch_id: branchId,
          db_name: "neondb",
          created_at: new Date().toISOString(),
          owned_by: "neon",
          jwks_url: "https://test.neon.tech/.well-known/jwks.json",
          base_url: getMockAuthBaseUrl(branchId),
        },
      }),
      createNeonAuth: async (
        projectId: string,
        branchId: string,
        data: any,
      ) => ({
        data: {
          auth_provider: data.auth_provider || "better_auth",
          auth_provider_project_id: "test-auth-project-id",
          pub_client_key: "test-pub-key",
          secret_server_key: "test-secret-key",
          jwks_url: "https://test.neon.tech/.well-known/jwks.json",
          schema_name: "neon_auth",
          table_name: "users",
          base_url: getMockAuthBaseUrl(branchId),
        },
      }),
      listBranchNeonAuthTrustedDomains: async (
        _projectId: string,
        _branchId: string,
      ) => ({
        data: {
          domains: [] as Array<{ domain: string; auth_provider: string }>,
        },
      }),
      addBranchNeonAuthTrustedDomain: async (
        _projectId: string,
        _branchId: string,
        _data: any,
      ) => ({
        data: undefined,
      }),
      listProjectBranchRoles: async () => ({
        data: {
          roles: [{ name: "neondb_owner", protected: false }],
        },
      }),
      listProjectBranchDatabases: async () => ({
        data: {
          databases: [{ name: "neondb" }],
        },
      }),
      getConnectionUri: async (params: any) => ({
        data: {
          uri: getMockConnectionUri(params.branch_id),
        },
      }),
      getProjectBranch: async (projectId: string, branchId: string) => ({
        data: {
          branch: {
            id: branchId,
            project_id: projectId,
            name: getMockBranchName(branchId),
            default: branchId === "test-main-branch-id",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      }),
      getNeonAuthEmailAndPasswordConfig: async (
        _projectId: string,
        _branchId: string,
      ) => ({
        data: {
          enabled: true,
          email_verification_method: "otp",
          require_email_verification: false,
          auto_sign_in_after_verification: true,
          send_verification_email_on_sign_up: false,
          send_verification_email_on_sign_in: false,
          disable_sign_up: false,
        },
      }),
      updateNeonAuthEmailAndPasswordConfig: async (
        _projectId: string,
        _branchId: string,
        data: any,
      ) => ({
        data: {
          enabled: true,
          email_verification_method: "otp",
          require_email_verification: data.require_email_verification ?? false,
          auto_sign_in_after_verification: true,
          send_verification_email_on_sign_up:
            data.send_verification_email_on_sign_up ?? false,
          send_verification_email_on_sign_in: false,
          disable_sign_up: false,
        },
      }),
    } as unknown as Api<unknown>;
  }

  const settings = readSettings();

  // Check if Neon token exists in settings
  if (settings.neon?.reconnectRequired) {
    throw new DyadError(NEON_RECONNECT_REQUIRED_MESSAGE, DyadErrorKind.Auth);
  }
  const neonAccessToken = settings.neon?.accessToken?.value;

  if (!neonAccessToken) {
    throw new DyadError(
      "Neon access token not found. Please authenticate first.",
      DyadErrorKind.Auth,
    );
  }

  // Check if token needs refreshing
  if (isTokenExpired(settings.neon)) {
    await withLock("refresh-neon-token", refreshNeonToken);
    // Get updated settings after refresh
    const updatedSettings = readSettings();
    const newAccessToken = updatedSettings.neon?.accessToken?.value;

    if (!newAccessToken) {
      throw new DyadError(
        "Failed to refresh Neon access token",
        DyadErrorKind.Auth,
      );
    }

    return createNeonApiClient(newAccessToken, updatedSettings);
  }

  return createNeonApiClient(neonAccessToken, settings);
}

/**
 * Every Neon API call goes through this client, so a revoked token is
 * detected wherever it is first used (project discovery, branches,
 * migrations, env sync, agent tools), not only on one screen. `credentials`
 * are the settings the client was built from, so a 401 is attributed to them
 * rather than to a sign-in that completed mid-request.
 */
export function createNeonApiClient(
  accessToken: string,
  credentials: ReturnType<typeof readSettings>,
): Api<unknown> {
  const client = createApiClient({
    apiKey: accessToken,
    baseURL: getNeonApiBaseUrl(),
  });
  client.instance.interceptors.response.use(
    undefined,
    async (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status !== 401) throw error;
      if (!isTokenExpired(credentials.neon)) {
        // Neon rejected a token that has not expired (for example, because
        // the user revoked Dyad's access).
        requireNeonReconnectionForRejectedCredentials(credentials);
        throw new DyadError(
          NEON_RECONNECT_REQUIRED_MESSAGE,
          DyadErrorKind.Auth,
        );
      }
      // getNeonClient() checks expiry only when it builds a client, so a
      // client held across long work (such as a dev-branch migration) can
      // outlive its token. The refresh token may still be valid: refresh and
      // retry once instead of discarding the session.
      const config = (error as { config?: NeonRequestConfig }).config;
      if (!config || config.dyadNeonTokenRefreshed) {
        throw new DyadError(
          "The Neon access token expired during the request. Please try again.",
          DyadErrorKind.External,
        );
      }
      // Throws the reconnect error itself when the refresh grant is rejected.
      await withLock("refresh-neon-token", refreshNeonToken);
      const refreshed = readSettings();
      const refreshedToken = refreshed.neon?.accessToken?.value;
      if (!refreshedToken) {
        throw new DyadError(
          "Neon access token not found. Please authenticate first.",
          DyadErrorKind.Auth,
        );
      }
      // A client built from the refreshed settings attributes a 401 on the
      // retry to the new credentials.
      const retry: NeonRequestConfig = {
        ...config,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${refreshedToken}`,
        },
        dyadNeonTokenRefreshed: true,
      };
      return createNeonApiClient(refreshedToken, refreshed).instance.request(
        retry,
      );
    },
  );
  return client;
}

// Overridable so benchmarks/tests can point the management client at a local
// Neon API stand-in; undefined preserves the SDK default (console.neon.tech).
function getNeonApiBaseUrl(): string | undefined {
  return process.env.DYAD_NEON_API_BASE_URL || undefined;
}

/**
 * Get the user's first organization ID from Neon
 */
export async function getNeonOrganizationId(): Promise<string> {
  const neonClient = await getNeonClient();

  if (IS_TEST_BUILD) {
    return "test-org-id";
  }

  try {
    const response = await neonClient.getCurrentUserOrganizations();

    if (
      !response.data?.organizations ||
      response.data.organizations.length === 0
    ) {
      throw new DyadError(
        "No organizations found for this Neon account",
        DyadErrorKind.NotFound,
      );
    }

    // Return the first organization ID
    return response.data.organizations[0].id;
  } catch (error) {
    logger.error("Error fetching Neon organizations:", error);
    // Keep classified errors, such as a rejected token's reconnect prompt.
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      "Failed to fetch Neon organizations",
      DyadErrorKind.External,
    );
  }
}

// Pure error-parsing helpers live in ./neon_errors so they can be unit-tested
// without importing the full management client. Re-exported here so existing
// importers of neon_management_client keep working unchanged.
export {
  getNeonErrorMessage,
  isBranchLimitError,
  isRetentionWindowError,
  getRetentionWindowFromError,
} from "./neon_errors";

const DEFAULT_EMAIL_PASSWORD_CONFIG = {
  enabled: false,
  email_verification_method: "otp" as const,
  require_email_verification: false,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: false,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

type EmailPasswordConfig = typeof DEFAULT_EMAIL_PASSWORD_CONFIG;

const EMAIL_PASSWORD_CONFIG_TTL_MS = 60_000;

const emailPasswordConfigCache = new Map<
  string,
  { data: EmailPasswordConfig; expiry: number }
>();

export function invalidateEmailPasswordConfigCache(
  projectId: string,
  branchId: string,
): void {
  emailPasswordConfigCache.delete(`${projectId}:${branchId}`);
}

export async function getCachedEmailPasswordConfig(
  projectId: string,
  branchId: string,
): Promise<EmailPasswordConfig> {
  const key = `${projectId}:${branchId}`;
  const cached = emailPasswordConfigCache.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  const neonClient = await getNeonClient();
  try {
    const response = await neonClient.getNeonAuthEmailAndPasswordConfig(
      projectId,
      branchId,
    );
    const data = response.data as EmailPasswordConfig;
    emailPasswordConfigCache.set(key, {
      data,
      expiry: Date.now() + EMAIL_PASSWORD_CONFIG_TTL_MS,
    });
    return data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      emailPasswordConfigCache.set(key, {
        data: DEFAULT_EMAIL_PASSWORD_CONFIG,
        expiry: Date.now() + EMAIL_PASSWORD_CONFIG_TTL_MS,
      });
      return DEFAULT_EMAIL_PASSWORD_CONFIG;
    }
    logger.error(
      "Failed to fetch Neon Auth email/password config:",
      getNeonErrorMessage(error),
    );
    throw error;
  }
}
