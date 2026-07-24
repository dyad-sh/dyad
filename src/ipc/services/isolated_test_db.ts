import fs from "node:fs";
import log from "electron-log";
import type { IpcMainInvokeEvent } from "electron";

import { getDyadAppPath } from "../../paths/paths";
import { apps } from "../../db/schema";
import {
  createTempTestBranch,
  deleteTempTestBranch,
} from "../utils/neon_test_branch";
import { createNeonTestAccount } from "../utils/neon_test_account";
import {
  checkRls,
  createTempTestUser,
  deleteTempTestUser,
  type TempTestUser,
} from "../utils/supabase_test_user";
import { getPublishableKey } from "../../supabase_admin/supabase_context";
import {
  getEnvFilePath,
  readEnvFileIfExists,
  updateNeonEnvVars,
} from "../utils/app_env_var_utils";
import { detectFrameworkType } from "../utils/framework_utils";
import { runningApps, stopAppByInfo } from "../utils/process_manager";
import { cleanUpPort, executeApp } from "./app_runtime_service";
import { getAppPort } from "../../../shared/ports";
import type { TestIsolation } from "../types/tests";

const logger = log.scope("isolated_test_db");

type AppRow = typeof apps.$inferSelect;

/** How long to wait for the dev server to come back after a branch swap. */
const SERVER_READY_TIMEOUT_MS = 120_000;
const SERVER_READY_POLL_MS = 500;

/**
 * The outcome of preparing isolation. When `infraError` is set, the run must
 * NOT proceed (we never run tests against real data) — the caller dead-ends and
 * shows the message. `teardown` always restores the app to its real database,
 * and is safe to call exactly once whether preparation succeeded or failed.
 */
/**
 * Everything the preview recorder needs to establish an authenticated session
 * in-iframe BEFORE recording, and that the generated `signIn` fixture mirrors at
 * replay time. Absent when the app has no supported auth or provisioning failed
 * (the flow then proceeds unauthenticated).
 */
export type IsolationAuthSetup =
  | { mode: "neon-better-auth"; email: string; password: string }
  | {
      mode: "supabase-password";
      email: string;
      password: string;
      projectUrl: string;
      anonKey: string;
    };

export interface PreparedIsolation {
  isolation: TestIsolation;
  infraError?: { message: string };
  /**
   * Extra env vars to inject into the test runner (e.g. the isolated test
   * user's credentials the generated test signs in with). Never contains
   * privileged keys — the service_role key stays in the main process. Set on the
   * Supabase path and, when Neon Auth is provisioned, the Neon path too.
   */
  testCredentials?: Record<string, string>;
  /**
   * Credentials + endpoint the recorder uses to sign the preview in before
   * recording. Undefined when the app has no supported auth or provisioning
   * failed. Never contains privileged keys.
   */
  authSetup?: IsolationAuthSetup;
  teardown: () => Promise<void>;
}

type EmitOutput = (chunk: string, phase: "setup" | "running") => void;

const NOOP_TEARDOWN = async () => {
  // No isolation was set up, so there is nothing to restore.
};

/**
 * Prepare an isolated database for a test run.
 *
 * - Neon apps: cut a throwaway copy-on-write branch, point the app's
 *   `.env.local` at it, and restart the dev server so it picks up the branch.
 *   On any failure we dead-end (no run against real data). `teardown` restores
 *   `.env.local`, restarts back onto the real branch, and deletes the branch.
 * - Supabase apps (free tier, no branching): create a throwaway auth user in
 *   the real project and run the tests authenticated as it, scoped by RLS. No
 *   env swap or server restart — the app keeps its real project + anon key.
 *   `teardown` cleans up the user's rows and deletes the user.
 * - No database: nothing to isolate (`mode: "none"`).
 *
 * Host runtime only. Docker/cloud runtimes fall back to the non-isolated path
 * with a reason, since their dev server lifecycle isn't a local restart.
 */
