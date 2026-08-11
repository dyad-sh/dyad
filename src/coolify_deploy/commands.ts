import { and, eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import { apps, coolifyAppConnections } from "@/db/schema";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { getClient, readConnection, readConnectionState } from "./store";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import {
  declaresStart,
  detectFrameworkType,
} from "@/ipc/utils/framework_utils";
import { buildConfigForFramework } from "@/coolify_deploy/build_config";
import {
  CoolifyClient,
  isCoolifyStatus,
  type CoolifyBuildConfig,
} from "@/ipc/utils/coolify_client";
import {
  applyCoolifyConnectionChange,
  coolifyConnectionRow,
  type CoolifyConnectionChange,
} from "./connection";
import {
  coolifyKeyName,
  ensureDeployKey,
  readPrivateKey,
  deployKeyFilePath,
  repoKeyName,
} from "@/ipc/utils/coolify_deploy_key";
import { getGitHubApiBase } from "@/ipc/handlers/github_handlers";
import {
  getCurrentCommitHash,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";
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
const GITHUB_TIMEOUT_MS = 30_000;
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DyadError("Deployment cancelled.", DyadErrorKind.UserCancelled);
  }
}

function githubSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(GITHUB_TIMEOUT_MS)]);
}

/** Reads a body under the same classifier, since it can stall after headers. */
async function githubBody(
  read: () => Promise<string>,
  signal: AbortSignal,
): Promise<string> {
  try {
    return await read();
  } catch (err) {
    throw githubError(err, signal);
  }
}

/** Cancels with the deployment, and independently if GitHub goes quiet. */
async function githubFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: githubSignal(signal) });
  } catch (err) {
    throw githubError(err, signal);
  }
}

