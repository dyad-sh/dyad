import { and, eq, isNotNull } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { detectFrameworkType } from "@/ipc/utils/framework_utils";
import { buildConfigForFramework } from "@/shared/coolify_build_config";
import {
  CoolifyClient,
  isCoolifyStatus,
  type CoolifyBuildConfig,
} from "@/ipc/utils/coolify_client";
import {
  coolifyKeyName,
  ensureDeployKey,
  readPrivateKey,
  readPublicKey,
  repoKeyName,
} from "@/ipc/utils/coolify_deploy_key";
import { getGitHubApiBase } from "@/ipc/handlers/github_handlers";
import {
  ensureNeonAuthTrustedDomain,
  getSelectedDeployBranchType,
  resolveNeonBranchEnvVars,
} from "@/ipc/utils/neon_utils";
import { systemClock, type Clock } from "@/state_machines/clock";
import type { CoolifyDeployStage } from "./state";

const logger = log.scope("coolify_deploy_commands");

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
/** About a minute of unreachable instance before the deploy gives up. */
const MAX_POLL_FAILURES = 12;
const TERMINAL_STATUSES = ["finished", "failed", "error", "cancelled-by-user"];

/** How the pipeline reports progress back to the machine. */
export interface DeployReporter {
  stage(stage: CoolifyDeployStage): void;
  log(chunk: string): void;
  deploymentStarted(deploymentUuid: string): void;
}

export interface DeployResult {
  url: string | null;
}

function getClient(signal?: AbortSignal): CoolifyClient {
  const settings = readSettings();
  const token = settings.coolifyAccessToken?.value;
  const instanceUrl = settings.coolifyInstanceUrl;
  if (!token || !instanceUrl) {
    throw new DyadError(
      "Coolify is not connected. Add your instance URL and API token first.",
      DyadErrorKind.Validation,
    );
  }
  return new CoolifyClient({ instanceUrl, token, signal });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DyadError("Deployment cancelled.", DyadErrorKind.UserCancelled);
  }
}

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.schedule(resolve, ms));
}

/**
 * Matches the app only while it is still connected to a Coolify server.
 *
 * Disconnecting nulls those columns, and a pipeline already past its last
 * abort check would otherwise write an application id or URL back onto an app
 * the user has just cleared.
 */
function stillConnected(appId: number) {
  return and(eq(apps.id, appId), isNotNull(apps.coolifyServerUuid));
}

/**
 * Puts Dyad's public key on the repository as a deploy key.
 *
 * "Already in use" from GitHub does not mean it is on *this* repository — a
 * deploy key belongs to exactly one repo across all of GitHub — so confirm
 * rather than assume, or the clone fails later as "repository not found".
 */
async function ensureGithubDeployKey({
  owner,
  repo,
  report,
}: {
  owner: string;
  repo: string;
  report: DeployReporter;
}): Promise<string> {
  const keyName = repoKeyName(owner, repo);
  await ensureDeployKey(keyName);
  const publicKey = readPublicKey(keyName);
  if (!publicKey) {
    throw new DyadError(
      `Could not read the deploy key for ${owner}/${repo}.`,
      DyadErrorKind.External,
    );
  }
  const accessToken = readSettings().githubAccessToken?.value;
  if (!accessToken) {
    throw new DyadError(
      "Not authenticated with GitHub, so the deploy key could not be added to " +
        `${owner}/${repo}. Reconnect GitHub and try again.`,
      DyadErrorKind.Auth,
    );
  }

  const res = await fetch(`${getGitHubApiBase()}/repos/${owner}/${repo}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Dyad deploy key (Coolify)",
      key: publicKey,
      read_only: true,
    }),
  });

  if (res.ok) {
    report.log(`Added the deploy key to ${owner}/${repo}.\n`);
    return keyName;
  }
  const body = await res.text();
  if (res.status === 422 && /already in use/i.test(body)) {
    const listed = await fetch(
      `${getGitHubApiBase()}/repos/${owner}/${repo}/keys`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    // A failed lookup is not evidence the key belongs elsewhere; saying so would
    // send the user to delete a key that is very likely already correct.
    if (!listed.ok) {
      throw new DyadError(
        `GitHub rejected the deploy key for ${owner}/${repo} as already in use, ` +
          `and listing that repository's keys to check whether it is ours failed ` +
          `(${listed.status}). Try again in a moment.`,
        DyadErrorKind.External,
      );
    }
    const keys = (await listed.json()) as Array<{ key?: string }>;
    // GitHub returns the key without its trailing comment.
    const ours = publicKey.split(/\s+/).slice(0, 2).join(" ");
    if (keys.some((k) => (k.key ?? "").startsWith(ours))) {
      report.log(`Deploy key already present on ${owner}/${repo}.\n`);
      return keyName;
    }
    throw new DyadError(
      `The deploy key for ${owner}/${repo} is already registered on a different ` +
        `repository, so GitHub will not accept it here. Remove it from the other ` +
        `repository's deploy keys, or delete ~/.ssh/${keyName} to generate a new ` +
        `one — Dyad registers a regenerated key with Coolify under a new name.`,
      DyadErrorKind.Validation,
    );
  }
  throw new DyadError(
    `Could not add the deploy key to ${owner}/${repo} (${res.status}): ${body.slice(0, 200)}`,
    DyadErrorKind.External,
  );
}