export async function prepareIsolatedTestDatabase({
  app,
  event,
  emit,
  runtimeMode,
  signal,
}: {
  app: AppRow;
  event: IpcMainInvokeEvent;
  emit: EmitOutput;
  runtimeMode: string;
  signal?: AbortSignal;
}): Promise<PreparedIsolation> {
  // Supabase: isolate via a throwaway, RLS-scoped test user.
  if (app.supabaseProjectId) {
    return prepareSupabaseTestUserIsolation({ app, emit, signal });
  }

  // No Neon project → nothing to isolate.
  if (!app.neonProjectId) {
    return { isolation: { mode: "none" }, teardown: NOOP_TEARDOWN };
  }

  // Isolation requires the local-restart lifecycle.
  if (runtimeMode !== "host") {
    return {
      isolation: {
        mode: "none",
        reason: `Isolated test data isn't available in ${runtimeMode} runtime yet — tests run against your current data.`,
      },
      teardown: NOOP_TEARDOWN,
    };
  }

  const appPath = getDyadAppPath(app.path);
  let envSnapshot: string | null = null;
  let envModified = false;
  let branchId: string | undefined;

  // Build a teardown that restores whatever we changed. Captured branchId/env
  // are read at call time so a partial failure still restores correctly.
  const teardown = async () => {
    let envRestored = true;
    // Only touch the env file / restart the dev server if we actually swapped
    // the env. If setup failed before the env swap (e.g. during branch
    // creation), restoring and restarting would be a pointless, user-visible
    // interruption.
    if (envModified) {
      try {
        await restoreEnvFile(appPath, envSnapshot);
      } catch (error) {
        envRestored = false;
        logger.error(
          `Failed to restore .env.local for app ${app.id}: ${error}`,
        );
        emit(
          "Warning: Dyad couldn't restore your real database settings, so the temporary Neon branch was kept tracked for retry. Restore .env.local before running more tests.\n",
          "setup",
        );
      }
      if (envRestored) {
        try {
          await restartAppInPlace({ app, appPath, event });
        } catch (error) {
          logger.error(
            `Failed to restart app ${app.id} back onto its real branch: ${error}`,
          );
          emit(
            "Warning: Dyad restored your real database settings, but couldn't restart the preview. Restart the app manually before continuing.\n",
            "setup",
          );
        }
      }
    }
    if (branchId) {
      if (!envRestored) {
        return;
      }
      // deleteTempTestBranch reads neonTestBranchId off the row; our in-memory
      // `app` is stale, so pass the branch we actually created.
      try {
        await deleteTempTestBranch({ ...app, neonTestBranchId: branchId });
      } catch (error) {
        logger.error(
          `Failed to delete isolated test branch ${branchId} for app ${app.id}: ${error}`,
        );
      }
    }
  };

  try {
    // A run can sit queued behind the prior run's teardown for a while; honor a
    // Stop pressed during that wait before creating the branch, rewriting
    // .env.local, and restarting the dev server (twice) for nothing.
    if (signal?.aborted) {
      throw new Error("Test run stopped.");
    }
    emit("Setting up isolated test environment…\n", "setup");

    // 1. Snapshot the real env so teardown can restore it exactly.
    envSnapshot = await readEnvFileIfExists({ appPath });

    // 2. Create the throwaway branch (off the preview branch, CoW).
    const branch = await createTempTestBranch(app);
    branchId = branch.branchId;

    // 3. Point the app at the throwaway branch. Mark the env as modified before
    //    the write so a partial failure still triggers a restore in teardown.
    envModified = true;
    await updateNeonEnvVars({
      appPath,
      connectionUri: branch.databaseUrl,
      neonAuthBaseUrl: branch.neonAuthBaseUrl,
      frameworkType: detectFrameworkType(appPath),
      cookieSecret: branch.cookieSecret,
      preserveExistingAuth: !branch.neonAuthBaseUrl,
    });

    // 4. Restart so the dev server reads the throwaway branch, then wait until
    //    it's serving again before Playwright points at it.
    emit("Starting the app against the isolated test database…\n", "setup");
    const processId = await restartAppInPlace({ app, appPath, event });
    await waitForServerReady(app.id, signal, processId);

    // 5. If the app uses Neon Auth, provision a throwaway Better Auth account on
    //    the branch so auth-gated recordings/tests can sign in. Best-effort: on
    //    failure we run unauthenticated rather than dead-ending (non-auth flows
    //    still work). No teardown needed — the account dies with the branch.
    let testCredentials: Record<string, string> | undefined;
    let authSetup: IsolationAuthSetup | undefined;
    if (branch.neonAuthBaseUrl) {
      try {
        const account = await createNeonTestAccount({
          neonAuthBaseUrl: branch.neonAuthBaseUrl,
          appId: app.id,
        });
        testCredentials = {
          DYAD_TEST_USER_EMAIL: account.email,
          DYAD_TEST_USER_PASSWORD: account.password,
        };
        authSetup = {
          mode: "neon-better-auth",
          email: account.email,
          password: account.password,
        };
      } catch (error) {
        logger.warn(
          `Couldn't provision a Neon test account for app ${app.id}; continuing unauthenticated: ${error}`,
        );
        emit(
          "Couldn't create a test account for sign-in — continuing without authentication.\n",
          "setup",
        );
      }
    }

    return {
      isolation: { mode: "neon-branch" },
      testCredentials,
      authSetup,
      teardown,
    };
  } catch (error) {
    // Dead-end: restore real data, never run against it. Guard the teardown so a
    // failure here (e.g. restoreEnvFile) can't replace the original error and
    // hide the real failure reason (e.g. "branch creation failed") from callers.
    try {
      await teardown();
    } catch (teardownError) {
      logger.error(
        `Teardown failed during error recovery for app ${app.id}: ${teardownError}`,
      );
    }
    // A user Stop surfaces here too (waitForServerReady & co. throw on abort).
    // That's a deliberate cancellation, not an infra failure — don't show the
    // misleading "couldn't set up" banner for it.
    if (signal?.aborted) {
      return {
        isolation: { mode: "none", reason: "Test run stopped." },
        infraError: { message: "Test run stopped." },
        teardown: NOOP_TEARDOWN,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to set up isolated test database for app ${app.id}: ${message}`,
    );
    return {
      isolation: {
        mode: "none",
        reason: "Couldn't set up an isolated test database.",
      },
      infraError: {
        message: `Couldn't set up an isolated test database, so the run was stopped. Your real data was not touched. Reason: ${message}`,
      },
      teardown: NOOP_TEARDOWN,
    };
  }
}

