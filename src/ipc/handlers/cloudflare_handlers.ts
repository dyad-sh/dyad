import * as path from "node:path";
import log from "electron-log";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { apps, cloudflareAppConnections } from "../../db/schema";
import { readSettings, writeSettings } from "../../main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { execGit } from "../utils/git_utils";
import { getPnpmMinimumReleaseAgeSupport } from "../utils/socket_firewall";
import { createAppOperationHandler } from "../utils/app_mutation_lock";
import { readAppResource } from "../services/app_operation_coordinator";
import { createTypedHandler } from "./base";
import { getGitHubApiBase } from "./github_handlers";
import {
  cloudflareContracts,
  type CheckCloudflareRepoAccessResult,
  type CloudflareAppStatus,
  type CloudflareConnection,
  type CloudflareDeploymentStatus,
  type ConnectCloudflareWorkerParams,
  type ConnectCloudflareWorkerResult,
} from "../types/cloudflare";
import {
  CloudflareApiError,
  canCloudflareSeeRepo,
  createPlaceholderWorker,
  createTrigger,
  deleteTrigger,
  deleteWorker,
  describeTriggerRepo,
  describeTriggerSource,
  enableWorkersDevRoute,
  ensureBuildToken,
  getAccountSubdomain,
  getBuildLogLines,
  getLatestBuild,
  getTriggerRepoConnectionUuid,
  getTriggerRootDirectory,
  isCloudflareAuthFailure,
  isWorkersDevRouteEnabled,
  listAccounts,
  listTriggers,
  listWorkers,
  probeBuildsAccess,
  restoreTrigger,
  setTriggerBuildToken,
  setTriggerBuildVariables,
  startBuild,
  toCloudflareDyadError,
  triggerDeploys,
  triggerDeploysBranch,
  updateTrigger,
  upsertRepoConnection,
  verifyToken,
  type CloudflareTrigger,
  type GithubRepoIdentity,
} from "@/cloudflare_deploy/api";
import {
  buildCloudflareWorkerDashboardUrl,
  buildDeployRule,
  buildGithubInstallationsUrl,
  isBuildTokenRevokedLog,
  isValidWorkerName,
  pnpmVersionForBuild,
  suggestWorkerName,
  toDeploymentState,
} from "@/cloudflare_deploy/build_config";
import {
  describeCloudflareTarget,
  detectCloudflareTargets,
  readWranglerWorkerName,
  type CloudflareTarget,
} from "@/cloudflare_deploy/targets";

const logger = log.scope("cloudflare_handlers");

const DEFAULT_BRANCH = "main";
const LOG_TAIL_LINES = 30;

type AppRow = typeof apps.$inferSelect;
type ConnectionRow = typeof cloudflareAppConnections.$inferSelect;

// --- Helpers ---

function assertCloudflareEnabled(): void {
  if (!readSettings().enableCloudflareDeployment) {
    throw new DyadError(
      "Cloudflare deployment is not enabled. Turn it on in Settings > Experiments.",
      DyadErrorKind.Precondition,
    );
  }
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

async function requireApp(appId: number): Promise<AppRow> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  return app;
}

function toConnection(row: ConnectionRow): CloudflareConnection {
  return {
    rootDirectory: row.rootDirectory,
    accountId: row.accountId,
    workerName: row.workerName,
    workerUrl: row.workerUrl,
    dashboardUrl: buildCloudflareWorkerDashboardUrl({
      accountId: row.accountId,
      workerName: row.workerName,
    }),
  };
}

async function findConnection(
  appId: number,
  rootDirectory: string,
): Promise<ConnectionRow | undefined> {
  return db.query.cloudflareAppConnections.findFirst({
    where: and(
      eq(cloudflareAppConnections.appId, appId),
      eq(cloudflareAppConnections.rootDirectory, rootDirectory),
    ),
  });
}