/**
 * Returns a usable application uuid, recreating one that has been deleted in
 * Coolify. Without the not-found check a stale uuid is kept forever and every
 * later request targets a missing application, so retries cannot recover.
 */
async function resolveApplication({
  client,
  appId,
  savedUuid,
  privateKeyId,
  create,
  report,
  signal,
}: {
  client: CoolifyClient;
  appId: number;
  savedUuid: string | null;
  privateKeyId: number | null;
  create: () => Promise<string>;
  report: DeployReporter;
  signal: AbortSignal;
}): Promise<string> {
  if (savedUuid) {
    try {
      const existing = await client.getApplication(savedUuid);
      // An application records the key it clones with and Coolify offers no
      // way to change it, so one created with a stale key has to be replaced.
      //
      // Coolify hides private_key_id from tokens without read:sensitive, so an
      // absent value means "cannot tell", not "different". Treating it as a
      // mismatch would delete and recreate the application on every deploy.
      if (
        privateKeyId !== null &&
        existing.private_key_id != null &&
        existing.private_key_id !== privateKeyId
      ) {
        report.log(
          "The application clones with an outdated key; recreating it.\n",
        );
        await client.deleteApplication(savedUuid).catch(() => undefined);
      } else {
        return savedUuid;
      }
    } catch (error) {
      if (!isCoolifyStatus(error, 404)) throw error;
      report.log(
        "The application no longer exists in Coolify; recreating it.\n",
      );
    }
    // Coolify calls above can park for a long time, so re-check before writing:
    // a pipeline abandoned meanwhile must not blank a newer deployment's uuid.
    throwIfAborted(signal);
    await db
      .update(apps)
      .set({ coolifyApplicationUuid: null })
      .where(stillConnected(appId));
  }
  return create();
}

/**
 * The env vars a deployed app needs to reach its existing database.
 *
 * Resolved through the same helpers the Vercel sync uses, so both targets
 * honour the branch the user picked and carry the same set of variables. An
 * app whose auth base URL is missing builds and starts, then answers every
 * request that touches a session with a 500.
 */
async function resolveDatabaseEnv(app: typeof apps.$inferSelect): Promise<{
  vars: Array<{ key: string; value: string }>;
  /** Set only when Neon Auth is active, which is when trusted domains matter. */
  auth: { projectId: string; branchId: string } | null;
}> {
  if (!app.neonProjectId) return { vars: [], auth: null };
  const branchType = getSelectedDeployBranchType(app);
  const resolved = await resolveNeonBranchEnvVars({ appData: app, branchType });

  const vars = [{ key: "DATABASE_URL", value: resolved.databaseUrl }];
  if (resolved.neonAuthBaseUrl) {
    vars.push({ key: "NEON_AUTH_BASE_URL", value: resolved.neonAuthBaseUrl });
    // Only Next.js signs its own cookies; other frameworks forward them to
    // Neon Auth, which is why the resolver leaves this unset for them.
    if (resolved.isNextJs && resolved.neonAuthCookieSecret) {
      vars.push({
        key: "NEON_AUTH_COOKIE_SECRET",
        value: resolved.neonAuthCookieSecret,
      });
    }
  }
  return {
    vars,
    auth: resolved.neonAuthBaseUrl
      ? { projectId: app.neonProjectId, branchId: resolved.branchId }
      : null,
  };
}