/**
 * Supabase (free tier) isolation: create a throwaway auth user in the real
 * project and have the test sign in as it. Isolation comes from Row-Level
 * Security, so we warn (but don't block) when some public tables lack RLS. On
 * setup failure we dead-end with an infra error, never running against real
 * data unguarded.
 */
async function prepareSupabaseTestUserIsolation({
  app,
  emit,
  signal,
}: {
  app: AppRow;
  emit: EmitOutput;
  signal?: AbortSignal;
}): Promise<PreparedIsolation> {
  const projectId = app.supabaseProjectId!;
  const organizationSlug = app.supabaseOrganizationSlug;
  if (!organizationSlug) {
    return {
      isolation: {
        mode: "none",
        reason:
          "Tests run against your current data — connect a Supabase organization to get an isolated test user.",
      },
      teardown: NOOP_TEARDOWN,
    };
  }

  // RLS gate (warn, don't refuse): surface unprotected tables to the user.
  const rls = await checkRls({ projectId, organizationSlug });
  const warning = buildRlsWarning(rls);

  let testUser: TempTestUser | undefined;
  const teardown = async () => {
    if (testUser) {
      try {
        await deleteTempTestUser({
          ...app,
          supabaseTestUserId: testUser.userId,
        });
      } catch (error) {
        logger.error(
          `Failed to delete isolated Supabase test user ${testUser.userId} for app ${app.id}: ${error}`,
        );
      }
    }
  };

  try {
    // checkRls and createTempTestUser each make network requests that can take
    // several seconds; honor a Stop pressed in between them so cancellation
    // takes effect promptly instead of only after they complete.
    if (signal?.aborted) {
      throw new Error("Test run stopped.");
    }
    emit("Creating an isolated test user…\n", "setup");
    testUser = await createTempTestUser(app);

    // Fetch the project's anon (publishable) key so the recorder and the
    // generated `signIn` fixture can sign in via the password grant. Best-effort:
    // without it, auth is unavailable and the flow proceeds unauthenticated.
    let anonKey: string | undefined;
    try {
      anonKey = await getPublishableKey({ projectId, organizationSlug });
    } catch (error) {
      logger.warn(
        `Couldn't fetch the Supabase anon key for app ${app.id}; continuing unauthenticated: ${error}`,
      );
      emit(
        "Couldn't fetch the Supabase key for sign-in — continuing without authentication.\n",
        "setup",
      );
    }

    const testCredentials: Record<string, string> = {
      DYAD_TEST_USER_EMAIL: testUser.email,
      DYAD_TEST_USER_PASSWORD: testUser.password,
      DYAD_TEST_SUPABASE_URL: testUser.projectUrl,
    };
    let authSetup: IsolationAuthSetup | undefined;
    if (anonKey) {
      testCredentials.DYAD_TEST_SUPABASE_ANON_KEY = anonKey;
      authSetup = {
        mode: "supabase-password",
        email: testUser.email,
        password: testUser.password,
        projectUrl: testUser.projectUrl,
        anonKey,
      };
    }

    return {
      isolation: { mode: "supabase-test-user", reason: warning },
      testCredentials,
      authSetup,
      teardown,
    };
  } catch (error) {
    await teardown();
    // The pre-flight abort check above throws into this catch; a user Stop is
    // a deliberate cancellation, not a setup failure.
    if (signal?.aborted) {
      return {
        isolation: { mode: "none", reason: "Test run stopped." },
        infraError: { message: "Test run stopped." },
        teardown: NOOP_TEARDOWN,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to set up isolated test user for app ${app.id}: ${message}`,
    );
    return {
      isolation: {
        mode: "none",
        reason: "Couldn't set up an isolated Supabase test user.",
      },
      infraError: {
        message: `Couldn't set up an isolated test user, so the run was stopped. Your real data was not touched. Reason: ${message}`,
      },
      teardown: NOOP_TEARDOWN,
    };
  }
}