async function revParse(appPath: string, ref: string): Promise<string | null> {
  const result = await execGit(
    ["rev-parse", "--verify", "--quiet", ref],
    appPath,
  );
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Targets come from the committed branch, not the working folder: Cloudflare
 * builds what is on GitHub, so a Wrangler config that was never committed is
 * not something it can deploy.
 */
async function listCommittedTargets(
  appPath: string,
  branch: string,
): Promise<CloudflareTarget[]> {
  const result = await execGit(
    ["ls-tree", "-r", "--name-only", "-z", `refs/heads/${branch}`],
    appPath,
  );
  if (result.exitCode !== 0) {
    // An empty list would tell the user the app has no Worker.
    logger.warn(`Could not list the files on ${branch}:`, result.stderr);
    throw new DyadError(
      `Could not read the "${branch}" branch of this app's repository.`,
      DyadErrorKind.Precondition,
    );
  }
  return detectCloudflareTargets(result.stdout.split("\0").filter(Boolean));
}

/**
 * Reads a file as committed on the branch, for the same reason targets are
 * listed from it: an uncommitted edit is not something Cloudflare will build.
 */
async function readCommittedFile(
  appPath: string,
  branch: string,
  relativePath: string,
): Promise<string | null> {
  const result = await execGit(
    ["show", `refs/heads/${branch}:${relativePath}`],
    appPath,
  );
  return result.exitCode === 0 ? result.stdout : null;
}

/** Whether the branch's latest commit is the one GitHub has. */
async function isBranchSynced(
  appPath: string,
  branch: string,
): Promise<boolean> {
  const [localHead, remoteHead] = await Promise.all([
    revParse(appPath, `refs/heads/${branch}`),
    revParse(appPath, `refs/remotes/origin/${branch}`),
  ]);
  return localHead !== null && localHead === remoteHead;
}

async function hasBuildScript(
  appPath: string,
  branch: string,
  rootDirectory: string,
): Promise<boolean> {
  const contents = await readCommittedFile(
    appPath,
    branch,
    path.posix.join(rootDirectory, "package.json"),
  );
  if (!contents) return false;
  try {
    const manifest = JSON.parse(contents) as {
      scripts?: Record<string, unknown>;
    };
    return typeof manifest.scripts?.build === "string";
  } catch {
    return false;
  }
}

/**
 * A Worker holds one script, so it can be deployed from one folder only. A
 * second folder would overwrite the first on every push, and would take over
 * the first folder's deploy rule to do it.
 */
async function assertWorkerIsFree(
  accountId: string,
  workerTag: string,
  workerName: string,
): Promise<void> {
  const existing = await db.query.cloudflareAppConnections.findFirst({
    where: and(
      eq(cloudflareAppConnections.accountId, accountId),
      eq(cloudflareAppConnections.workerTag, workerTag),
    ),
  });
  if (!existing) return;
  const owner = await db.query.apps.findFirst({
    where: eq(apps.id, existing.appId),
  });
  const folder =
    existing.rootDirectory === ""
      ? "the app root"
      : `folder "${existing.rootDirectory}"`;
  throw new DyadError(
    `"${workerName}" already deploys ${folder} of ${owner?.name ?? "another app"}. A Worker can only be deployed from one folder, so pick or create a different Worker.`,
    DyadErrorKind.Conflict,
  );
}

/** Build-time variables the target needs for Cloudflare to install it. */
async function getBuildVariables(
  appPath: string,
  branch: string,
  rootDirectory: string,
): Promise<Record<string, string>> {
  const usesPnpm =
    (await readCommittedFile(
      appPath,
      branch,
      path.posix.join(rootDirectory, "pnpm-lock.yaml"),
    )) !== null;
  if (!usesPnpm) return {};

  let packageManagerField: string | null = null;
  const manifest = await readCommittedFile(
    appPath,
    branch,
    path.posix.join(rootDirectory, "package.json"),
  );
  if (manifest) {
    try {
      const field = (JSON.parse(manifest) as { packageManager?: unknown })
        .packageManager;
      packageManagerField = typeof field === "string" ? field : null;
    } catch {
      packageManagerField = null;
    }
  }
  const localPnpm = await getPnpmMinimumReleaseAgeSupport().catch(() => null);
  const version = pnpmVersionForBuild({
    packageManagerField,
    localPnpmVersion: localPnpm?.version ?? null,
  });
  return version ? { PNPM_VERSION: version } : {};
}

/** How long a repository's ids are remembered. They only change if it is recreated. */
const GITHUB_IDENTITY_TTL_MS = 10 * 60 * 1000;
const githubIdentityCache = new Map<
  string,
  { identity: GithubRepoIdentity; expiresAt: number }
>();

async function getGithubRepoIdentity(app: AppRow): Promise<GithubRepoIdentity> {
  if (!app.githubOrg || !app.githubRepo) {
    throw new DyadError(
      "Connect this app to a GitHub repository before deploying to Cloudflare.",
      DyadErrorKind.Precondition,
    );
  }
  const githubToken = readSettings().githubAccessToken?.value;
  if (!githubToken) {
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }
  // The access check polls while the user is away granting access, and would
  // otherwise ask GitHub for the same two numbers every few seconds.
  const cacheKey = `${app.githubOrg}/${app.githubRepo}`;
  const cached = githubIdentityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.identity;
  }
  let response: Response;
  try {
    response = await fetch(
      `${getGitHubApiBase()}/repos/${app.githubOrg}/${app.githubRepo}`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    );
  } catch (error) {
    throw new DyadError(
      `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.External,
    );
  }
  if (!response.ok) {
    // Without the repository's name, which would go out with the error report.
    throw new DyadError(
      `Could not read this app's repository from GitHub (${response.status}).`,
      response.status === 404
        ? DyadErrorKind.NotFound
        : response.status === 401 || response.status === 403
          ? DyadErrorKind.Auth
          : DyadErrorKind.External,
    );
  }
  const repo = (await response.json()) as {
    id?: number;
    name?: string;
    owner?: { id?: number; login?: string; type?: string };
  };
  if (repo.id === undefined || repo.owner?.id === undefined) {
    throw new DyadError(
      "GitHub did not return the repository's identifiers.",
      DyadErrorKind.External,
    );
  }
  const identity: GithubRepoIdentity = {
    ownerId: String(repo.owner.id),
    ownerLogin: repo.owner.login ?? app.githubOrg,
    ownerType: repo.owner.type === "Organization" ? "Organization" : "User",
    repoId: String(repo.id),
    repoName: repo.name ?? app.githubRepo,
  };
  githubIdentityCache.set(cacheKey, {
    identity,
    expiresAt: Date.now() + GITHUB_IDENTITY_TTL_MS,
  });
  return identity;
}