function githubError(err: unknown, signal: AbortSignal): DyadError {
  if (signal.aborted) {
    return new DyadError("Deployment cancelled.", DyadErrorKind.UserCancelled);
  }
  const timedOut = err instanceof Error && err.name === "TimeoutError";
  return new DyadError(
    `Could not reach GitHub to register the deploy key: ${
      timedOut
        ? `no response within ${GITHUB_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err)
    }`,
    DyadErrorKind.External,
  );
}

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.schedule(resolve, ms));
}

/**
 * Applies a change to the app's Coolify record, fenced to one connection.
 *
 * Read-modify-write rather than a partial update, so the record cannot end up
 * describing an application on one server and an address on another. What
 * makes that safe is the fence, not the absence of other writers: a disconnect
 * landing between the read and the write deletes the row this was pinned to,
 * so the write then matches nothing rather than putting a stale record back.
 *
 * Fenced on the row the deploy started against, by id. Naming the host instead
 * described where it deploys rather than which connection it is, and those
 * differ the moment one is replaced by another to the same place: disconnect
 * mid-deploy, reconnect to the same server and project, and a write meant for
 * the connection that was abandoned lands on its replacement — hanging the old
 * application and address on it. Nothing announces that, and a later deploy
 * adopts the old application and leaves whatever domain it holds in place.
 */
async function recordConnectionChange(
  appId: number,
  connectionId: number,
  change: CoolifyConnectionChange,
): Promise<void> {
  const next = applyCoolifyConnectionChange(
    await readConnectionState(appId),
    change,
  );
  const row = coolifyConnectionRow(next);
  if (!row) return;
  // The whole row every time, fenced to the row this deploy started on. A
  // deploy can run for fifteen minutes, and an app disconnected or pointed at
  // a different Coolify meanwhile matches nothing here rather than receiving
  // an application id and URL that exist only on the instance it left.
  await db
    .update(coolifyAppConnections)
    .set(row)
    .where(
      and(
        eq(coolifyAppConnections.id, connectionId),
        eq(coolifyAppConnections.appId, appId),
      ),
    );
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
  signal,
}: {
  owner: string;
  repo: string;
  report: DeployReporter;
  signal: AbortSignal;
}): Promise<{ keyName: string; publicKey: string }> {
  const keyName = repoKeyName(owner, repo);
  // Returns the public half and throws if it cannot be read, so there is no
  // second read here and no branch for a null that cannot arrive.
  const publicKey = await ensureDeployKey(keyName);
  const accessToken = readSettings().githubAccessToken?.value;
  if (!accessToken) {
    throw new DyadError(
      "Not authenticated with GitHub, so the deploy key could not be added to " +
        `${owner}/${repo}. Reconnect GitHub and try again.`,
      DyadErrorKind.Auth,
    );
  }

  const res = await githubFetch(
    `${getGitHubApiBase()}/repos/${owner}/${repo}/keys`,
    {
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
    },
    signal,
  );

  if (res.ok) {
    report.log(`Added the deploy key to ${owner}/${repo}.\n`);
    return { keyName, publicKey };
  }
  const body = await githubBody(() => res.text(), signal);
  if (res.status === 422 && /already in use/i.test(body)) {
    const listed = await githubFetch(
      `${getGitHubApiBase()}/repos/${owner}/${repo}/keys`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
      signal,
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
    const listedBody = await githubBody(() => listed.text(), signal);
    let keys: Array<{ key?: string }>;
    try {
      const parsed: unknown = JSON.parse(listedBody);
      // Parsing is not enough: GitHub answers errors as a JSON object, and an
      // object reaching .some below is a TypeError naming neither GitHub nor
      // the key — which is the whole point of classifying this.
      if (!Array.isArray(parsed)) throw new Error("not a key list");
      keys = parsed as Array<{ key?: string }>;
    } catch {
      // A proxy or a sign-in page answers 200 with HTML. Left bare that is a
      // SyntaxError with no mention of GitHub or the deploy key, which is the
      // whole explanation the user gets for a failed deploy.
      throw new DyadError(
        `GitHub returned something other than a key list for ${owner}/${repo}, ` +
          `so Dyad could not tell whether the deploy key it holds is already ` +
          `registered there. Try again in a moment.`,
        DyadErrorKind.External,
      );
    }
    // GitHub returns the key without its trailing comment.
    const ours = publicKey.split(/\s+/).slice(0, 2).join(" ");
    if (keys.some((k) => (k.key ?? "").startsWith(ours))) {
      report.log(`Deploy key already present on ${owner}/${repo}.\n`);
      return { keyName, publicKey };
    }
    throw new DyadError(
      `The deploy key for ${owner}/${repo} is already registered on a different ` +
        `repository, so GitHub will not accept it here. Remove it from the other ` +
        `repository's deploy keys, or delete ${deployKeyFilePath(keyName)} to ` +
        `generate a new ` +
        `one — Dyad registers a regenerated key with Coolify under a new name.`,
      DyadErrorKind.Validation,
    );
  }
  if (res.status === 401 || res.status === 403) {
    // The guard above only proves a token exists. One that is revoked,
    // expired, or blocked by an org's SAML enforcement is the same problem
    // for the user as having none, and rules/dyad-errors.md puts both under
    // Auth — the Coolify client classifies its equivalent the same way.
    throw new DyadError(
      `GitHub rejected the stored account when registering the deploy key ` +
        `for ${owner}/${repo} (${res.status}). Reconnect GitHub and try again.`,
      DyadErrorKind.Auth,
    );
  }
  throw new DyadError(
    `Could not add the deploy key to ${owner}/${repo} (${res.status}): ${body.slice(0, 200)}`,
    DyadErrorKind.External,
  );
}

/**
 * Coolify's deployment log as something a person can read.
 *
 * The field is a JSON array of entries, so piping it straight through shows
 * the user a blob of escaped newlines and quoting rather than what the
 * builder said — and the out-of-memory match below reads the same string, so
 * it too was matching around JSON punctuation rather than log lines.
 *
 * Anything that is not that shape comes back untouched: an instance version
 * that reports plain text should not lose its log to a parse failure.
 */
