import { createHash } from "node:crypto";
import { Vercel } from "@vercel/sdk";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { readSettings } from "../../main/settings";
import { NeonAuthSupportedAuthProvider } from "@neondatabase/api-client";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { getConnectionUri } from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "./test_utils";
import {
  ensureNeonAuth,
  getOrCreateNeonAuthCookieSecret,
  type NeonBranchType,
} from "./neon_utils";
import { getProductionBranchId } from "./migration_utils";
import type { VercelSyncPlan } from "../types/vercel";

const logger = log.scope("vercel_sync_utils");

type AppRow = typeof apps.$inferSelect;

const NEON_ENV_KEYS = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
] as const;

type NeonEnvKey = (typeof NEON_ENV_KEYS)[number];

const ENV_TARGETS = ["production", "preview", "development"] as const;

/**
 * Pick the Neon branch ID to source env vars / trusted domain from, based on
 * the user's `databaseUrlBranchType` selection. Production uses Neon's default
 * branch (resolved via the API), development uses the dedicated dev branch.
 */
export async function resolveBranchForSync({
  app,
}: {
  app: AppRow;
}): Promise<{ branchId: string; branchType: NeonBranchType }> {
  if (!app.neonProjectId) {
    throw new DyadError(
      "This app is not connected to a Neon project.",
      DyadErrorKind.Precondition,
    );
  }

  const branchType: NeonBranchType =
    app.databaseUrlBranchType === "production" ? "production" : "development";

  if (branchType === "production") {
    const result = await getProductionBranchId(app.neonProjectId);
    return { branchId: result.branchId, branchType };
  }

  if (!app.neonDevelopmentBranchId) {
    throw new DyadError(
      "This app has no Neon development branch.",
      DyadErrorKind.Precondition,
    );
  }
  return { branchId: app.neonDevelopmentBranchId, branchType };
}

/**
 * Build the values for the three Neon env vars that get pushed to Vercel.
 * Reuses the same helpers that auto-inject .env.local so values stay in sync.
 */
async function buildNeonEnvValues({
  app,
  branchId,
  branchType,
}: {
  app: AppRow;
  branchId: string;
  branchType: NeonBranchType;
}): Promise<Record<NeonEnvKey, string | undefined>> {
  const projectId = app.neonProjectId!;
  const [connectionUri, authBaseUrl] = await Promise.all([
    getConnectionUri({ projectId, branchId }),
    ensureNeonAuth({ projectId, branchId }).catch((error) => {
      logger.warn(
        `ensureNeonAuth failed during sync plan build for app ${app.id}: ${error}`,
      );
      return undefined;
    }),
  ]);

  let cookieSecret: string | undefined;
  if (authBaseUrl) {
    cookieSecret = await getOrCreateNeonAuthCookieSecret({
      appData: app,
      branchType,
    });
  }

  return {
    DATABASE_URL: connectionUri,
    NEON_AUTH_BASE_URL: authBaseUrl,
    NEON_AUTH_COOKIE_SECRET: cookieSecret,
  };
}

/**
 * Stable hash over the env-var set + trusted domain, used for drift detection.
 * Sorted keys so the hash is order-independent.
 */
