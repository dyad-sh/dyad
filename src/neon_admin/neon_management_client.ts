import { withLock } from "../ipc/utils/lock_utils";
import { readSettings, writeSettings } from "../main/settings";
import { Api, createApiClient } from "@neondatabase/api-client";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("neon_management_client");

/**
 * Checks if the Neon access token is expired or about to expire
 * Returns true if token needs to be refreshed
 */
function isTokenExpired(expiresIn?: number): boolean {
  if (!expiresIn) return true;

  // Get when the token was saved (expiresIn is stored at the time of token receipt)
  const settings = readSettings();
  const tokenTimestamp = settings.neon?.tokenTimestamp || 0;
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if the token is expired or about to expire (within 5 minutes)
  return currentTime >= tokenTimestamp + expiresIn - 300;
}

/**
 * Refreshes the Neon access token using the refresh token
 * Updates settings with new tokens and expiration time
 */
export async function refreshNeonToken(): Promise<void> {
  const settings = readSettings();
  const refreshToken = settings.neon?.refreshToken?.value;

  if (!isTokenExpired(settings.neon?.expiresIn)) {
    return;
  }

  if (!refreshToken) {
    throw new DyadError(
      "Neon refresh token not found. Please authenticate first.",
      DyadErrorKind.Auth,
    );
  }

  try {
    // Make request to Neon refresh endpoint
    const response = await fetch(
      "https://oauth.dyad.sh/api/integrations/neon/refresh",

      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      },
    );

    if (!response.ok) {
      throw new DyadError(
        `Token refresh failed: ${response.statusText}`,
        DyadErrorKind.External,
      );
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await response.json();

    // Update settings with new tokens
    writeSettings({
      neon: {
        accessToken: {
          value: accessToken,
        },
        refreshToken: {
          value: newRefreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000), // Store current timestamp
      },
    });
  } catch (error) {
    logger.error("Error refreshing Neon token:", error);
    throw error;
  }
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
              parent_id: params.branch?.parent_id || "test-main-branch-id",
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
              id: "test-development-branch-id",
              name: "development",
              project_id: projectId,
              parent_id: "test-main-branch-id",
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
            default: false,
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
  const neonAccessToken = settings.neon?.accessToken?.value;
  const expiresIn = settings.neon?.expiresIn;

  if (!neonAccessToken) {
    throw new DyadError(
      "Neon access token not found. Please authenticate first.",
      DyadErrorKind.Auth,
    );
  }

  // Check if token needs refreshing
  if (isTokenExpired(expiresIn)) {
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

    return createApiClient({
      apiKey: newAccessToken,
    });
  }

  return createApiClient({
    apiKey: neonAccessToken,
  });
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
    throw new DyadError(
      "Failed to fetch Neon organizations",
      DyadErrorKind.External,
    );
  }
}

export function getNeonErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : null;
  const detailedMessage =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
      ? error.response.data.message
      : null;

  if (message && detailedMessage) {
    return `${message} ${detailedMessage}`;
  }
  if (message) {
    return message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error == null) {
    return "Unknown Neon error";
  }

  try {
    const serializedError = JSON.stringify(error);
    return serializedError && serializedError !== "{}"
      ? serializedError
      : "Unknown Neon error";
  } catch {
    return String(error);
  }
}

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