// --- Handlers ---

async function handleSaveToken(rawToken: string): Promise<void> {
  const token = rawToken.trim();
  if (token === "") {
    throw new DyadError("An API token is required.", DyadErrorKind.Auth);
  }

  let info;
  try {
    info = await verifyToken(token);
  } catch (error) {
    // Cloudflare answers 400 to a token that is not even well formed. Anything
    // else, an outage or a rate limit, says nothing about the token.
    if (
      isCloudflareAuthFailure(error) ||
      (error instanceof CloudflareApiError && error.status === 400)
    ) {
      throw new DyadError(
        "Cloudflare did not accept this API token. Check that you copied all of it.",
        DyadErrorKind.Auth,
      );
    }
    throw toCloudflareDyadError(error, "Could not check the API token");
  }
  if (info.status !== "active") {
    throw new DyadError(
      `This API token is ${info.status}. Create a new one and try again.`,
      DyadErrorKind.Auth,
    );
  }

  let accounts;
  try {
    accounts = await listAccounts(token);
  } catch (error) {
    throw toCloudflareDyadError(error, "Could not list Cloudflare accounts");
  }
  if (accounts.length === 0) {
    throw new DyadError(
      "This API token cannot see any Cloudflare account. Create it with the link above so it has the right permissions.",
      DyadErrorKind.Auth,
    );
  }

  // A token missing a permission would otherwise fail at the first deploy,
  // long after the user has left the page that could fix it.
  const probes = await Promise.allSettled(
    accounts.map(async (account) => {
      await listWorkers(token, account.id);
      await probeBuildsAccess(token, account.id);
    }),
  );
  if (!probes.some((probe) => probe.status === "fulfilled")) {
    const otherFailure = probes.find(
      (probe) =>
        probe.status === "rejected" && !isCloudflareAuthFailure(probe.reason),
    );
    if (otherFailure?.status === "rejected") {
      throw toCloudflareDyadError(
        otherFailure.reason,
        "Could not check the API token's permissions",
      );
    }
    throw new DyadError(
      "This API token is missing a permission. It needs Workers Scripts (edit) and Workers Builds Configuration (edit). Create it with the link above so both are included.",
      DyadErrorKind.Auth,
    );
  }

  writeSettings({ cloudflareAccessToken: { value: token } });
  logger.log("Saved Cloudflare API token.");
  await moveDeployRulesToToken(token, info.id);
}