/** Build the user-facing RLS warning, or undefined when fully protected. */
function buildRlsWarning(rls: {
  tablesWithoutRls: string[];
  unverified?: boolean;
}): string | undefined {
  if (rls.unverified) {
    return "Tests ran as an isolated test user, but Dyad couldn't verify Row-Level Security — some real data may be reachable.";
  }
  if (rls.tablesWithoutRls.length === 0) {
    return undefined;
  }
  const shown = rls.tablesWithoutRls.slice(0, 5).join(", ");
  const more =
    rls.tablesWithoutRls.length > 5
      ? `, and ${rls.tablesWithoutRls.length - 5} more`
      : "";
  return `Tests ran as an isolated test user, but these tables don't have Row-Level Security, so the test could affect real data in them: ${shown}${more}. Enable RLS for full isolation.`;
}

/** Restore `.env.local` to a previous snapshot (or remove it if there was none). */
async function restoreEnvFile(
  appPath: string,
  snapshot: string | null,
): Promise<void> {
  const envPath = getEnvFilePath({ appPath });
  if (snapshot === null) {
    await fs.promises.rm(envPath, { force: true });
    return;
  }
  await fs.promises.writeFile(envPath, snapshot);
}

/**
 * Stop (if running) and (re)start the app's dev server in place.
 *
 * The caller must already hold the per-app lock (`withLock(app.id, …)`): both
 * call sites here — setup and teardown — run inside the lock the `tests:run`
 * handler holds across the whole isolation lifecycle. We must NOT re-acquire it
 * here: `withLock` is promise-chained, not re-entrant, so a nested acquisition
 * would queue behind the outer run and wait for it to finish while the outer
 * run is awaiting this restart — a deadlock that Stop can't break.
 */
