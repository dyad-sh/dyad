import crypto from "node:crypto";
import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { fetchWithRetry } from "@/ipc/utils/retryWithRateLimit";

const logger = log.scope("neon_test_account");

/** Credentials for a throwaway Better Auth account on a Neon test branch. */
export interface NeonTestAccount {
  email: string;
  password: string;
}

/**
 * Provision a throwaway Better Auth account on a Neon test branch so auth-gated
 * recordings and test runs can sign in without the user recording a login.
 *
 * This is safe precisely because the branch is a copy-on-write throwaway that is
 * deleted at teardown: the account only ever exists on the isolated branch, so a
 * later run (a fresh branch) never sees it, and it is created through Better
 * Auth's own signup endpoint — never by inserting into auth tables, which
 * commonly produces a user that exists but cannot log in.
 *
 * Throws `DyadError` when signup is rejected (e.g. email verification is
 * required); callers treat that as "auth unavailable" and record/run
 * unauthenticated rather than failing the whole flow.
 */
export async function createNeonTestAccount({
  neonAuthBaseUrl,
  appId,
}: {
  neonAuthBaseUrl: string;
  appId: number;
}): Promise<NeonTestAccount> {
  const email = `dyad-test+${appId}-${Date.now()}@dyad.test`;
  const password = crypto.randomBytes(24).toString("base64url");

  if (IS_TEST_BUILD) {
    // Don't hit the network in Dyad's own E2E build.
    return { email, password };
  }

  const base = neonAuthBaseUrl.replace(/\/+$/, "");
  const response = await fetchWithRetry(
    `${base}/sign-up/email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dyad Test User", email, password }),
    },
    `Create Neon test account for app ${appId}`,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DyadError(
      `Better Auth rejected the test-account signup (${response.status}). ${detail}`.trim(),
      DyadErrorKind.External,
    );
  }
  logger.info(`Created Neon Better Auth test account for app ${appId}`);
  return { email, password };
}