/**
 * Every deploy rule names the API token Cloudflare deploys with. After the
 * user replaces a deleted or rolled token, rules still naming the old one
 * would keep failing, so they are pointed at the new one.
 */
async function moveDeployRulesToToken(
  token: string,
  tokenId: string,
): Promise<void> {
  const rows = await db.query.cloudflareAppConnections.findMany();
  const buildTokenByAccount = new Map<string, string>();
  for (const row of rows) {
    // Each rule on its own: one in an account the new token cannot reach must
    // not leave the others on the old token. The token is saved and valid
    // either way, and a rule that could not be moved shows up as a failed
    // deployment the user can act on.
    try {
      let buildTokenUuid = buildTokenByAccount.get(row.accountId);
      if (!buildTokenUuid) {
        buildTokenUuid = await ensureBuildToken(token, row.accountId, tokenId);
        buildTokenByAccount.set(row.accountId, buildTokenUuid);
      }
      await setTriggerBuildToken(
        token,
        row.accountId,
        row.triggerUuid,
        buildTokenUuid,
      );
    } catch (error) {
      logger.warn(
        `Could not move the deploy rule for ${row.workerName} to the new token:`,
        error,
      );
    }
  }
}

async function handleGetAppStatus(appId: number): Promise<CloudflareAppStatus> {
  const app = await requireApp(appId);
  const appPath = getDyadAppPath(app.path);
  const branch = app.githubBranch ?? DEFAULT_BRANCH;

  const [synced, listing, rows] = await Promise.all([
    isBranchSynced(appPath, branch),
    listCommittedTargets(appPath, branch).then(
      (targets) => ({ targets, error: null }),
      (error: unknown) => ({ targets: [] as CloudflareTarget[], error }),
    ),
    db.query.cloudflareAppConnections.findMany({
      where: eq(cloudflareAppConnections.appId, appId),
    }),
  ]);
  // A connected folder has to stay reachable to be disconnected, so only an
  // app with nothing connected is told the branch could not be read.
  if (listing.error && rows.length === 0) {
    throw listing.error;
  }
  const { targets } = listing;

  const targetSummaries = await Promise.all(
    targets.map(async (target) => {
      const contents = await readCommittedFile(
        appPath,
        branch,
        target.configPath,
      );
      return {
        rootDirectory: target.rootDirectory,
        configPath: target.configPath,
        label: describeCloudflareTarget(target),
        suggestedWorkerName: suggestWorkerName({
          configName: contents
            ? readWranglerWorkerName(target.configPath, contents)
            : null,
          appName: app.name,
          rootDirectory: target.rootDirectory,
        }),
      };
    }),
  );

  return {
    synced,
    branch,
    targets: targetSummaries,
    connections: rows.map(toConnection),
  };
}

async function handleCheckRepoAccess({
  appId,
  accountId,
}: {
  appId: number;
  accountId: string;
}): Promise<CheckCloudflareRepoAccessResult> {
  const token = requireToken();
  const app = await requireApp(appId);
  const repo = await getGithubRepoIdentity(app);
  try {
    const hasAccess = await canCloudflareSeeRepo(
      token,
      accountId,
      repo,
      app.githubBranch ?? DEFAULT_BRANCH,
    );
    return {
      hasAccess,
      githubInstallationsUrl: buildGithubInstallationsUrl(repo),
    };
  } catch (error) {
    throw toCloudflareDyadError(
      error,
      "Could not check Cloudflare's access to the repository",
    );
  }
}