async function restartAppInPlace({
  app,
  appPath,
  event,
}: {
  app: AppRow;
  appPath: string;
  event: IpcMainInvokeEvent;
}): Promise<number | undefined> {
  const appInfo = runningApps.get(app.id);
  if (appInfo) {
    await stopAppByInfo(app.id, appInfo);
  }
  await cleanUpPort(getAppPort(app.id));
  await executeApp({
    appPath,
    appId: app.id,
    event,
    isNeon: !!app.neonProjectId,
    installCommand: app.installCommand,
    startCommand: app.startCommand,
  });
  return runningApps.get(app.id)?.processId;
}

/**
 * Wait until the app's proxy URL is populated again and the dev server answers
 * an HTTP request. The URLs are set asynchronously once the dev server prints
 * its address, so we poll rather than assume they're immediately ready.
 *
 * Probe the original dev-server URL when available. The preview proxy buffers
 * and rewrites HTML responses; that extra processing is irrelevant to server
 * readiness and can make Node's fetch reject even after the upstream app has
 * returned a successful response. We still require `proxyUrl` before returning
 * because Playwright uses the proxy URL as its base URL.
 */
async function waitForServerReady(
  appId: number,
  signal?: AbortSignal,
  expectedProcessId?: number,
): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  // Track why each poll fell short so a timeout can report the last-observed
  // state instead of a bare "didn't come back online" with no cause.
  let lastReason = "the dev server never started";
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Test run stopped.");
    }
    const appInfo = runningApps.get(appId);
    if (!appInfo) {
      // The process exited (or was never registered) — nothing is running.
      lastReason = "the dev server process is no longer running";
      await delay(SERVER_READY_POLL_MS, signal);
      continue;
    }
    if (
      expectedProcessId !== undefined &&
      appInfo.processId !== expectedProcessId
    ) {
      // A different process is registered than the one we just started —
      // usually the dev server crashed and is mid-restart.
      lastReason = "the dev server restarted unexpectedly while starting up";
      await delay(SERVER_READY_POLL_MS, signal);
      continue;
    }
    const baseUrl = appInfo.proxyUrl;
    if (!baseUrl) {
      // Process is up but hasn't printed its address yet.
      lastReason =
        "the dev server started but never reported a URL to connect to";
      await delay(SERVER_READY_POLL_MS, signal);
      continue;
    }
    const healthCheckUrl = appInfo.originalUrl ?? baseUrl;
    if (await isResponding(healthCheckUrl, signal)) {
      return;
    }
    lastReason = `the dev server at ${healthCheckUrl} isn't responding to requests`;
    await delay(SERVER_READY_POLL_MS, signal);
  }
  const timeoutSeconds = Math.round(SERVER_READY_TIMEOUT_MS / 1000);
  throw new Error(
    `The app didn't come back online with the isolated test database within ${timeoutSeconds}s (${lastReason}). Check the app's terminal output for startup errors.`,
  );
}

async function isResponding(
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  // Forward an outer Stop to the in-flight fetch so pressing Stop cancels the
  // health check immediately instead of waiting up to the 3s fetch timeout.
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    // Any HTTP response (even a 404/500) means the server is up and serving.
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Sleep for `ms`, resolving early if `signal` aborts. Being abort-aware here
 * lets a Stop pressed mid-poll take effect immediately instead of waiting out
 * the full poll interval.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
