import { BrowserWindow } from "electron";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { readSettings, writeSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { coolifyContracts, coolifyEvents } from "../types/coolify";
import type {
  CoolifyConnection,
  CoolifyInstallSnapshot,
  CoolifyDeploySnapshot,
  CoolifyDeployStage,
} from "../types/coolify";
import { CoolifyClient, resolveServerSshHost } from "../utils/coolify_client";
import { safeSend } from "../utils/safe_sender";
import { shouldProvisionDatabase } from "@/shared/coolify_provisioning";
import {
  deployKeyExists,
  ensureDeployKey,
  regenerateDeployKey,
  isSshAvailable,
  keyFilePath,
  readPublicKey,
  runRemoteStreaming,
  testConnection,
  type SshTarget,
} from "../utils/ssh_utils";
import { withDatabaseTunnel } from "../utils/ssh_tunnel";
import {
  buildInstallCommand,
  dashboardUrl,
  generateAdminCredentials,
  waitForDashboard,
} from "../utils/coolify_install";
import { generateNeonMigrationStatements } from "../utils/migration_utils";
import {
  executePostgresSql,
  executePostgresStatementsInTransaction,
} from "@/postgres_admin/postgres_context";
import { getConnectionUri } from "@/neon_admin/neon_context";
import { getProductionBranchId } from "../utils/neon_utils";
import * as fs from "fs";
import { getGitHubApiBase } from "./github_handlers";

const logger = log.scope("coolify_handlers");

const MAX_LOG_CHARS = 200_000;
const DEPLOY_POLL_TIMEOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Deploy runner
// ---------------------------------------------------------------------------

const snapshots = new Map<number, CoolifyDeploySnapshot>();

function idleSnapshot(): CoolifyDeploySnapshot {
  return {
    status: "idle",
    stage: null,
    error: null,
    log: "",
    url: null,
    startedAt: null,
    finishedAt: null,
  };
}

function getSnapshot(appId: number): CoolifyDeploySnapshot {
  return snapshots.get(appId) ?? idleSnapshot();
}

function broadcast(appId: number): void {
  const payload = { appId, snapshot: getSnapshot(appId) };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      safeSend(window.webContents, coolifyEvents.deployStatus.channel, payload);
    }
  }
}

function update(
  appId: number,
  patch: Partial<CoolifyDeploySnapshot>,
  appendLog?: string,
): void {
  const current = getSnapshot(appId);
  const next: CoolifyDeploySnapshot = { ...current, ...patch };
  if (appendLog) {
    next.log = (current.log + appendLog).slice(-MAX_LOG_CHARS);
  }
  snapshots.set(appId, next);
  broadcast(appId);
}

function stage(appId: number, s: CoolifyDeployStage, message: string): void {
  update(appId, { stage: s }, `${message}\n`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient(): CoolifyClient {
  const settings = readSettings();
  const token = settings.coolifyAccessToken?.value;
  const instanceUrl = settings.coolifyInstanceUrl;
  if (!token || !instanceUrl) {
    throw new DyadError(
      "Coolify is not connected. Add your instance URL and API token first.",
      DyadErrorKind.Validation,
    );
  }
  return new CoolifyClient({ instanceUrl, token });
}

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(`App ${appId} not found`, DyadErrorKind.NotFound);
  }
  return app;
}

function readConnection(app: {
  coolifyServerUuid: string | null;
  coolifyProjectUuid: string | null;
  coolifyEnvironmentName: string | null;
  coolifySshHost: string | null;
  coolifySshUser: string | null;
  coolifySshPort: number | null;
}): CoolifyConnection | null {
  const settings = readSettings();
  if (
    !settings.coolifyInstanceUrl ||
    !app.coolifyServerUuid ||
    !app.coolifyProjectUuid ||
    !app.coolifySshHost
  ) {
    return null;
  }
  return {
    instanceUrl: settings.coolifyInstanceUrl,
    serverUuid: app.coolifyServerUuid,
    projectUuid: app.coolifyProjectUuid,
    environmentName: app.coolifyEnvironmentName ?? "production",
    sshHost: app.coolifySshHost,
    sshUser: app.coolifySshUser ?? "root",
    sshPort: app.coolifySshPort ?? 22,
  };
}