async function handleConnectWorker(
  params: ConnectCloudflareWorkerParams,
): Promise<ConnectCloudflareWorkerResult> {
  const { appId, accountId, rootDirectory, workerName, mode } = params;
  const token = requireToken();
  const app = await requireApp(appId);
  const appPath = getDyadAppPath(app.path);
  const branch = app.githubBranch ?? DEFAULT_BRANCH;

  if (!isValidWorkerName(workerName)) {
    throw new DyadError(
      "A Worker name can only contain lowercase letters, numbers and dashes, and must be 63 characters or fewer.",
      DyadErrorKind.Validation,
    );
  }
  if (await findConnection(appId, rootDirectory)) {
    throw new DyadError(
      "This folder is already connected to a Worker.",
      DyadErrorKind.Conflict,
    );
  }
  // The tab only offers this once the app is synced, but that was a moment
  // ago. Unsynced, the folder may not be on GitHub for Cloudflare to build.
  if (!(await isBranchSynced(appPath, branch))) {
    throw new DyadError(
      `Sync this app to GitHub first. The latest commit on ${branch} has not been pushed, and Cloudflare builds what is on GitHub.`,
      DyadErrorKind.Precondition,
    );
  }
  // The folder ends up in a rule Cloudflare runs, so it has to be one Dyad
  // found in the repository rather than whatever the caller sent.
  const targets = await listCommittedTargets(appPath, branch);
  if (!targets.some((target) => target.rootDirectory === rootDirectory)) {
    throw new DyadError(
      "No Wrangler config was found in that folder on the synced branch.",
      DyadErrorKind.Precondition,
    );
  }

  const repo = await getGithubRepoIdentity(app);

  let createdWorkerName: string | null = null;
  let createdTriggerUuid: string | null = null;
  let rewrittenTrigger: CloudflareTrigger | null = null;
  let removedForeignRule = false;
  try {
    if (!(await canCloudflareSeeRepo(token, accountId, repo, branch))) {
      throw new DyadError(
        "Cloudflare cannot see this GitHub repository yet.",
        DyadErrorKind.Precondition,
      );
    }
    const subdomain = await getAccountSubdomain(token, accountId);
    // A new Worker is served at workers.dev. An existing one may be served
    // only at its own domain, in an account that never set a subdomain up.
    if (!subdomain && mode === "create") {
      throw new DyadError(
        "This Cloudflare account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once to create it, then try again.",
        DyadErrorKind.Precondition,
      );
    }

    const workers = await listWorkers(token, accountId);
    let worker = workers.find((candidate) => candidate.name === workerName);
    let workerUrl = subdomain
      ? `https://${workerName}.${subdomain}.workers.dev`
      : null;
    if (mode === "create") {
      if (worker) {
        throw new DyadError(
          `A Worker named "${workerName}" already exists in this account.`,
          DyadErrorKind.Conflict,
        );
      }
      worker = await createPlaceholderWorker(token, accountId, workerName);
      createdWorkerName = workerName;
      // Only for a Worker made here. How an existing Worker is reachable is
      // its owner's decision: one kept behind a custom domain stays that way.
      await enableWorkersDevRoute(token, accountId, workerName);
    } else if (!worker) {
      throw new DyadError(
        `No Worker named "${workerName}" exists in this account.`,
        DyadErrorKind.NotFound,
      );
    } else {
      await assertWorkerIsFree(accountId, worker.tag, workerName);
      if (
        workerUrl &&
        !(await isWorkersDevRouteEnabled(token, accountId, workerName))
      ) {
        workerUrl = null;
      }
    }
    const repoConnectionUuid = await upsertRepoConnection(
      token,
      accountId,
      repo,
    );

    const existingTriggers = await listTriggers(token, accountId, worker.tag);
    const foreignTriggers = existingTriggers.filter(
      (trigger) => getTriggerRepoConnectionUuid(trigger) !== repoConnectionUuid,
    );
    // Cloudflare allows a Worker one rule for named branches, whatever the
    // branch, and refuses a second. So this repository's existing one is
    // updated in place. Its preview rule, the one for every other branch, is
    // a separate thing and is left alone.
    const ownRule = existingTriggers.find(
      (trigger) =>
        !foreignTriggers.includes(trigger) &&
        !(trigger.branch_includes ?? []).includes("*"),
    );
    // Repointing it would end a deployment of another branch or folder.
    const ownRuleDeploysElsewhere =
      ownRule !== undefined &&
      (!triggerDeploysBranch(ownRule, branch) ||
        getTriggerRootDirectory(ownRule) !== rootDirectory);
    if (!params.overwrite) {
      if (foreignTriggers.length > 0) {
        return {
          status: "conflict",
          existingRepo: describeTriggerRepo(foreignTriggers[0]),
        };
      }
      if (ownRule && ownRuleDeploysElsewhere) {
        return {
          status: "conflict",
          existingRepo: describeTriggerSource(ownRule),
        };
      }
    }

    const tokenInfo = await verifyToken(token);
    const buildTokenUuid = await ensureBuildToken(
      token,
      accountId,
      tokenInfo.id,
    );
    const rule = buildDeployRule({
      workerTag: worker.tag,
      workerName,
      repoConnectionUuid,
      buildTokenUuid,
      rootDirectory,
      branch,
      hasBuildScript: await hasBuildScript(appPath, branch, rootDirectory),
    });

    for (const trigger of foreignTriggers) {
      await deleteTrigger(token, accountId, trigger.trigger_uuid);
      removedForeignRule = true;
    }
    let triggerUuid: string;
    if (ownRule) {
      rewrittenTrigger = ownRule;
      await updateTrigger(token, accountId, ownRule.trigger_uuid, rule);
      triggerUuid = ownRule.trigger_uuid;
    } else {
      triggerUuid = await createTrigger(token, accountId, rule);
      createdTriggerUuid = triggerUuid;
    }
    const buildVariables = await getBuildVariables(
      appPath,
      branch,
      rootDirectory,
    );
    if (Object.keys(buildVariables).length > 0) {
      await setTriggerBuildVariables(
        token,
        accountId,
        triggerUuid,
        buildVariables,
      );
    }

    let row: ConnectionRow;
    try {
      [row] = await db
        .insert(cloudflareAppConnections)
        .values({
          appId,
          rootDirectory,
          accountId,
          workerName,
          workerTag: worker.tag,
          triggerUuid,
          workerUrl,
        })
        .returning();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("UNIQUE constraint failed")
      ) {
        throw error;
      }
      // Another connect took the Worker after the check above. Say so the
      // way that check does.
      await assertWorkerIsFree(accountId, worker.tag, workerName);
      throw new DyadError(
        "This folder was connected a moment ago. Reopen the Cloudflare tab to see it.",
        DyadErrorKind.Conflict,
      );
    }
    // From here the connection is real; nothing below may undo it.
    createdWorkerName = null;
    createdTriggerUuid = null;
    rewrittenTrigger = null;

    let warning: string | undefined;
    try {
      await startBuild(token, accountId, triggerUuid, branch);
    } catch (error) {
      logger.warn("Could not start the first Cloudflare build:", error);
      warning =
        "The Worker is connected, but the first deployment did not start. It will deploy on your next sync to GitHub.";
    }

    return { status: "connected", connection: toConnection(row), warning };
  } catch (error) {
    if (rewrittenTrigger) {
      // The Worker's own rule was repointed at this folder. Left that way it
      // would deploy the folder with nothing in Dyad to show for it.
      await restoreTrigger(token, accountId, rewrittenTrigger).catch(
        (cleanupError) =>
          logger.warn("Could not restore the deploy rule:", cleanupError),
      );
    }
    if (createdTriggerUuid) {
      // A rule without a row would keep deploying with nothing in Dyad to
      // show or remove it.
      await deleteTrigger(token, accountId, createdTriggerUuid).catch(
        (cleanupError) =>
          logger.warn("Could not remove the unused deploy rule:", cleanupError),
      );
    }
    if (createdWorkerName) {
      // Do not leave behind a Worker that only ever held the stand-in script.
      await deleteWorker(token, accountId, createdWorkerName).catch(
        (cleanupError) =>
          logger.warn("Could not remove the unused Worker:", cleanupError),
      );
    }
    const failure = toCloudflareDyadError(
      error,
      "Could not connect the Worker",
    );
    if (removedForeignRule && failure instanceof DyadError) {
      // Cloudflare refuses a new rule while the old one exists, so it was
      // already gone when this failed, and its secrets cannot be read back
      // to recreate it. The user has to be told. The repository is not named:
      // they confirmed it a moment ago, and the message goes out with the
      // error report.
      throw new DyadError(
        `${failure.message} The rule that deployed this Worker from the other repository was already removed and has not been put back.`,
        failure.kind,
      );
    }
    throw failure;
  }
}