export async function runDeployPipeline({
  appId,
  signal,
  report,
  resumeDeploymentUuid = null,
  clock = systemClock,
}: {
  appId: number;
  signal: AbortSignal;
  report: DeployReporter;
  /** A previous attempt's deployment, which may still be building. */
  resumeDeploymentUuid?: string | null;
  clock?: Clock;
}): Promise<DeployResult> {
  report.stage("preparing");

  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(`App ${appId} not found`, DyadErrorKind.NotFound);
  }
  const settings = readSettings();
  if (
    !settings.coolifyInstanceUrl ||
    !app.coolifyServerUuid ||
    !app.coolifyProjectUuid
  ) {
    throw new DyadError(
      "Connect a Coolify server for this app first.",
      DyadErrorKind.Validation,
    );
  }
  if (!app.githubOrg || !app.githubRepo) {
    throw new DyadError(
      "Coolify deploys from a git repository. Connect this app to GitHub first.",
      DyadErrorKind.Validation,
    );
  }

  const client = getClient(signal);
  const build: CoolifyBuildConfig = buildConfigForFramework(
    detectFrameworkType(getDyadAppPath(app.path)),
  );
  report.log(`Building as ${build.buildPack} on port ${build.portsExposes}.\n`);

  const keyName = await ensureGithubDeployKey({
    owner: app.githubOrg,
    repo: app.githubRepo,
    report,
  });
  throwIfAborted(signal);

  const key = await client.registerPrivateKey({
    // Named after the key material, so regenerating the local pair registers a
    // new entry instead of reusing one Coolify can never update.
    name: coolifyKeyName(keyName, readPublicKey(keyName) ?? ""),
    description: "Key Dyad uses to let Coolify clone this repository",
    privateKey: readPrivateKey(keyName),
  });
  throwIfAborted(signal);

  report.stage("configuring");
  const applicationUuid = await resolveApplication({
    client,
    appId,
    signal,
    savedUuid: app.coolifyApplicationUuid,
    privateKeyId: key.id,
    report,
    create: async () => {
      const created = await client.createApplicationFromPrivateRepo({
        serverUuid: app.coolifyServerUuid!,
        projectUuid: app.coolifyProjectUuid!,
        environmentName: app.coolifyEnvironmentName ?? "production",
        privateKeyUuid: key.uuid,
        gitRepository: `git@github.com:${app.githubOrg}/${app.githubRepo}.git`,
        gitBranch: app.githubBranch ?? "main",
        name: `dyad-${app.name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        build,
        domains: app.coolifyDomain,
      });
      report.log(`Application created (${created.uuid}).\n`);
      return created.uuid;
    },
  });
  const recreated = applicationUuid !== app.coolifyApplicationUuid;
  if (recreated) {
    throwIfAborted(signal);
    await db
      .update(apps)
      .set({ coolifyApplicationUuid: applicationUuid })
      .where(stillConnected(appId));
  } else {
    // Framework or domain may have changed since the application was created.
    // Only send a domain we actually have: passing null would clear the
    // address Coolify generated at creation and it cannot generate another.
    await client.updateApplication(applicationUuid, {
      ...(app.coolifyDomain ? { domains: app.coolifyDomain } : {}),
      build,
    });
  }
  throwIfAborted(signal);

  // A deploy that silently lacks its database reports success and then fails
  // on the first query, so a failure here fails the whole deployment.
  const database = await resolveDatabaseEnv(app).catch((error) => {
    throw new DyadError(
      `Could not resolve this app's database connection details: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
    );
  });
  for (const { key, value } of database.vars) {
    await client.setEnv(applicationUuid, key, value);
  }
  if (database.vars.length > 0) {
    report.log(
      `Wired to the app's existing database: ${database.vars
        .map((v) => v.key)
        .join(", ")}.\n`,
    );
  }
  throwIfAborted(signal);

  report.stage("building");

  // A previous attempt can fail while its build is still running — the poll
  // timeout does not stop it. Adopt that one rather than queueing a second
  // build on a server already busy with the first.
  // A deployment belongs to the application that ran it, so one from before a
  // recreate would report on an application that no longer exists.
  let deploymentUuid = (recreated ? null : resumeDeploymentUuid) ?? undefined;
  if (deploymentUuid) {
    // Only a 404 means the deployment is genuinely gone. Reading any other
    // failure as "not running" would start a second build alongside the one
    // this retry exists to adopt, on a server already busy with it.
    const prior = await client.getDeployment(deploymentUuid).catch((error) => {
      if (isCoolifyStatus(error, 404)) return null;
      throw error;
    });
    if (prior && !TERMINAL_STATUSES.includes(prior.status ?? "")) {
      report.log("A previous deployment is still running; following it.\n");
    } else {
      deploymentUuid = undefined;
    }
  }
  if (!deploymentUuid) {
    const deployment = await client.startApplication(applicationUuid);
    deploymentUuid = deployment?.deployment_uuid;
    if (!deploymentUuid) {
      // Coolify answers 2xx with only a message when it declines to queue the
      // build, typically because one is already running for this application.
      // There is nothing to poll, and falling through would report "last
      // status: unknown" — a status never actually asked for — for a build
      // that is in fact running.
      throw new DyadError(
        "Coolify accepted the deploy but returned no deployment to follow, " +
          "which usually means one is already running for this application. " +
          "Wait for it to finish, then deploy again.",
        DyadErrorKind.External,
      );
    }
  }
  report.deploymentStarted(deploymentUuid);

  let status = "unknown";
  const pollStart = clock.now();
  // A blip mid-build should not fail the deploy, but an instance that stays
  // unreachable should say so rather than look like a build that never ends.
  let consecutiveFailures = 0;
  let lastPollError: unknown = null;
  while (clock.now() - pollStart < POLL_TIMEOUT_MS) {
    await sleep(clock, POLL_INTERVAL_MS);
    throwIfAborted(signal);
    const entry = await client.getDeployment(deploymentUuid).catch((error) => {
      lastPollError = error;
      return null;
    });
    if (!entry) {
      if (++consecutiveFailures >= MAX_POLL_FAILURES) {
        throw new DyadError(
          `Lost contact with Coolify while the build was running: ${
            lastPollError instanceof Error
              ? lastPollError.message
              : String(lastPollError)
          }`,
          DyadErrorKind.External,
        );
      }
      continue;
    }
    consecutiveFailures = 0;
    status = entry.status ?? "unknown";
    report.log(`  status: ${status}\n`);
    if (TERMINAL_STATUSES.includes(status)) break;
  }

  if (status !== "finished") {
    let detail = "";
    {
      const entry = await client
        .getDeployment(deploymentUuid)
        .catch(() => null);
      const logs = entry?.logs;
      if (logs) {
        report.log(`\n--- deployment log ---\n${logs.slice(-4000)}\n`);
        detail = " Check the deployment log above.";
        // A build killed rather than failed is nearly always the server
        // running out of memory or disk, which the log reports only as a
        // negative exit status.
        if (
          /exit status -1|signal: killed|\bKilled\b|cannot allocate memory|no space left on device/i.test(
            logs,
          )
        ) {
          detail +=
            " The build was killed rather than failing, which usually means" +
            " the server ran out of memory or disk. Building needs more" +
            " headroom than running the app does, so a server that hosts it" +
            " fine can still fail to build it.";
        }
      }
    }
    throw new DyadError(
      `Deployment did not finish (last status: ${status}).${detail}`,
      DyadErrorKind.External,
    );
  }

  const application = await client.getApplication(applicationUuid);
  const url = (application.fqdn ?? "").split(",")[0] || null;

  // Neon Auth rejects sign-in from an origin it does not know, which reaches
  // the user as "Invalid origin" — a working deployment that cannot log in.
  // Best-effort: the app is already live, so a failure here is a warning
  // rather than a failed deploy.
  if (url && database.auth) {
    try {
      const added = await ensureNeonAuthTrustedDomain({
        ...database.auth,
        origin: url,
      });
      if (added) {
        report.log(`Allowed sign-in from ${added} in Neon Auth.\n`);
      }
    } catch (error) {
      report.log(
        `Could not register ${url} as a Neon Auth trusted domain, so signing ` +
          `in may fail with "Invalid origin": ${
            error instanceof Error ? error.message : String(error)
          }\n`,
      );
    }
  }

  throwIfAborted(signal);
  await db
    .update(apps)
    .set({ coolifyAppUrl: url, coolifyLastDeployedAt: new Date() })
    .where(stillConnected(appId));
  logger.info(`Coolify deploy succeeded for app ${appId}`);
  return { url };
}
