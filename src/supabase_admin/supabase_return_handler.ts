import { readSettings, writeSettings } from "../main/settings";
import { listSupabaseOrganizations } from "./supabase_management_client";
import log from "electron-log";
import { withLock } from "../ipc/utils/lock_utils";

const logger = log.scope("supabase_return_handler");

export interface SupabaseOAuthReturnParams {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Handles OAuth return by storing organization credentials.
 * When organizations are returned, credentials are stored for each organization
 * slug so app-to-org links remain valid across multiple connected apps.
 * If organizations cannot be fetched, it falls back to legacy fields.
 */
export async function handleSupabaseOAuthReturn({
  token,
  refreshToken,
  expiresIn,
}: SupabaseOAuthReturnParams) {
  let orgs: any[] = [];
  let errorOccurred = false;

  try {
    orgs = await listSupabaseOrganizations(token);
  } catch (error) {
    logger.error("Error listing Supabase organizations:", error);
    errorOccurred = true;
  }

  if (!errorOccurred && orgs.length > 0) {
    const organizationEntries = Object.fromEntries(
      orgs
        .map((org) => org.slug)
        .filter((slug): slug is string => typeof slug === "string" && !!slug)
        .map((organizationSlug) => [
          organizationSlug,
          {
            accessToken: {
              value: token,
            },
            refreshToken: {
              value: refreshToken,
            },
            expiresIn,
            tokenTimestamp: Math.floor(Date.now() / 1000),
          },
        ]),
    );

    if (Object.keys(organizationEntries).length === 0) {
      logger.warn(
        "Supabase OAuth returned organizations without valid slugs; falling back to legacy token storage",
      );
      await writeLegacyTokens(token, refreshToken, expiresIn);
      return;
    }

    await withLock("supabase-settings", async () => {
      const latestSettings = readSettings();
      const latestOrgs = latestSettings.supabase?.organizations ?? {};
      writeSettings({
        supabase: {
          ...latestSettings.supabase,
          organizations: {
            ...latestOrgs,
            ...organizationEntries,
          },
        },
      });
    });
  } else {
    await writeLegacyTokens(token, refreshToken, expiresIn);
  }
}

async function writeLegacyTokens(
  token: string,
  refreshToken: string,
  expiresIn: number,
) {
  await withLock("supabase-settings", async () => {
    const latestSettings = readSettings();
    writeSettings({
      supabase: {
        ...latestSettings.supabase,
        accessToken: {
          value: token,
        },
        refreshToken: {
          value: refreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
  });
}