/** The Worker's address given what its route is now, which may not be what was stored. */
async function currentWorkerUrl(
  token: string,
  row: ConnectionRow,
  routeEnabled: boolean | undefined,
): Promise<string | null> {
  if (routeEnabled === undefined) return row.workerUrl;
  if (!routeEnabled) return null;
  if (row.workerUrl) return row.workerUrl;
  const subdomain = await getAccountSubdomain(token, row.accountId).catch(
    () => null,
  );
  return subdomain
    ? `https://${row.workerName}.${subdomain}.workers.dev`
    : null;
}

async function handleGetDeploymentStatus({
  appId,
  rootDirectory,
}: {
  appId: number;
  rootDirectory: string;
}): Promise<CloudflareDeploymentStatus> {
  const token = requireToken();
  const app = await requireApp(appId);
  const row = await findConnection(appId, rootDirectory);
  if (!row) {
    throw new DyadError(
      "This folder is not connected to a Worker.",
      DyadErrorKind.NotFound,
    );
  }

  try {
    const [build, rule, routeEnabled] = await Promise.all([
      getLatestBuild(token, row.accountId, row.workerTag, row.triggerUuid),
      // A rule deleted in the Cloudflare dashboard leaves the Worker and its
      // last build in place, so nothing else would show that deploys stopped.
      // Failing to list rules is not evidence that the rule is gone.
      listTriggers(token, row.accountId, row.workerTag)
        .then(
          (triggers) =>
            triggers.find(
              (trigger) => trigger.trigger_uuid === row.triggerUuid,
            ) ?? null,
        )
        .catch(() => undefined),
      // The route can be switched in the dashboard, and a deploy applies
      // whatever the Wrangler config says. Not knowing keeps the stored address.
      isWorkersDevRouteEnabled(token, row.accountId, row.workerName).catch(
        () => undefined,
      ),
    ]);
    const workerUrl = await currentWorkerUrl(token, row, routeEnabled);
    const ruleMissing = rule === null;
    // The rule stays on the branch and repository it was made for. An app
    // moved to another one still syncs, but nothing deploys.
    const ruleDeploys =
      rule &&
      !triggerDeploys(rule, {
        owner: app.githubOrg,
        repo: app.githubRepo,
        branch: app.githubBranch ?? DEFAULT_BRANCH,
        rootDirectory: row.rootDirectory,
      })
        ? describeTriggerSource(rule)
        : null;
    if (!build) {
      return {
        state: "none",
        commitHash: null,
        logTail: [],
        tokenRevoked: false,
        ruleMissing,
        ruleDeploys,
        workerUrl,
      };
    }
    const state = toDeploymentState(build);
    let logTail: string[] = [];
    if (state === "failed") {
      // The log explains a failure, but a status without it is still useful.
      logTail = await getBuildLogLines(token, row.accountId, build.build_uuid)
        .then((lines) => lines.slice(-LOG_TAIL_LINES))
        .catch(() => []);
    }
    return {
      state,
      commitHash: build.build_trigger_metadata?.commit_hash ?? null,
      logTail,
      tokenRevoked: isBuildTokenRevokedLog(logTail),
      ruleMissing,
      ruleDeploys,
      workerUrl,
    };
  } catch (error) {
    throw toCloudflareDyadError(error, "Could not read the deployment status");
  }
}

