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

// Function to get the Neon API client
export async function getNeonClient(): Promise<Api<unknown>> {
  if (IS_TEST_BUILD) {
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
              connection_uri: "postgresql://test:test@test.neon.tech/test",
            },
          ],
        },
      }),
      createProjectBranch: async (projectId: string, params: any) => ({
        data: {
          branch: {
            id: `test-${params.branch?.name || "child"}-branch-id`,
            name: params.branch?.name || "development",
            project_id: projectId,
            parent_id: params.branch?.parent_id || "test-main-branch-id",
            default: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          connection_uris: [
            {
              connection_uri: `postgresql://test:test@test-${params.branch?.name || "child"}.neon.tech/test`,
            },
          ],
        },
      }),
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
      listProjectBranches: async (projectId: string) => ({
        data: {
          branches: [
            {
              id: "test-main-branch-id",
              name: "main",
              project_id: projectId,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              default: true,
            },
            {
              id: "test-development-branch-id",
              name: "development",
              project_id: projectId,
              parent_id: "test-main-branch-id",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              default: false,
            },
            {
              id: "test-preview-branch-id",
              name: "preview",
              project_id: projectId,
              parent_id: "test-development-branch-id",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
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
      getNeonAuth: async (projectId: string, branchId: string) => ({
        data: {
          auth_provider: "better_auth",
          auth_provider_project_id: "test-auth-project-id",
          branch_id: branchId,
          db_name: "neondb",
          created_at: new Date().toISOString(),
          owned_by: "neon",
          jwks_url: "https://test.neon.tech/.well-known/jwks.json",
          base_url:
            "https://ep-test.neonauth.us-east-2.aws.neon.tech/neondb/auth",
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
          base_url:
            "https://ep-test.neonauth.us-east-2.aws.neon.tech/neondb/auth",
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

export function getNeonErrorMessage(error: any): string {
  const detailedMessage = error.response?.data?.message ?? "";
  return error.message + " " + detailedMessage;
}
