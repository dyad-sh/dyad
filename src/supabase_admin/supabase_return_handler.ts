import { readSettings, writeSettings } from "../main/settings";
import { buildSupabaseAccountKey } from "./supabase_account_key";

export interface SupabaseOAuthReturnParams {
  token: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
  organizationId: string;
  organizationName?: string;
  userEmail?: string;
}

/**
 * Handles OAuth return by storing account credentials keyed by userId:organizationId.
 */
export function handleSupabaseOAuthReturn({
  token,
  refreshToken,
  expiresIn,
  userId,
  organizationId,
  organizationName,
  userEmail,
}: SupabaseOAuthReturnParams) {
  const settings = readSettings();
  const accountKey = buildSupabaseAccountKey(userId, organizationId);

  // Get existing accounts or initialize empty map
  const existingAccounts = settings.supabase?.accounts ?? {};

  writeSettings({
    supabase: {
      ...settings.supabase,
      accounts: {
        ...existingAccounts,
        [accountKey]: {
          userId,
          organizationId,
          organizationName,
          userEmail,
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
}