async function handleDisconnect({
  appId,
  rootDirectory,
}: {
  appId: number;
  rootDirectory: string;
}): Promise<void> {
  const row = await findConnection(appId, rootDirectory);
  if (!row) {
    return;
  }
  // Without this the Worker would keep deploying on every push after Dyad
  // says it is disconnected. The Worker itself stays: it may be serving traffic.
  // With the token gone Dyad cannot reach Cloudflare, so the rule stays; the
  // connection is still forgotten so the app is not stuck connected.
  const token = readSettings().cloudflareAccessToken?.value;
  if (token) {
    try {
      await deleteTrigger(token, row.accountId, row.triggerUuid);
    } catch (error) {
      if (isCloudflareAuthFailure(error)) {
        // The way out is not obvious from Cloudflare's own message.
        throw new DyadError(
          "Cloudflare refused the saved API token, so the deploy rule could not be removed. Remove the token under Settings > Integrations, then add a working one and disconnect again. Disconnecting without a token also works, but leaves the rule on Cloudflare.",
          DyadErrorKind.Auth,
        );
      }
      throw toCloudflareDyadError(
        error,
        "Could not remove the deploy rule from Cloudflare",
      );
    }
  }
  await db
    .delete(cloudflareAppConnections)
    .where(eq(cloudflareAppConnections.id, row.id));
}

