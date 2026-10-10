import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps, cloudflareAppConnections } from "../../db/schema";
import { readSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { deleteWorkerSecret, putWorkerSecret } from "@/cloudflare_deploy/api";
import {
  combineWarnings,
  ensureNeonAuthTrustedDomain,
  getSelectedDeployBranchType,
  resolveNeonBranchEnvVars,
  type NeonBranchType,
} from "./neon_utils";

const logger = log.scope("cloudflare_neon_sync");

type AppRow = typeof apps.$inferSelect;
type ConnectionRow = typeof cloudflareAppConnections.$inferSelect;

/**
 * The secrets this sync owns on a Worker. They go on the Worker itself, not
 * on its deploy rule: a rule's variables exist only while the build runs, and
 * these are read by the deployed code. NEON_AUTH_COOKIE_SECRET is left out
 * because only Next.js uses it, and Next.js does not deploy to Cloudflare.
 */
export const NEON_CLOUDFLARE_SECRET_NAMES = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
] as const;

export interface CloudflareNeonSyncResult {
  /** Whether every connected Worker got the secrets. */
  envPushed: boolean;
  domainsAdded: string[];
  skipped: string[];
  warning?: string;
}

async function loadSyncableApp(appId: number): Promise<AppRow> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(
      `App with ID ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }
  return app;
}

function requireToken(): string {
  const token = readSettings().cloudflareAccessToken?.value;
  if (!token) {
    throw new DyadError(
      "Not connected to Cloudflare. Add an API token first.",
      DyadErrorKind.Auth,
    );
  }
  return token;
}

function loadConnections(appId: number): Promise<ConnectionRow[]> {
  return db.query.cloudflareAppConnections.findMany({
    where: eq(cloudflareAppConnections.appId, appId),
  });
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sets the selected Neon branch's secrets on the app's Workers and adds each
 * Worker's address to the branch's Neon Auth trusted domains, so sign-in
 * works from the deployed site. Mirrors the Vercel sync: each external step
 * fails on its own and becomes a warning rather than undoing the others.
 *
 * `connections` narrows the sync to the given Workers, for a folder that was
 * just connected while the app's other folders already have their secrets.
 */
export async function syncNeonConfigToCloudflare({
  appId,
  branchType: branchTypeOverride,
  connections,
}: {
  appId: number;
  branchType?: NeonBranchType;
  connections?: ConnectionRow[];
}): Promise<CloudflareNeonSyncResult> {
  const app = await loadSyncableApp(appId);
  const neonProjectId = app.neonProjectId;
  if (!neonProjectId) {
    throw new DyadError(
      "This app is not connected to a Neon project.",
      DyadErrorKind.Precondition,
    );
  }
  const rows = connections ?? (await loadConnections(appId));
  if (rows.length === 0) {
    throw new DyadError(
      "This app is not connected to a Cloudflare Worker.",
      DyadErrorKind.Precondition,
    );
  }
  const token = requireToken();

  const branchType = branchTypeOverride ?? getSelectedDeployBranchType(app);
  const resolved = await resolveNeonBranchEnvVars({ appData: app, branchType });
  const secrets: Record<string, string> = {
    DATABASE_URL: resolved.databaseUrl,
  };
  if (resolved.neonAuthBaseUrl) {
    secrets.NEON_AUTH_BASE_URL = resolved.neonAuthBaseUrl;
  }

  const warnings: Array<string | undefined> = [];
  const skipped: string[] = [];

  // --- 1. Secrets, one Worker at a time so one refusal leaves the rest set ---
  let envPushed = true;
  for (const row of rows) {
    try {
      for (const [name, value] of Object.entries(secrets)) {
        await putWorkerSecret(
          token,
          row.accountId,
          row.workerName,
          name,
          value,
        );
      }
    } catch (error) {
      envPushed = false;
      warnings.push(
        `Failed to set the database secrets on ${row.workerName}: ${describeFailure(error)}`,
      );
    }
  }

  // --- 2. Trusted domains ---
  const domainsAdded: string[] = [];
  if (!resolved.neonAuthBaseUrl) {
    skipped.push("trusted-domains");
    warnings.push(
      "Neon Auth is not active on this branch, so the Worker's address was not added to the redirect allowlist.",
    );
  } else {
    for (const row of rows) {
      if (!row.workerUrl) {
        // An existing Worker served only at its own domain. Dyad does not
        // know that domain, so the user adds it in the Neon console.
        warnings.push(
          `${row.workerName} has no workers.dev address, so nothing was added to Neon's redirect allowlist for it.`,
        );
        continue;
      }
      try {
        const added = await ensureNeonAuthTrustedDomain({
          projectId: neonProjectId,
          branchId: resolved.branchId,
          origin: row.workerUrl,
        });
        if (added) domainsAdded.push(added);
      } catch (error) {
        warnings.push(
          `Failed to add ${row.workerUrl} to Neon's trusted domains: ${describeFailure(error)}`,
        );
      }
    }
  }

  logger.info(
    `Synced Neon config to Cloudflare for app ${appId}: envPushed=${envPushed}, workers=${rows.length}, domainsAdded=${domainsAdded.length}`,
  );

  return {
    envPushed,
    domainsAdded,
    skipped,
    warning: combineWarnings(...warnings),
  };
}

/**
 * Removes the Neon-owned secrets from every Worker the app deploys to. A
 * no-op when the app has no Worker. Used on Neon disconnect.
 */
export async function removeNeonEnvVarsFromCloudflare({
  appId,
}: {
  appId: number;
}): Promise<{ removedKeys: string[]; warning?: string }> {
  const rows = await loadConnections(appId);
  if (rows.length === 0) {
    return { removedKeys: [] };
  }
  const token = requireToken();

  const warnings: Array<string | undefined> = [];
  const failedKeys = new Set<string>();
  for (const row of rows) {
    for (const name of NEON_CLOUDFLARE_SECRET_NAMES) {
      try {
        await deleteWorkerSecret(token, row.accountId, row.workerName, name);
      } catch (error) {
        failedKeys.add(name);
        warnings.push(
          `Failed to remove ${name} from ${row.workerName}: ${describeFailure(error)}`,
        );
      }
    }
  }

  return {
    removedKeys: NEON_CLOUDFLARE_SECRET_NAMES.filter(
      (name) => !failedKeys.has(name),
    ),
    warning: combineWarnings(...warnings),
  };
}
