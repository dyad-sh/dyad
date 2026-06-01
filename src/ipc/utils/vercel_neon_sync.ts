import log from "electron-log";
import { eq } from "drizzle-orm";
import { Vercel } from "@vercel/sdk";
import { NeonAuthSupportedAuthProvider } from "@neondatabase/api-client";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { readSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createVercelClient } from "./vercel_utils";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import {
  combineWarnings,
  getSelectedDeployBranchType,
  resolveNeonBranchEnvVars,
  type NeonBranchType,
} from "./neon_utils";
import {
  buildVercelEnvPayload,
  reconcileTrustedDomains,
  VERCEL_ENV_TARGETS,
  type VercelEnvTarget,
} from "./vercel_neon_sync_helpers";

export {
  buildVercelEnvPayload,
  canonicalOrigin,
  reconcileTrustedDomains,
  VERCEL_ENV_TARGETS,
} from "./vercel_neon_sync_helpers";

const logger = log.scope("vercel_neon_sync");

type AppRow = typeof apps.$inferSelect;

/**
 * Env var keys this sync owns on the Vercel project. POSTGRES_URL is
 * intentionally NOT pushed to Vercel (only DATABASE_URL), so it is also never
 * removed on disconnect.
 */
const NEON_VERCEL_ENV_KEYS = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
];

export interface VercelSyncResult {
  envPushed: boolean;
  domainsAdded: string[];
  skipped: string[];
  warning?: string;
}

export interface VercelSyncPreview {
  vercelProjectName: string | null;
  branchType: NeonBranchType;
  envKeys: string[];
  cookieSecretIncluded: boolean;
  target: VercelEnvTarget[];
  trustedDomainOrigins: string[];
  authActive: boolean;
}

// =============================================================================
// Orchestration
// =============================================================================