function sshTargetFor(connection: CoolifyConnection): SshTarget {
  return {
    host: connection.sshHost,
    user: connection.sshUser,
    port: connection.sshPort,
  };
}

/**
 * Diffs the app's Neon development database against the Coolify-provisioned
 * production database and applies the delta. The production database is only
 * reachable through the SSH tunnel, which also encrypts the connection.
 */
/**
 * Waits until a provisioned database is actually running.
 *
 * Creating one only queues it, so the container does not exist for a while
 * afterwards and inspecting it fails with "no such object".
 */
async function waitForDatabaseRunning({
  appId,
  databaseUuid,
}: {
  appId: number;
  databaseUuid: string;
}): Promise<void> {
  const client = getClient();
  const deadline = Date.now() + 3 * 60 * 1000;
  let sawStatus = false;
  while (Date.now() < deadline) {
    const database = await client.getDatabase(databaseUuid);
    const status = String(database.status ?? "");
    if (status) {
      sawStatus = true;
      if (status.startsWith("running")) {
        update(appId, {}, `Database is running (${status}).\n`);
        return;
      }
    }
    update(appId, {}, `  waiting for database... ${status || "(no status)"}\n`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new DyadError(
    sawStatus
      ? "The database did not start in time."
      : "Coolify never reported a database status, so it could not be confirmed running.",
    DyadErrorKind.External,
  );
}

async function migrateProduction({
  appId,
  connection,
  databaseUuid,
  devConnectionString,
}: {
  appId: number;
  connection: CoolifyConnection;
  databaseUuid: string;
  devConnectionString: string;
}): Promise<void> {
  const client = getClient();
  const database = await client.getDatabase(databaseUuid);
  const internalUrl = database.internal_db_url;
  if (!internalUrl) {
    throw new DyadError(
      "Coolify did not return the database connection string. The API token " +
        "needs the read:sensitive scope.",
      DyadErrorKind.Validation,
    );
  }
  // The internal URL's host is the container name, which only resolves inside
  // the docker network; the tunnel rewrites it to the local end.
  const containerName = new URL(internalUrl).hostname;

  await withDatabaseTunnel(
    { target: sshTargetFor(connection), containerName },
    async (rewrite) => {
      const prodUrl = rewrite(internalUrl);
      const statements = await generateNeonMigrationStatements({
        currentDatabaseUrl: prodUrl,
        desiredDatabaseUrl: devConnectionString,
      });
      if (statements.length === 0) {
        // An empty diff reads as reassuring, but it also happens when there is
        // simply nothing to copy yet. Say which, so a deployed app that cannot
        // find its tables is not a mystery.
        const devTables = await executePostgresSql({
          connectionString: devConnectionString,
          query:
            "SELECT count(*)::int AS count FROM information_schema.tables " +
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
        }).catch(() => null);
        const isDevEmpty = devTables !== null && /"count":\s*0/.test(devTables);
        update(
          appId,
          {},
          isDevEmpty
            ? "The development database has no tables, so nothing was copied " +
                "to production. Build a feature that stores data first; the " +
                "deployed app will not find any tables until then.\n"
            : "Schema already up to date.\n",
        );
        return;
      }
      update(
        appId,
        {},
        `Applying ${statements.length} schema statement(s) to production...\n`,
      );
      await executePostgresStatementsInTransaction({
        connectionString: prodUrl,
        statements: statements.map((s) => s.sql),
      });
      update(appId, {}, "Schema applied.\n");
    },
  );
}

async function resolveDevConnectionString(app: {
  neonProjectId: string | null;
  neonDevelopmentBranchId: string | null;
}): Promise<string | null> {
  if (!app.neonProjectId || !app.neonDevelopmentBranchId) return null;
  return getConnectionUri({
    projectId: app.neonProjectId,
    branchId: app.neonDevelopmentBranchId,
    // Schema diffing sets statement_timeout as a startup parameter, which
    // Neon's pooler rejects. The existing migration path is unpooled for the
    // same reason.
    pooled: false,
  });
}

/**
 * Authorises Coolify to clone the app's private repository.
 *
 * Coolify clones with the key Dyad registered, so that key's public half has
 * to be a deploy key on the repository or the clone fails with "permission
 * denied (publickey)". Dyad is already authenticated with GitHub, so add it
 * rather than asking the user to copy it across by hand.
 */
function repoKeyName(owner: string, repo: string): string {
  // GitHub allows a given deploy key on only one repository, so each repo
  // needs its own. Keep the name filesystem-safe.
  return `dyad_deploy_${owner}_${repo}`.replace(/[^A-Za-z0-9_.-]/g, "-");
}

async function ensureGithubDeployKey({
  appId,
  owner,
  repo,
}: {
  appId: number;
  owner: string;
  repo: string;
}): Promise<string> {
  const keyName = repoKeyName(owner, repo);
  await ensureDeployKey(keyName);
  const publicKey = readPublicKey(keyName);
  if (!publicKey) {
    throw new DyadError(
      `Could not read the deploy key for ${owner}/${repo}.`,
      DyadErrorKind.Validation,
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
    update(appId, {}, `Added the deploy key to ${owner}/${repo}.\n`);
    return keyName;
  }
  const body = await res.text();
  // "Already in use" does not mean it is on *this* repository — a deploy key
  // belongs to exactly one repo across all of GitHub. Confirm rather than
  // assume, or the clone fails later with a misleading "repository not found".
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
    const keys = listed.ok
      ? ((await listed.json()) as Array<{ key?: string }>)
      : [];
    // GitHub returns the key without its trailing comment.
    const ours = publicKey.split(/\s+/).slice(0, 2).join(" ");
    if (keys.some((k) => (k.key ?? "").startsWith(ours))) {
      update(appId, {}, `Deploy key already present on ${owner}/${repo}.\n`);
      return keyName;
    }
    throw new DyadError(
      `The deploy key for ${owner}/${repo} is already registered on a different ` +
        `repository, so GitHub will not accept it here. Remove it from the other ` +
        `repository's deploy keys, or delete ~/.ssh/${keyName} to generate a new one.`,
      DyadErrorKind.Validation,
    );
  }
  throw new DyadError(
    `Could not add the deploy key to ${owner}/${repo} (${res.status}): ${body.slice(0, 200)}`,
    DyadErrorKind.External,
  );
}

async function runDeploy({ appId }: { appId: number }): Promise<void> {
  const startedAt = Date.now();
  update(appId, {
    status: "running",
    stage: "preflight",
    error: null,
    log: "",
    url: null,
    startedAt,
    finishedAt: null,
  });

  try {
    const app = await getApp(appId);
    const connection = readConnection(app);
    if (!connection) {
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

    const client = getClient();
    stage(appId, "preflight", "Checking SSH access to the server...");
    const sshCheck = await testConnection(sshTargetFor(connection));
    if (!sshCheck.ok) {
      throw new DyadError(
        `Cannot reach the server over SSH: ${sshCheck.error}`,
        DyadErrorKind.External,
      );
    }
    update(appId, {}, "SSH OK.\n");

    const provisionDatabase = shouldProvisionDatabase(app);
    let databaseUuid = app.coolifyDatabaseUuid;
    if (provisionDatabase) {
      if (databaseUuid) {
        update(appId, {}, `Reusing database ${databaseUuid}.\n`);
      } else {
        stage(appId, "provision-database", "Provisioning Postgres...");
        const created = await client.createPostgres({
          serverUuid: connection.serverUuid,
          projectUuid: connection.projectUuid,
          environmentName: connection.environmentName,
          name: `dyad-${app.name}-db`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        });
        databaseUuid = created.uuid;
        await db
          .update(apps)
          .set({ coolifyDatabaseUuid: databaseUuid })
          .where(eq(apps.id, appId));
        update(appId, {}, `Database created (${databaseUuid}).\n`);
      }

      await waitForDatabaseRunning({ appId, databaseUuid });

      const devConnectionString = await resolveDevConnectionString(app);
      if (devConnectionString) {
        stage(
          appId,
          "migrate",
          "Migrating production schema over SSH tunnel...",
        );
        await migrateProduction({
          appId,
          connection,
          databaseUuid,
          devConnectionString,
        });
      } else {
        update(
          appId,
          {},
          "No development database connected; skipping schema migration.\n",
        );
      }
    }

    // Runs on every deploy, not just the first: an application created before
    // this step existed still has an unauthorised clone, and GitHub treats
    // adding a key that is already present as a no-op.
    const repoKey = await ensureGithubDeployKey({
      appId,
      owner: app.githubOrg,
      repo: app.githubRepo,
    });

    // Register the key up front: an application records the key it clones with
    // and Coolify offers no way to change it afterwards, so one created with a
    // stale key has to be replaced.
    const privateKey = fs.readFileSync(keyFilePath(repoKey), "utf8");
    const key = await client.registerPrivateKey({
      // Named per repository to match the deploy key GitHub accepted.
      name: repoKey,
      description: "Key Dyad uses to let Coolify clone this repository",
      privateKey,
    });

    let applicationUuid = app.coolifyApplicationUuid;
    if (applicationUuid && key.id !== null) {
      const existing = await client
        .getApplication(applicationUuid)
        .catch(() => null);
      if (existing && existing.private_key_id !== key.id) {
        update(
          appId,
          {},
          "The application clones with an outdated key; recreating it.\n",
        );
        await client.deleteApplication(applicationUuid).catch(() => undefined);
        applicationUuid = null;
        await db
          .update(apps)
          .set({ coolifyApplicationUuid: null })
          .where(eq(apps.id, appId));
      }
    }

    if (!applicationUuid) {
      stage(appId, "create-application", "Creating the Coolify application...");
      const created = await client.createApplicationFromPrivateRepo({
        serverUuid: connection.serverUuid,
        projectUuid: connection.projectUuid,
        environmentName: connection.environmentName,
        privateKeyUuid: key.uuid,
        gitRepository: `git@github.com:${app.githubOrg}/${app.githubRepo}.git`,
        gitBranch: app.githubBranch ?? "main",
        name: `dyad-${app.name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        portsExposes: "3000",
      });
      applicationUuid = created.uuid;
      await db
        .update(apps)
        .set({ coolifyApplicationUuid: applicationUuid })
        .where(eq(apps.id, appId));
      update(appId, {}, `Application created (${applicationUuid}).\n`);
    }

    if (provisionDatabase && databaseUuid) {
      const database = await client.getDatabase(databaseUuid);
      if (database.internal_db_url) {
        await client.setEnv(
          applicationUuid,
          "DATABASE_URL",
          database.internal_db_url,
        );
        update(appId, {}, "DATABASE_URL wired to the application.\n");
      }
    } else if (app.neonProjectId) {
      // Coolify is hosting the app but not its database. The app still needs
      // to reach the one it already has, or it deploys with no connection
      // string at all.
      try {
        const { branchId } = await getProductionBranchId(app.neonProjectId);
        const uri = await getConnectionUri({
          projectId: app.neonProjectId,
          branchId,
        });
        await client.setEnv(applicationUuid, "DATABASE_URL", uri);
        update(
          appId,
          {},
          "DATABASE_URL wired to the app's existing database.\n",
        );
      } catch (error) {
        update(
          appId,
          {},
          `Could not resolve the existing database's connection string: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }

    stage(appId, "deploy", "Deploying...");
    const deployment = await client.startApplication(applicationUuid);
    const deploymentUuid = deployment.deployment_uuid;
    let status = "unknown";
    const pollStart = Date.now();
    while (deploymentUuid && Date.now() - pollStart < DEPLOY_POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 10_000));
      const entry = await client
        .getDeployment(deploymentUuid)
        .catch(() => null);
      status = entry?.status ?? "unknown";
      update(appId, {}, `  status: ${status}\n`);
      if (
        ["finished", "failed", "error", "cancelled-by-user"].includes(status)
      ) {
        break;
      }
    }
    if (status !== "finished") {
      // The status alone says nothing about the cause, so pull the build log.
      let detail = "";
      if (deploymentUuid) {
        const entry = await client
          .getDeployment(deploymentUuid)
          .catch(() => null);
        const logs = (entry as { logs?: string } | null)?.logs;
        if (logs) {
          const tail = logs.slice(-4000);
          update(appId, {}, `\n--- deployment log ---\n${tail}\n`);
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

    stage(appId, "finalize", "Resolving the application URL...");
    const application = await client.getApplication(applicationUuid);
    const url = (application.fqdn ?? "").split(",")[0] || null;
    await db
      .update(apps)
      .set({ coolifyAppUrl: url, coolifyLastDeployedAt: new Date() })
      .where(eq(apps.id, appId));

    update(appId, {
      status: "succeeded",
      stage: null,
      url,
      finishedAt: Date.now(),
    });
    logger.info(`Coolify deploy succeeded for app ${appId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Coolify deploy failed for app ${appId}: ${message}`);
    update(
      appId,
      { status: "failed", error: message, finishedAt: Date.now() },
      `\nFailed: ${message}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

let installSnapshot: CoolifyInstallSnapshot = {
  status: "idle",
  log: "",
  error: null,
  dashboardUrl: null,
  credentials: null,
};

function broadcastInstall(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      safeSend(window.webContents, coolifyEvents.installStatus.channel, {
        snapshot: installSnapshot,
      });
    }
  }
}

function updateInstall(
  patch: Partial<CoolifyInstallSnapshot>,
  appendLog?: string,
): void {
  installSnapshot = { ...installSnapshot, ...patch };
  if (appendLog) {
    installSnapshot.log = (installSnapshot.log + appendLog).slice(
      -MAX_LOG_CHARS,
    );
  }
  broadcastInstall();
}

async function runInstall(
  target: SshTarget,
  adminEmail: string,
): Promise<void> {
  updateInstall({
    status: "running",
    log: "",
    error: null,
    dashboardUrl: null,
    credentials: null,
  });
  try {
    updateInstall({}, "Checking SSH access...\n");
    const reachable = await testConnection(target);
    if (!reachable.ok) {
      throw new DyadError(
        `Cannot reach the server over SSH: ${reachable.error}`,
        DyadErrorKind.External,
      );
    }
    updateInstall(
      {},
      "SSH OK.\n\nInstalling Coolify. This takes a few minutes.\n",
    );

    const credentials = generateAdminCredentials(adminEmail);
    const result = await runRemoteStreaming(
      target,
      buildInstallCommand(credentials),
      { onOutput: (chunk) => updateInstall({}, chunk) },
    );
    if (!result.ok) {
      throw new DyadError(
        `The install did not finish: ${result.error ?? "unknown error"}`,
        DyadErrorKind.External,
      );
    }

    updateInstall({}, "\nWaiting for the dashboard to answer...\n");
    const up = await waitForDashboard(target.host);
    if (!up) {
      throw new DyadError(
        "Coolify installed but its dashboard did not start answering. It may " +
          "still be starting; check the server before retrying.",
        DyadErrorKind.External,
      );
    }

    // Stored so the user can sign in again later, not only from this screen.
    writeSettings({
      coolifyAdminUsername: credentials.username,
      coolifyAdminEmail: credentials.email,
      coolifyAdminPassword: { value: credentials.password },
    });

    updateInstall({
      status: "succeeded",
      dashboardUrl: dashboardUrl(target.host),
      credentials,
    });
    logger.info("Coolify install finished");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Coolify install failed: ${message}`);
    updateInstall(
      { status: "failed", error: message },
      `\nFailed: ${message}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCoolifyHandlers() {
  createTypedHandler(coolifyContracts.getStatus, async (_, { appId }) => {
    const app = await getApp(appId);
    const settings = readSettings();
    return {
      hasToken: Boolean(settings.coolifyAccessToken?.value),
      sshAvailable: isSshAvailable(),
      sshKeyExists: deployKeyExists(),
      sshPublicKey: readPublicKey(),
      connection: readConnection(app),
      appUuid: app.coolifyApplicationUuid,
      databaseUuid: app.coolifyDatabaseUuid,
      appUrl: app.coolifyAppUrl,
    };
  });

  // DO NOT LOG this handler: it carries an API token.
  createTypedHandler(
    coolifyContracts.saveToken,
    async (_, { instanceUrl, token }) => {
      const probe = new CoolifyClient({ instanceUrl, token });
      // Validates the token and the URL in one call, surfacing scope problems
      // immediately rather than at deploy time.
      await probe.listServers();
      writeSettings({
        coolifyInstanceUrl: instanceUrl.replace(/\/+$/, ""),
        coolifyAccessToken: { value: token },
      });
    },
  );

  createTypedHandler(coolifyContracts.discover, async () => {
    const client = getClient();
    const instanceUrl = readSettings().coolifyInstanceUrl ?? "";
    const [servers, projects] = await Promise.all([
      client.listServers(),
      client.listProjects(),
    ]);
    return {
      // Replace addresses Coolify only uses from inside its own container, so
      // the connector offers something Dyad can actually reach.
      servers: servers.map((server) => ({
        ...server,
        ip: resolveServerSshHost({ serverIp: server.ip, instanceUrl }),
      })),
      projects,
    };
  });

  createTypedHandler(coolifyContracts.clearToken, async () => {
    writeSettings({
      coolifyInstanceUrl: undefined,
      coolifyAccessToken: undefined,
    });
  });

  createTypedHandler(coolifyContracts.createProject, async (_, { name }) => {
    const client = getClient();
    const created = await client.createProject(name);
    return { uuid: created.uuid, name };
  });

  createTypedHandler(coolifyContracts.generateSshKey, async () => {
    return { publicKey: await ensureDeployKey() };
  });

  createTypedHandler(
    coolifyContracts.install,
    async (_, { adminEmail, sshHost, sshUser, sshPort }) => {
      if (installSnapshot.status === "running") {
        throw new DyadError(
          "An install is already in progress",
          DyadErrorKind.Validation,
        );
      }
      // Not awaited: progress reaches the renderer through install-status
      // events while this returns immediately.
      void runInstall(
        { host: sshHost, user: sshUser, port: sshPort },
        adminEmail,
      );
    },
  );

  createTypedHandler(
    coolifyContracts.getInstallSnapshot,
    async () => installSnapshot,
  );

  createTypedHandler(coolifyContracts.regenerateSshKey, async () => {
    return { publicKey: await regenerateDeployKey() };
  });

  createTypedHandler(
    coolifyContracts.testSsh,
    async (_, { sshHost, sshUser, sshPort }) => {
      const result = await testConnection({
        host: sshHost,
        user: sshUser,
        port: sshPort,
      });
      return { ok: result.ok, error: result.error };
    },
  );

  createTypedHandler(
    coolifyContracts.saveConnection,
    async (_, { appId, connection }) => {
      await db
        .update(apps)
        .set({
          coolifyServerUuid: connection.serverUuid,
          coolifyProjectUuid: connection.projectUuid,
          coolifyEnvironmentName: connection.environmentName,
          coolifySshHost: connection.sshHost,
          coolifySshUser: connection.sshUser,
          coolifySshPort: connection.sshPort,
        })
        .where(eq(apps.id, appId));
    },
  );

  createTypedHandler(coolifyContracts.deploy, async (_, { appId }) => {
    const current = getSnapshot(appId);
    if (current.status === "running") {
      throw new DyadError(
        "A deploy is already in progress for this app",
        DyadErrorKind.Validation,
      );
    }
    // Deliberately not awaited: progress reaches the renderer through
    // deploy-status events while this returns immediately.
    void runDeploy({ appId });
  });

  createTypedHandler(coolifyContracts.getDeploySnapshot, async (_, { appId }) =>
    getSnapshot(appId),
  );

  createTypedHandler(
    coolifyContracts.setPortableCodegen,
    async (_, { appId, enabled }) => {
      await db
        .update(apps)
        .set({ portableCodegen: enabled })
        .where(eq(apps.id, appId));
    },
  );

  createTypedHandler(coolifyContracts.disconnect, async (_, { appId }) => {
    await db
      .update(apps)
      .set({
        coolifyServerUuid: null,
        coolifyProjectUuid: null,
        coolifyEnvironmentName: null,
        coolifySshHost: null,
        coolifySshUser: null,
        coolifySshPort: null,
        coolifyApplicationUuid: null,
        coolifyDatabaseUuid: null,
        coolifyAppUrl: null,
      })
      .where(eq(apps.id, appId));
    snapshots.delete(appId);
  });

  logger.debug("Registered Coolify IPC handlers");
}