async function handleListWorkers(
  accountId: string,
): Promise<{ name: string }[]> {
  try {
    const workers = await listWorkers(requireToken(), accountId);
    return workers.map(({ name }) => ({ name }));
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 403) {
      // A token can be good for one account and not another.
      throw new DyadError(
        "This API token cannot use Workers in this Cloudflare account. Pick another account, or add a token that can.",
        DyadErrorKind.Auth,
      );
    }
    throw toCloudflareDyadError(error, "Could not list Workers");
  }
}

// --- Registration ---

const CONNECTION_RESOURCES = ["metadata", readAppResource("app-path")] as const;
const STATUS_RESOURCES = [
  readAppResource("app-path"),
  readAppResource("repository-ref"),
] as const;

export function registerCloudflareHandlers() {
  // DO NOT LOG this handler because tokens are sensitive
  createTypedHandler(cloudflareContracts.saveToken, async (_, { token }) => {
    assertCloudflareEnabled();
    await handleSaveToken(token);
  });

  createTypedHandler(cloudflareContracts.listAccounts, async () => {
    assertCloudflareEnabled();
    try {
      return await listAccounts(requireToken());
    } catch (error) {
      throw toCloudflareDyadError(error, "Could not list Cloudflare accounts");
    }
  });

  createTypedHandler(
    cloudflareContracts.listWorkers,
    async (_, { accountId }) => {
      assertCloudflareEnabled();
      return handleListWorkers(accountId);
    },
  );

  createTypedHandler(
    cloudflareContracts.getAppStatus,
    createAppOperationHandler(
      "cloudflare:get-app-status",
      STATUS_RESOURCES,
      async (_, { appId }: { appId: number }) => {
        assertCloudflareEnabled();
        return handleGetAppStatus(appId);
      },
    ),
  );

  createTypedHandler(cloudflareContracts.checkRepoAccess, async (_, params) => {
    assertCloudflareEnabled();
    return handleCheckRepoAccess(params);
  });

  createTypedHandler(
    cloudflareContracts.connectWorker,
    createAppOperationHandler(
      "cloudflare:connect-worker",
      [...CONNECTION_RESOURCES, readAppResource("repository-ref")],
      async (_, params: ConnectCloudflareWorkerParams) => {
        assertCloudflareEnabled();
        return handleConnectWorker(params);
      },
    ),
  );

  createTypedHandler(
    cloudflareContracts.getDeploymentStatus,
    async (_, params) => {
      assertCloudflareEnabled();
      return handleGetDeploymentStatus(params);
    },
  );

  createTypedHandler(
    cloudflareContracts.disconnect,
    createAppOperationHandler(
      "cloudflare:disconnect",
      CONNECTION_RESOURCES,
      async (_, params: { appId: number; rootDirectory: string }) => {
        assertCloudflareEnabled();
        await handleDisconnect(params);
      },
    ),
  );

  logger.debug("Registered Cloudflare IPC handlers");
}

export const cloudflareHandlersForTesting = {
  handleListWorkers,
  clearGithubIdentityCache: () => githubIdentityCache.clear(),
  handleSaveToken,
  handleGetAppStatus,
  handleCheckRepoAccess,
  handleConnectWorker,
  handleGetDeploymentStatus,
  handleDisconnect,
};