async function loadSyncableApp(appId: number): Promise<AppRow> {
  const rows = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
  if (rows.length === 0) {
    throw new DyadError(
      `App with ID ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }
  return rows[0];
}

function getVercelAccessToken(): string {
  const settings = readSettings();
  const accessToken = settings.vercelAccessToken?.value;
  if (!accessToken) {
    throw new DyadError("Not authenticated with Vercel.", DyadErrorKind.Auth);
  }
  return accessToken;
}

async function getProjectDomainHosts(
  vercel: Vercel,
  projectId: string,
): Promise<string[]> {
  const response = await vercel.projects.getProjectDomains({
    idOrName: projectId,
  });
  const domains =
    (response as { domains?: Array<{ name?: string }> } | undefined)?.domains ??
    [];
  return domains
    .map((d) => d.name)
    .filter((name): name is string => Boolean(name));
}

/**
 * Computes what `syncNeonConfigToVercel` would push, for the pre-deploy summary
 * card. Returns env-var KEYS only — never secret values.
 *
 * NOTE: this is NOT side-effect-free. Like the `getBranchEnvVars` handler, it
 * follows the "provision-on-view" pattern: resolving the branch env vars calls
 * `resolveNeonBranchEnvVars`, which activates Neon Auth on the branch if
 * inactive and generates/persists a per-branch cookie secret. Opening the
 * connector's create view with a Neon project attached triggers this
 * provisioning before the user approves anything.
 */
export async function previewNeonVercelSync({
  appId,
}: {
  appId: number;
}): Promise<VercelSyncPreview> {
  const appData = await loadSyncableApp(appId);
  if (!appData.neonProjectId) {
    throw new DyadError(
      "This app is not connected to a Neon project.",
      DyadErrorKind.Precondition,
    );
  }

  const branchType = getSelectedDeployBranchType(appData);
  const resolved = await resolveNeonBranchEnvVars({ appData, branchType });

  const envKeys = buildVercelEnvPayload(resolved, {
    target: VERCEL_ENV_TARGETS,
  }).map((p) => p.key);

  // Compute the trusted-domain origins that WOULD be added (best-effort).
  // Only possible once a Vercel project exists; for a not-yet-created project
  // this stays empty and the card explains the domain is added after deploy.
  let trustedDomainOrigins: string[] = [];
  if (resolved.neonAuthBaseUrl && appData.vercelProjectId) {
    try {
      const vercel = createVercelClient(getVercelAccessToken());
      const hosts = await getProjectDomainHosts(
        vercel,
        appData.vercelProjectId,
      );
      const neonClient = await getNeonClient();
      const existing = await neonClient.listBranchNeonAuthTrustedDomains(
        appData.neonProjectId,
        resolved.branchId,
      );
      const existingDomains = (existing.data?.domains ?? []).map(
        (d) => d.domain,
      );
      trustedDomainOrigins = reconcileTrustedDomains(existingDomains, hosts);
    } catch (error) {
      logger.warn(
        `Failed to compute trusted-domain preview for app ${appId}:`,
        error,
      );
    }
  }

  return {
    vercelProjectName: appData.vercelProjectName ?? null,
    branchType,
    envKeys,
    cookieSecretIncluded: envKeys.includes("NEON_AUTH_COOKIE_SECRET"),
    target: VERCEL_ENV_TARGETS,
    trustedDomainOrigins,
    authActive: Boolean(resolved.neonAuthBaseUrl),
  };
}

/**
 * Pushes the selected Neon branch's env vars to the linked Vercel project and
 * adds the project's domains to the branch's Neon Auth trusted-domain
 * allowlist. Each external step is independently fault-tolerant: a failure in
 * one becomes a warning rather than rolling back the other (partial success).
 */
export async function syncNeonConfigToVercel({
  appId,
  branchType: branchTypeOverride,
  includeDomainHosts = [],
}: {
  appId: number;
  branchType?: NeonBranchType;
  includeDomainHosts?: string[];
}): Promise<VercelSyncResult> {
  const appData = await loadSyncableApp(appId);
  const vercelProjectId = appData.vercelProjectId;
  const vercelTeamId = appData.vercelTeamId;
  const neonProjectId = appData.neonProjectId;
  if (!vercelProjectId) {
    throw new DyadError(
      "This app is not connected to a Vercel project.",
      DyadErrorKind.Precondition,
    );
  }
  if (!vercelTeamId) {
    throw new DyadError(
      "Vercel team ID is missing — reconnect your Vercel project to fix this.",
      DyadErrorKind.Precondition,
    );
  }
  if (!neonProjectId) {
    throw new DyadError(
      "This app is not connected to a Neon project.",
      DyadErrorKind.Precondition,
    );
  }

  const branchType = branchTypeOverride ?? getSelectedDeployBranchType(appData);
  const resolved = await resolveNeonBranchEnvVars({ appData, branchType });
  const vercel = createVercelClient(getVercelAccessToken());

  const warnings: Array<string | undefined> = [];
  const skipped: string[] = [];

  // --- 1. Push env vars (upsert — idempotent) ---
  let envPushed = false;
  try {
    await vercel.projects.createProjectEnv({
      idOrName: vercelProjectId,
      teamId: vercelTeamId,
      upsert: "true",
      requestBody: buildVercelEnvPayload(resolved, {
        target: VERCEL_ENV_TARGETS,
      }),
    });
    envPushed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to push environment variables to Vercel: ${message}`);
  }

  // --- 2. Trusted domains (diff then add missing) ---
  const domainsAdded: string[] = [];
  if (!resolved.neonAuthBaseUrl) {
    skipped.push("trusted-domains");
    warnings.push(
      "Neon Auth is not active on this branch, so the Vercel domain was not added to the redirect allowlist.",
    );
  } else {
    // Fetching the project's existing domains is best-effort: if it fails we
    // still process the explicitly-provided includeDomainHosts (e.g. a
    // freshly-created deployment URL) rather than dropping them because of an
    // unrelated listing failure.
    const hosts = [...includeDomainHosts];
    try {
      hosts.push(...(await getProjectDomainHosts(vercel, vercelProjectId)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to fetch Vercel project domains: ${message}`);
    }

    try {
      const neonClient = await getNeonClient();
      const existing = await neonClient.listBranchNeonAuthTrustedDomains(
        neonProjectId,
        resolved.branchId,
      );
      const existingDomains = (existing.data?.domains ?? []).map(
        (d) => d.domain,
      );
      const originsToAdd = reconcileTrustedDomains(existingDomains, hosts);

      for (const origin of originsToAdd) {
        await neonClient.addBranchNeonAuthTrustedDomain(
          neonProjectId,
          resolved.branchId,
          {
            domain: origin,
            auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
          },
        );
        domainsAdded.push(origin);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to update Neon trusted domains: ${message}`);
    }
  }

  logger.info(
    `Synced Neon config to Vercel for app ${appId}: envPushed=${envPushed}, domainsAdded=${domainsAdded.length}`,
  );

  return {
    envPushed,
    domainsAdded,
    skipped,
    warning: combineWarnings(...warnings),
  };
}

/**
 * Removes the Neon-owned env vars (DATABASE_URL, NEON_AUTH_BASE_URL,
 * NEON_AUTH_COOKIE_SECRET) from the linked Vercel project. No-op when the app
 * has no Vercel project. Used on Neon disconnect (default-on, opt-out).
 */
export async function removeNeonEnvVarsFromVercel({
  appId,
}: {
  appId: number;
}): Promise<{ removedKeys: string[]; warning?: string }> {
  const appData = await loadSyncableApp(appId);
  const vercelProjectId = appData.vercelProjectId;
  const vercelTeamId = appData.vercelTeamId;
  if (!vercelProjectId || !vercelTeamId) {
    return { removedKeys: [] };
  }

  const vercel = createVercelClient(getVercelAccessToken());

  let envs: Array<{ id?: string; key?: string }>;
  try {
    const response = await vercel.projects.filterProjectEnvs({
      idOrName: vercelProjectId,
      teamId: vercelTeamId,
    });
    envs =
      (response as { envs?: Array<{ id?: string; key?: string }> } | undefined)
        ?.envs ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      removedKeys: [],
      warning: `Failed to list Vercel environment variables: ${message}`,
    };
  }

  const toRemove = envs.filter(
    (e): e is { id: string; key: string } =>
      Boolean(e.id) && NEON_VERCEL_ENV_KEYS.includes(e.key ?? ""),
  );

  const removedKeys: string[] = [];
  const warnings: Array<string | undefined> = [];
  for (const env of toRemove) {
    try {
      await vercel.projects.removeProjectEnv({
        idOrName: vercelProjectId,
        id: env.id,
        teamId: vercelTeamId,
      });
      removedKeys.push(env.key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to remove ${env.key} from Vercel: ${message}`);
    }
  }

  return { removedKeys, warning: combineWarnings(...warnings) };
}