function readableDeploymentLog(logs: string): string {
  try {
    const parsed: unknown = JSON.parse(logs);
    if (!Array.isArray(parsed)) return logs;
    const lines = parsed
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof (entry as { output?: unknown })?.output === "string"
            ? (entry as { output: string }).output
            : null,
      )
      .filter((line): line is string => line !== null);
    return lines.length > 0 ? lines.join("\n") : logs;
  } catch {
    return logs;
  }
}

/**
 * Whether the instance currently configured still knows the app's server.
 *
 * A failed lookup answers "yes": it is not evidence the app moved, and
 * treating a network blip as one would refuse a deploy that would have
 * worked.
 */
async function serverIsOnThisInstance(
  client: CoolifyClient,
  serverUuid: string,
): Promise<boolean> {
  try {
    const servers = await client.listServers();
    return servers.some((server) => server.uuid === serverUuid);
  } catch {
    return true;
  }
}

/**
 * Returns a usable application uuid, recreating one that has been deleted in
 * Coolify. Without the not-found check a stale uuid is kept forever and every
 * later request targets a missing application, so retries cannot recover.
 */
async function resolveApplication({
  client,
  savedUuid,
  privateKeyId,
  create,
  expectedServerUuid,
  onPreviousGone,
  report,
  signal,
}: {
  client: CoolifyClient;
  savedUuid: string | null;
  privateKeyId: number | null;
  create: () => Promise<string>;
  /** The server this app is pinned to, used to tell a 404 apart from a move. */
  expectedServerUuid: string;
  /** Called once the saved application is no longer the one to deploy to. */
  onPreviousGone: () => Promise<void>;
  report: DeployReporter;
  signal: AbortSignal;
}): Promise<string> {
  // Only when Coolify confirmed the removal. A request that failed or was
  // cancelled says nothing either way, and the message below is worth having
  // precisely because it is not a guess.
  let removedPrevious = false;
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
        // Recreating regardless, since the old application cannot clone. But
        // say so when it survives: it keeps running, keeps the domain, and
        // the log would otherwise describe a replacement rather than a second
        // application the user has to remove in Coolify themselves.
        try {
          await client.deleteApplication(savedUuid);
          removedPrevious = true;
        } catch {
          // A cancelled request is not a request that did not happen. The
          // client cancels through the deploy's own signal, so a disconnect
          // lands here having quite possibly already been processed, and the
          // old wording told the user it had survived either way.
          report.log(
            signal.aborted
              ? "The request to remove the old application was cancelled, so " +
                  "it may or may not still be on your server. Check in " +
                  "Coolify before deploying again.\n"
              : "Could not remove the old application; it is still on your " +
                  "server and may still hold the domain. Delete it in " +
                  "Coolify.\n",
          );
        }
      } else {
        return savedUuid;
      }
    } catch (error) {
      if (!isCoolifyStatus(error, 404)) throw error;
      // A 404 says the application is not on *this* instance, which is not
      // the same as saying it was deleted. If the server it was pinned to is
      // not here either, the token now points somewhere else and the
      // application is still running where it always was — recreating would
      // build a second one, and recording it as gone would throw away the one
      // id that cannot be re-entered.
      if (!(await serverIsOnThisInstance(client, expectedServerUuid))) {
        throw new DyadError(
          "This app deploys to a server that is not on the Coolify instance " +
            "you are connected to now. Its application is still running where " +
            "it was — connect back to that instance, or edit the connection " +
            "to move this app here.",
          DyadErrorKind.Precondition,
        );
      }
      report.log(
        "The application no longer exists in Coolify; recreating it.\n",
      );
    }
    // Coolify calls above can park for a long time, so re-check before going
    // on to create an application: one abandoned meanwhile must not leave a
    // new application behind on the user's server for nobody.
    throwIfAborted(signal);
    // Reported now rather than only on success: if creating the replacement
    // fails, the panel would otherwise keep offering the address of an
    // application Coolify has already confirmed is gone. Handed back rather
    // than written here, so this stays free of the database.
    await onPreviousGone();
  }
  if (!removedPrevious) return create();
  try {
    // Awaited inside the try on purpose: returning the promise would settle
    // it outside, where the catch below cannot see it fail.
    return await create();
  } catch (error) {
    // Logged, never wrapped. The error keeps its own kind and message, so a
    // cancellation is still UserCancelled and telemetry filters it exactly as
    // it did before. All this adds is the fact the user cannot see from the
    // failure alone: the application that was serving this app is gone, and
    // the deploy log is where they are looking when it happens.
    report.log(
      "The previous application was removed before this failed, so the app " +
        "is not running until a deploy succeeds.\n",
    );
    throw error;
  }
}

