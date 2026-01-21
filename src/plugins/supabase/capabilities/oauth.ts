/**
 * Supabase OAuth Capability
 *
 * Handles OAuth authentication with Supabase, including multi-organization support.
 */

import log from "electron-log";
import { readSettings, writeSettings } from "../../../main/settings";
import { withLock } from "../../../ipc/utils/lock_utils";
import {
  SupabaseManagementAPI,
  SupabaseManagementAPIError,
} from "@dyad-sh/supabase-management-js";
import { fetchWithRetry } from "../../../ipc/utils/retryWithRateLimit";
import { IS_TEST_BUILD } from "../../../ipc/utils/test_utils";
import type {
  OAuthCapability,
  OAuthReturnParams,
  RefreshTokenParams,
  TokenResponse,
  PluginAccount,
} from "../../types";
import type { SupabaseOrganizationCredentials } from "../../../lib/schemas";

const logger = log.scope("supabase_plugin_oauth");

const SUPABASE_OAUTH_BASE_URL = "https://supabase-oauth.dyad.sh";
const SUPABASE_API_BASE_URL = "https://api.supabase.com/v1";

// ─────────────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────────────

/**
 * Check if an organization's token is expired or about to expire.
 */
function isOrganizationTokenExpired(
  org: SupabaseOrganizationCredentials,
): boolean {
  if (!org.expiresIn || !org.tokenTimestamp) return true;

  const currentTime = Math.floor(Date.now() / 1000);
  // Check if the token is expired or about to expire (within 5 minutes)
  return currentTime >= org.tokenTimestamp + org.expiresIn - 300;
}

/**
 * Refresh the Supabase access token for a specific organization.
 */
