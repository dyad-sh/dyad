import { readSettings, writeSettings } from "../main/settings";
import { listSupabaseOrganizations } from "./supabase_management_client";
import log from "electron-log";

const logger = log.scope("supabase_return_handler");

export interface SupabaseOAuthReturnParams {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Handles OAuth return by storing organization credentials.
 * If exactly one organization is found, it's stored in the organizations map.
 * Otherwise, it falls back to legacy fields.
 */
export async function handleSupabaseOAuthReturn({
  token,
  refreshToken,
  expiresIn,
}: SupabaseOAuthReturnParams) {
  const settings = readSettings();
  let orgs: any[] = [];
  let errorOccurred = false;

  try {
    orgs = await listSupabaseOrganizations(token);
  } catch (error) {
    logger.error("Error listing Supabase organizations:", error);
    errorOccurred = true;
  }

  if (!errorOccurred && orgs.length > 0) {
    if (orgs.length > 1) {
      logger.warn(
        "Multiple Supabase organizations found unexpectedly, using the first one",
      );
    }
    const organizationSlug = orgs[0].slug;
    const existingOrgs = settings.supabase?.organizations ?? {};

    writeSettings({
      supabase: {
        ...settings.supabase,
        organizations: {
          ...existingOrgs,
          [organizationSlug]: {
            accessToken: {
              value: token,
            },
            refreshToken: {
              value: refreshToken,
            },
            expiresIn,
            tokenTimestamp: Math.floor(Date.now() / 1000),
          },
        },
      },
    });
  } else {
    // Fallback to legacy fields
    writeSettings({
      supabase: {
        ...settings.supabase,
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
  }
}