/**
 * Warns when the deploy would not build the code the user is looking at.
 *
 * Coolify clones from GitHub, so anything committed locally but not pushed is
 * invisible to it — the build succeeds against older code and the failure that
 * follows looks unrelated to the commits sitting unpushed.
 */
async function warnIfBranchNotPushed({
  appPath,
  branch,
  report,
}: {
  appPath: string;
  branch: string;
  report: DeployReporter;
}): Promise<void> {
  // Two questions, asked separately. Reading the remote ref throws when the
  // branch has never been pushed, and sharing one try with the working-tree
  // check meant that throw silently skipped it — in the one case where
  // nothing at all is on GitHub and the warning matters most.
  try {
    const [local, remote] = await Promise.all([
      getCurrentCommitHash({ path: appPath, ref: "HEAD" }),
      getCurrentCommitHash({
        path: appPath,
        ref: `refs/remotes/origin/${branch}`,
      }),
    ]);
    if (local !== remote) {
      report.log(
        `Warning: this app has commits that are not on origin/${branch}. ` +
          `Coolify builds from GitHub, so those changes will not be deployed ` +
          `until they are pushed.\n`,
      );
    }
  } catch {
    // Most often there is no origin/<branch> yet. Coolify clones by branch
    // name, so the build is going to fail looking for it, and saying so here
    // beats the same failure arriving from inside a container minutes later.
    report.log(
      `Warning: could not find origin/${branch} locally. If that branch has ` +
        `never been pushed, Coolify has nothing to clone and this deployment ` +
        `will fail.\n`,
    );
  }

  // Uncommitted work does not move HEAD, so the comparison above says nothing
  // about it. Deploying what is on GitHub is the intent, but a user looking
  // at edits Dyad has just made has no way to tell they are not in this
  // build.
  try {
    const uncommitted = await getGitUncommittedFiles({ path: appPath });
    if (uncommitted.length > 0) {
      report.log(
        `Warning: this app has ${uncommitted.length} uncommitted ` +
          `${uncommitted.length === 1 ? "file" : "files"}. Coolify builds ` +
          `from GitHub, so those edits are not in this deployment.\n`,
      );
    }
  } catch {
    // git is unhappy — not worth failing a deploy over.
  }
}

/**
 * Warns when the database being deployed is not the one the app was built
 * against.
 *
 * The publish panel's branch choice defaults to production, while an app the
 * agent built has its tables on whichever branch is active locally — usually
 * development. Deploying then points the app at a branch that has never seen
 * its schema, and every query fails with a 500 that looks like a broken
 * deploy rather than an empty database.
 */
function warnIfBranchLacksSchema({
  app,
  deployedBranchId,
  report,
}: {
  app: typeof apps.$inferSelect;
  deployedBranchId: string;
  report: DeployReporter;
}): void {
  const activeBranchId = app.neonActiveBranchId ?? app.neonDevelopmentBranchId;
  if (!activeBranchId || activeBranchId === deployedBranchId) return;
  report.log(
    `Warning: deploying against a different Neon branch than this app has ` +
      `been developed on. Tables created while building may not exist there, ` +
      `and requests that use them will fail. Change the database branch in ` +
      `the publish panel if that is not what you want.\n`,
  );
}