async function refreshSupabaseTokenForOrganization(
  organizationSlug: string,
): Promise<TokenResponse> {
  const settings = readSettings();
  const org = settings.supabase?.organizations?.[organizationSlug];

  if (!org) {
    throw new Error(
      `Supabase organization ${organizationSlug} not found. Please authenticate first.`,
    );
  }

  const refreshToken = org.refreshToken?.value;
  if (!refreshToken) {
    throw new Error(
      "Supabase refresh token not found. Please authenticate first.",
    );
  }

  const response = await fetch(
    `${SUPABASE_OAUTH_BASE_URL}/api/connect-supabase/refresh`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Supabase token refresh failed. Try going to Settings to disconnect Supabase and then reconnect. Error status: ${response.statusText}`,
    );
  }

  const {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
  } = await response.json();

  // Update the specific organization in settings
  const existingOrgs = settings.supabase?.organizations ?? {};
  writeSettings({
    supabase: {
      ...settings.supabase,
      organizations: {
        ...existingOrgs,
        [organizationSlug]: {
          ...org,
          accessToken: { value: accessToken },
          refreshToken: { value: newRefreshToken },
          expiresIn,
          tokenTimestamp: Math.floor(Date.now() / 1000),
        },
      },
    },
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
  };
}

/**
 * Get a Supabase Management API client for a specific organization.
 */
export async function getSupabaseClientForOrganization(
  organizationSlug: string,
): Promise<SupabaseManagementAPI> {
  const settings = readSettings();
  const org = settings.supabase?.organizations?.[organizationSlug];

  if (!org) {
    throw new Error(
      `Supabase organization ${organizationSlug} not found. Please authenticate first.`,
    );
  }

  let accessToken = org.accessToken?.value;
  if (!accessToken) {
    throw new Error(
      `Supabase access token not found for organization ${organizationSlug}. Please authenticate first.`,
    );
  }

  // Check if token needs refreshing
  if (isOrganizationTokenExpired(org)) {
    const tokens = await withLock(
      `refresh-supabase-token-${organizationSlug}`,
      () => refreshSupabaseTokenForOrganization(organizationSlug),
    );
    accessToken = tokens.accessToken;
  }

  return new SupabaseManagementAPI({ accessToken });
}

/**
 * Get organization details from the Supabase API.
 */
async function getOrganizationDetails(
  organizationSlug: string,
): Promise<{ id: string; name: string; slug: string }> {
  if (IS_TEST_BUILD) {
    return {
      id: organizationSlug,
      name: "Fake Organization",
      slug: "fake-org",
    };
  }

  const client = await getSupabaseClientForOrganization(organizationSlug);
  const accessToken = (client as any).options.accessToken;

  const response = await fetchWithRetry(
    `${SUPABASE_API_BASE_URL}/organizations/${organizationSlug}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    `Get organization details for ${organizationSlug}`,
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organization details (${response.status}): ${errorText}`,
    );
    throw new SupabaseManagementAPIError(
      `Failed to fetch organization details: ${response.statusText}`,
      response,
    );
  }

  const org = await response.json();
  return { id: org.id, name: org.name, slug: org.slug };
}

/**
 * Get organization members from the Supabase API.
 */
async function getOrganizationMembers(
  organizationSlug: string,
): Promise<Array<{ userId: string; email: string; role: string }>> {
  if (IS_TEST_BUILD) {
    return [
      {
        userId: "fake-user-id",
        email: "owner@example.com",
        role: "Owner",
      },
    ];
  }

  const client = await getSupabaseClientForOrganization(organizationSlug);
  const accessToken = (client as any).options.accessToken;

  const response = await fetchWithRetry(
    `${SUPABASE_API_BASE_URL}/organizations/${organizationSlug}/members`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    `Get organization members for ${organizationSlug}`,
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organization members (${response.status}): ${errorText}`,
    );
    throw new SupabaseManagementAPIError(
      `Failed to fetch organization members: ${response.statusText}`,
      response,
    );
  }

  const members = await response.json();
  return members.map((m: any) => ({
    userId: m.user_id,
    email: m.primary_email || m.email,
    role: m.role_name,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// OAuth Capability Implementation
// ─────────────────────────────────────────────────────────────────────

export function createOAuthCapability(): OAuthCapability {
  return {
    getAuthUrl: () => {
      return `${SUPABASE_OAUTH_BASE_URL}/api/connect-supabase/login`;
    },

    handleOAuthReturn: async (params: OAuthReturnParams) => {
      const { accessToken, refreshToken, expiresIn, accountId } = params;

      if (!accountId) {
        throw new Error("Organization slug (accountId) is required");
      }

      const settings = readSettings();
      const existingOrgs = settings.supabase?.organizations ?? {};

      writeSettings({
        supabase: {
          ...settings.supabase,
          organizations: {
            ...existingOrgs,
            [accountId]: {
              accessToken: { value: accessToken },
              refreshToken: { value: refreshToken },
              expiresIn,
              tokenTimestamp: Math.floor(Date.now() / 1000),
            },
          },
        },
      });

      logger.info(`Stored Supabase credentials for organization ${accountId}`);
    },

    refreshToken: async (params: RefreshTokenParams): Promise<TokenResponse> => {
      return refreshSupabaseTokenForOrganization(params.accountId);
    },

    isAuthenticated: (): boolean => {
      const settings = readSettings();
      const organizations = settings.supabase?.organizations ?? {};
      return Object.keys(organizations).length > 0;
    },

    listAccounts: async (): Promise<PluginAccount[]> => {
      const settings = readSettings();
      const organizations = settings.supabase?.organizations ?? {};
      const results: PluginAccount[] = [];

      for (const organizationSlug of Object.keys(organizations)) {
        try {
          const [details, members] = await Promise.all([
            getOrganizationDetails(organizationSlug),
            getOrganizationMembers(organizationSlug),
          ]);

          const owner = members.find((m) => m.role === "Owner");

          results.push({
            id: organizationSlug,
            name: details.name,
            email: owner?.email,
          });
        } catch (error) {
          logger.error(
            `Failed to fetch details for organization ${organizationSlug}:`,
            error,
          );
          // Still include the org with just the ID
          results.push({ id: organizationSlug });
        }
      }

      return results;
    },

    disconnectAccount: async (accountId: string): Promise<void> => {
      const settings = readSettings();
      const organizations = { ...settings.supabase?.organizations };

      if (!organizations[accountId]) {
        throw new Error(`Supabase organization ${accountId} not found`);
      }

      delete organizations[accountId];

      writeSettings({
        supabase: {
          ...settings.supabase,
          organizations,
        },
      });

      logger.info(`Deleted Supabase organization ${accountId}`);
    },
  };
}

// Re-export for backward compatibility
export { getSupabaseClientForOrganization as getSupabaseClient };