export function computeSyncHash({
  envVars,
  trustedDomain,
}: {
  envVars: Array<{ key: string; value: string }>;
  trustedDomain: string | null;
}): string {
  const sorted = [...envVars].sort((a, b) => a.key.localeCompare(b.key));
  const payload = JSON.stringify({ envVars: sorted, trustedDomain });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Fetch the project's primary `*.vercel.app` domain. Used as a fallback when
 * `app.vercelDeploymentUrl` is null (e.g. between project creation and first
 * deploy completion).
 */
export async function getPrimaryProjectDomain({
  vercel,
  projectId,
}: {
  vercel: Vercel;
  projectId: string;
}): Promise<string | null> {
  try {
    const response = await vercel.projects.getProjectDomains({
      idOrName: projectId,
    });
    return response.domains?.[0]?.name ?? null;
  } catch (error) {
    logger.warn(`getProjectDomains failed for ${projectId}: ${error}`);
    return null;
  }
}

/**
 * Build the sync plan that the summary card renders. Reads everything needed
 * to push to Vercel + Neon, but performs no writes itself.
 */
export async function buildSyncPlan({
  vercel,
  app,
}: {
  vercel: Vercel;
  app: AppRow;
}): Promise<VercelSyncPlan> {
  if (!app.vercelProjectId || !app.vercelProjectName) {
    throw new DyadError(
      "App is not linked to a Vercel project.",
      DyadErrorKind.Precondition,
    );
  }

  const { branchId, branchType } = await resolveBranchForSync({ app });
  const values = await buildNeonEnvValues({ app, branchId, branchType });

  const envVars = NEON_ENV_KEYS.filter((key) => values[key] != null).map(
    (key) => ({
      key,
      value: values[key]!,
      targets: [...ENV_TARGETS] as Array<(typeof ENV_TARGETS)[number]>,
    }),
  );

  let domain: string | null = null;
  if (app.vercelDeploymentUrl) {
    domain = stripProtocol(app.vercelDeploymentUrl);
  } else {
    domain = await getPrimaryProjectDomain({
      vercel,
      projectId: app.vercelProjectId,
    });
  }

  const trustedDomain = domain ? { domain, branchId } : null;
  const currentHash = computeSyncHash({
    envVars: envVars.map(({ key, value }) => ({ key, value })),
    trustedDomain: trustedDomain?.domain ?? null,
  });

  return {
    envVars,
    trustedDomain,
    vercelProjectName: app.vercelProjectName,
    branchType,
    currentHash,
    isFirstSync: app.vercelLastSyncedHash == null,
    branchTypeChanged:
      app.vercelLastSyncedBranchType != null &&
      app.vercelLastSyncedBranchType !== branchType,
  };
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * Vercel SDK `filterProjectEnvs` returns a polymorphic body; in practice all
 * variants expose an `envs` array. Cast through `unknown` to extract it
 * without depending on the long union of generated types.
 */
function extractEnvs(response: unknown): Array<{ id?: string; key?: string }> {
  if (
    response &&
    typeof response === "object" &&
    "envs" in response &&
    Array.isArray((response as { envs: unknown[] }).envs)
  ) {
    return (response as { envs: Array<{ id?: string; key?: string }> }).envs;
  }
  return [];
}

/**
 * Push the env vars to Vercel. Strategy:
 * 1. List existing envs on the project.
 * 2. Delete any existing entry that matches one of our keys (covers value
 *    changes and stale entries from prior syncs / manual edits).
 * 3. Create the new entries with `upsert: "true"` so a race against another
 *    process can't break us.
 */
export async function applyVercelEnvVars({
  vercel,
  projectId,
  envVars,
}: {
  vercel: Vercel;
  projectId: string;
  envVars: Array<{ key: string; value: string; targets: readonly string[] }>;
}): Promise<void> {
  if (envVars.length === 0) return;

  const keys = new Set(envVars.map((v) => v.key));
  const existing = extractEnvs(
    await vercel.projects.filterProjectEnvs({ idOrName: projectId }),
  );

  for (const env of existing) {
    if (env.id && env.key && keys.has(env.key)) {
      try {
        await vercel.projects.removeProjectEnv({
          idOrName: projectId,
          id: env.id,
        });
      } catch (error) {
        logger.warn(
          `Failed to remove existing env var ${env.key} (${env.id}) for project ${projectId}: ${error}`,
        );
      }
    }
  }

  await vercel.projects.createProjectEnv({
    idOrName: projectId,
    upsert: "true",
    requestBody: envVars.map((v) => ({
      key: v.key,
      value: v.value,
      type: "encrypted",
      target: v.targets as Array<"production" | "preview" | "development">,
    })),
  });
}

/**
 * Remove the Neon-related env vars from Vercel. Used by the disconnect-Neon
 * flow. Best-effort: logs and continues on per-key errors.
 */
export async function removeNeonEnvVarsFromVercel({
  vercel,
  projectId,
}: {
  vercel: Vercel;
  projectId: string;
}): Promise<void> {
  const targetKeys = new Set<string>(NEON_ENV_KEYS);
  const existing = extractEnvs(
    await vercel.projects.filterProjectEnvs({ idOrName: projectId }),
  );

  for (const env of existing) {
    if (env.id && env.key && targetKeys.has(env.key)) {
      try {
        await vercel.projects.removeProjectEnv({
          idOrName: projectId,
          id: env.id,
        });
      } catch (error) {
        logger.warn(
          `Failed to remove Neon env var ${env.key} from project ${projectId}: ${error}`,
        );
      }
    }
  }
}

/**
 * Poll a Vercel deployment until it reaches READY (or ERROR). Bounded by
 * `maxAttempts` × `intervalMs`. Returns the resolved deployment URL on
 * success, null on timeout or error states.
 */
export async function waitForDeploymentReady({
  vercel,
  projectId,
  maxAttempts = 30,
  intervalMs = 2000,
}: {
  vercel: Vercel;
  projectId: string;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await vercel.deployments.getDeployments({
        projectId,
        limit: 1,
      });
      const deployment = response.deployments?.[0];
      if (deployment) {
        if (deployment.readyState === "READY" && deployment.url) {
          return deployment.url;
        }
        if (
          deployment.readyState === "ERROR" ||
          deployment.readyState === "CANCELED"
        ) {
          logger.warn(
            `Deployment for ${projectId} ended in ${deployment.readyState}`,
          );
          return null;
        }
      }
    } catch (error) {
      logger.warn(`waitForDeploymentReady poll failed: ${error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  logger.warn(
    `waitForDeploymentReady timed out for project ${projectId} after ${maxAttempts} attempts`,
  );
  return null;
}

/**
 * Add the deployment domain to the Neon Auth trusted-domain (redirect URI
 * whitelist) for the given branch. Idempotent: lists first and skips if
 * already present.
 */
export async function addNeonTrustedDomain({
  projectId,
  branchId,
  domain,
}: {
  projectId: string;
  branchId: string;
  domain: string;
}): Promise<void> {
  const neonClient = await getNeonClient();
  const normalized = stripProtocol(domain).replace(/\/$/, "");
  const fullUrl = `https://${normalized}`;

  try {
    const existing = await neonClient.listBranchNeonAuthTrustedDomains(
      projectId,
      branchId,
    );
    const domains = existing.data?.domains ?? [];
    if (
      domains.some(
        (entry) =>
          entry.domain === fullUrl ||
          entry.domain === normalized ||
          entry.domain === domain,
      )
    ) {
      return;
    }
  } catch (error) {
    logger.warn(
      `listBranchNeonAuthTrustedDomains failed for ${projectId}/${branchId}: ${error}`,
    );
  }

  await neonClient.addBranchNeonAuthTrustedDomain(projectId, branchId, {
    domain: fullUrl,
    auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
  });
}

/**
 * Build a Vercel client from the saved access token. Throws if the user is
 * not authenticated.
 */
export function createVercelClientFromSettings(): Vercel {
  const accessToken = readSettings().vercelAccessToken?.value;
  if (!accessToken) {
    throw new DyadError("Not authenticated with Vercel.", DyadErrorKind.Auth);
  }
  const TEST_SERVER_BASE = `http://localhost:${process.env.FAKE_LLM_PORT || "3500"}`;
  return new Vercel({
    bearerToken: accessToken,
    ...(IS_TEST_BUILD && { serverURL: `${TEST_SERVER_BASE}/vercel/api` }),
  });
}

/**
 * Remove the Neon env vars from the Vercel project linked to an app, if any.
 * Safe to call even when the app has no Vercel project (no-op). Resets the
 * persisted sync metadata since the synced env-var set is now gone.
 */
export async function removeNeonEnvVarsFromLinkedVercel({
  appId,
}: {
  appId: number;
}): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app?.vercelProjectId) return;
  const vercel = createVercelClientFromSettings();
  await removeNeonEnvVarsFromVercel({
    vercel,
    projectId: app.vercelProjectId,
  });
  await db
    .update(apps)
    .set({
      vercelLastSyncedHash: null,
      vercelLastSyncedBranchType: null,
      vercelLastSyncedAt: null,
    })
    .where(eq(apps.id, appId));
}

/**
 * Persist sync metadata after a successful push. Stored on the apps row so
 * the panel can compute drift locally without re-fetching from Vercel/Neon.
 */
export async function persistSyncResult({
  appId,
  syncedHash,
  branchType,
}: {
  appId: number;
  syncedHash: string;
  branchType: NeonBranchType;
}): Promise<void> {
  await db
    .update(apps)
    .set({
      vercelLastSyncedHash: syncedHash,
      vercelLastSyncedBranchType: branchType,
      vercelLastSyncedAt: new Date(),
    })
    .where(eq(apps.id, appId));
}