/**
 * The env vars a deployed app needs to reach its existing database.
 *
 * Resolved through the same helpers the Vercel sync uses, so both targets
 * honour the branch the user picked and carry the same set of variables. An
 * app whose auth base URL is missing builds and starts, then answers every
 * request that touches a session with a 500.
 */
async function resolveDatabaseEnv(
  app: typeof apps.$inferSelect,
  report: DeployReporter,
): Promise<{
  vars: Array<{ key: string; value: string }>;
  /** The branch being deployed, whether or not auth is in play. */
  branchId: string | null;
  /** Set only when Neon Auth is active, which is when trusted domains matter. */
  auth: { projectId: string; branchId: string } | null;
}> {
  if (!app.neonProjectId) return { vars: [], branchId: null, auth: null };
  const branchType = getSelectedDeployBranchType(app);
  const resolved = await resolveNeonBranchEnvVars({ appData: app, branchType });

  const vars = [{ key: "DATABASE_URL", value: resolved.databaseUrl }];
  if (!resolved.neonAuthBaseUrl) {
    // The resolver swallows a Neon Auth failure so a transient outage still
    // yields DATABASE_URL, which suits an incremental sync. Deploying is not
    // incremental: without this variable the app builds, starts, serves its
    // pages, and answers 500 on everything that touches a session — a
    // symptom that looks nothing like its cause.
    report.log(
      "Warning: Neon Auth could not be resolved for this branch, so " +
        "NEON_AUTH_BASE_URL was not set. Variables are updated one at a " +
        "time, so a value from an earlier deploy is still in place and this " +
        "may change nothing — but if this app has not deployed successfully " +
        "before, pages will load while anything reading a session fails. " +
        "Deploy again once Neon is reachable.\n",
    );
  }
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
    branchId: resolved.branchId,
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
  const { state: connection, id: connectionId } = await readConnection(appId);
  if (
    !settings.coolify?.instanceUrl ||
    connection.kind === "none" ||
    connectionId === null
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

  await warnIfBranchNotPushed({
    appPath: getDyadAppPath(app.path),
    branch: app.githubBranch ?? "main",
    report,
  });

  const client = getClient(signal);
  const resolvedAppPath = getDyadAppPath(app.path);
  const build: CoolifyBuildConfig = buildConfigForFramework(
    detectFrameworkType(resolvedAppPath),
    { declaresStart: declaresStart(resolvedAppPath) },
  );
  report.log(`Building as ${build.buildPack} on port ${build.portsExposes}.\n`);

  const { keyName, publicKey } = await ensureGithubDeployKey({
    owner: app.githubOrg,
    repo: app.githubRepo,
    report,
    signal,
  });
  throwIfAborted(signal);

  const key = await client.registerPrivateKey({
    // Named after the key material, so regenerating the local pair registers a
    // new entry instead of reusing one Coolify can never update.
    // The half already in hand, rather than a second read off disk with a
    // fallback that would fingerprint an empty string.
    name: coolifyKeyName(keyName, publicKey),
    description: "Key Dyad uses to let Coolify clone this repository",
    privateKey: readPrivateKey(keyName),
  });
  throwIfAborted(signal);

  const gitRepository = `git@github.com:${app.githubOrg}/${app.githubRepo}.git`;
  const gitBranch = app.githubBranch ?? "main";
  const serverUuid = connection.serverUuid;

  report.stage("configuring");
  // Absent until Coolify has one; the guard above already ruled out "none".
  const savedApplicationUuid =
    connection.kind === "configured" ? null : connection.applicationUuid;
  const applicationUuid = await resolveApplication({
    client,
    signal,
    savedUuid: savedApplicationUuid,
    expectedServerUuid: serverUuid,
    onPreviousGone: () =>
      recordConnectionChange(appId, connectionId, { type: "APPLICATION_GONE" }),
    privateKeyId: key.id,
    report,
    create: async () => {
      const created = await client.createApplicationFromPrivateRepo({
        serverUuid: connection.serverUuid,
        projectUuid: connection.projectUuid,
        environmentName: connection.environmentName,
        privateKeyUuid: key.uuid,
        gitRepository,
        gitBranch,
        name: `dyad-${app.name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        build,
        domains: connection.domain,
      });
      report.log(`Application created (${created.uuid}).\n`);
      return created.uuid;
    },
  });
  const recreated = applicationUuid !== savedApplicationUuid;
  if (recreated) {
    // Recorded before the abort check, not after. Coolify has already created
    // this application; an abort landing between the two would throw away the
    // only record of something that exists, and the next deploy would build a
    // second one beside it. The write is still fenced, so a connection that
    // was cleared meanwhile matches no row rather than being resurrected.
    await recordConnectionChange(appId, connectionId, {
      type: "APPLICATION_RESOLVED",
      applicationUuid,
    });
    throwIfAborted(signal);
  } else {
    // Framework or domain may have changed since the application was created.
    // Only send a domain we actually have: passing null would clear the
    // address Coolify generated at creation and it cannot generate another.
    await client.updateApplication(applicationUuid, {
      ...(connection.domain ? { domains: connection.domain } : {}),
      build,
      source: { gitRepository, gitBranch },
    });
  }
  throwIfAborted(signal);

  // A deploy that silently lacks its database reports success and then fails
  // on the first query, so a failure here fails the whole deployment.
  const database = await resolveDatabaseEnv(app, report).catch((error) => {
    // Neon classifies its own failures — a missing development branch is a
    // Precondition, an expired token is Auth — and rules/dyad-errors.md keeps
    // those out of telemetry. Rewrapping them as External would report every
    // one of them as a crash.
    if (isDyadError(error)) throw error;
    throw new DyadError(
      `Could not resolve this app's database connection details: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
    );
  });
  if (database.branchId) {
    warnIfBranchLacksSchema({
      app,
      deployedBranchId: database.branchId,
      report,
    });
  }
  for (const { key: envKey, value } of database.vars) {
    await client.setEnv(applicationUuid, envKey, value);
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
    // Tell the machine before probing. Everything below can throw, and the id
    // only survives a failure if the running state is already holding it —
    // otherwise the retry that was meant to adopt this build forgets it and
    // every later attempt is refused for a build that is still going.
    report.deploymentStarted(deploymentUuid);
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
        // Truncated after joining, so the cut lands on a line rather than in
        // the middle of a JSON structure.
        const readable = readableDeploymentLog(logs);
        report.log(`\n--- deployment log ---\n${readable.slice(-4000)}\n`);
        detail = " Check the deployment log above.";
        // A build killed rather than failed is nearly always the server
        // running out of memory or disk, which the log reports only as a
        // negative exit status.
        if (
          /exit status -1|signal: killed|\bKilled\b|cannot allocate memory|no space left on device/i.test(
            readable,
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

  // The connection form warns that a Neon app without HTTPS will not load,
  // but that was a screen ago and nothing since has repeated it. Saying so
  // here means the one place the user is looking when it happens — the deploy
  // log — explains the blank page they are about to get, rather than
  // reporting plain success for a deployment known to be broken.
  if (url && !url.toLowerCase().startsWith("https:") && database.auth) {
    report.log(
      "Warning: this app uses Neon Auth and is being served over plain " +
        "HTTP, where browsers withhold the Web Crypto API that Neon Auth " +
        "needs before the page mounts. The deployment itself is fine, but " +
        "the address above will load a blank page. Give the app an https " +
        "domain and deploy again.\n",
    );
  }

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
  await recordConnectionChange(appId, connectionId, {
    type: "DEPLOY_SUCCEEDED",
    appUrl: url,
    at: new Date(clock.now()),
  });
  logger.info(`Coolify deploy succeeded for app ${appId}`);
  return { url };
}
