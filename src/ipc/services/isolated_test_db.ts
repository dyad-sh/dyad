import fs from "node:fs";
import log from "electron-log";
import type { IpcMainInvokeEvent } from "electron";

import { getDyadAppPath } from "../../paths/paths";
import { apps } from "../../db/schema";
import {
  createTempTestBranch,
  deleteTempTestBranch,
} from "../utils/neon_test_branch";
import {
  getEnvFilePath,
  readEnvFileIfExists,
  updateNeonEnvVars,
} from "../utils/app_env_var_utils";
import { detectFrameworkType } from "../utils/framework_utils";
import { withLock } from "../utils/lock_utils";
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
export interface PreparedIsolation {
  isolation: TestIsolation;
  infraError?: { message: string };
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
 * - Supabase apps: isolation isn't supported yet — run against current data
 *   with an honest disclosure (`mode: "none"`, with a reason).
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
  // Supabase: disclosure-only path.
  if (app.supabaseProjectId) {
    return {
      isolation: {
        mode: "none",
        reason:
          "Tests run against your current data — isolated test data isn't available for Supabase yet.",
      },
      teardown: NOOP_TEARDOWN,
    };
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
  let branchId: string | undefined;

  // Build a teardown that restores whatever we changed. Captured branchId/env
  // are read at call time so a partial failure still restores correctly.
  const teardown = async () => {
    try {
      await restoreEnvFile(appPath, envSnapshot);
    } catch (error) {
      logger.error(`Failed to restore .env.local for app ${app.id}: ${error}`);
    }
    try {
      await restartAppInPlace({ app, appPath, event });
    } catch (error) {
      logger.error(
        `Failed to restart app ${app.id} back onto its real branch: ${error}`,
      );
    }
    if (branchId) {
      // deleteTempTestBranch reads neonTestBranchId off the row; our in-memory
      // `app` is stale, so pass the branch we actually created.
      await deleteTempTestBranch({ ...app, neonTestBranchId: branchId });
    }
  };

  try {
    emit("Setting up isolated test environment…\n", "setup");

    // 1. Snapshot the real env so teardown can restore it exactly.
    envSnapshot = await readEnvFileIfExists({ appPath });

    // 2. Create the throwaway branch (off the preview branch, CoW).
    const branch = await createTempTestBranch(app);
    branchId = branch.branchId;

    // 3. Point the app at the throwaway branch.
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
    await restartAppInPlace({ app, appPath, event });
    await waitForServerReady(app.id, signal);

    return {
      isolation: { mode: "neon-branch" },
      teardown,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to set up isolated test database for app ${app.id}: ${message}`,
    );
    // Dead-end: restore real data, never run against it.
    await teardown();
    return {
      isolation: {
        mode: "none",
        reason: "Couldn't set up an isolated test database.",
      },
      infraError: {
        message:
          "Couldn't set up an isolated test database, so the run was stopped. Your real data was not touched.",
      },
      teardown: NOOP_TEARDOWN,
    };
  }
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

/** Stop (if running) and (re)start the app's dev server in place. */
async function restartAppInPlace({
  app,
  appPath,
  event,
}: {
  app: AppRow;
  appPath: string;
  event: IpcMainInvokeEvent;
}): Promise<void> {
  await withLock(app.id, async () => {
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
  });
}

/**
 * Wait until the app's proxy URL is populated again and the server answers an
 * HTTP request. The proxy URL is set asynchronously once the dev server prints
 * its address, so we poll rather than assume it's immediately ready.
 */
async function waitForServerReady(
  appId: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Test run stopped.");
    }
    const baseUrl = runningApps.get(appId)?.proxyUrl;
    if (baseUrl && (await isResponding(baseUrl))) {
      return;
    }
    await delay(SERVER_READY_POLL_MS);
  }
  throw new Error(
    "The app didn't come back online with the isolated test database in time.",
  );
}

async function isResponding(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      // Any HTTP response (even a 404/500) means the server is up and serving.
      await fetch(url, { signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
