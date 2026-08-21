import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { getSettingsFilePath } from "./settings";

const logger = log.scope("remote_debugging");

/**
 * Chromium writes the chosen port here once the DevTools server is listening.
 * With `--remote-debugging-port=0` the OS picks a free port, so this file is
 * the only way to learn it.
 */
const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";

const PORT_POLL_INTERVAL_MS = 250;
const PORT_POLL_TIMEOUT_MS = 5_000;

export interface RemoteDebuggingEndpoint {
  port: number;
  httpEndpoint: string;
}

let switchApplied = false;
let preexistingPortFileContents = new Map<string, string>();
let cachedEndpoint: RemoteDebuggingEndpoint | null = null;
/**
 * When the poll below last gave up. Chromium writes its port file during
 * startup, so an endpoint that hasn't appeared within the timeout probably
 * isn't coming, and without this every Tests panel mount and every agent test
 * run pays the full timeout again. It expires rather than latching: a failure
 * here disables the Tests panel's run buttons, which is far too much to hang
 * on one unlucky poll.
 */
let failedAt: number | null = null;
const FAILURE_RETRY_AFTER_MS = 30_000;

/**
 * Reads the experiment flag straight off disk.
 *
 * This runs before `app.whenReady()`, where `readSettings()` is unsafe: its
 * merge path decrypts stored secrets through safeStorage, which throws before
 * the app is ready and makes the whole read fall back to DEFAULT_SETTINGS —
 * silently disabling the experiment. A raw parse has no such dependency.
 */
function readFlagFromDisk(): boolean {
  try {
    const raw = fs.readFileSync(getSettingsFilePath(), "utf-8");
    return JSON.parse(raw)?.enableTestRunInPreview === true;
  } catch {
    // Missing on first launch, or unreadable/corrupt: treat as disabled.
    return false;
  }
}

/**
 * Opts the process into a loopback CDP endpoint when the experiment is on, so
 * Playwright can drive the preview view. Must be called before the app is
 * ready — Chromium reads command-line switches during startup.
 *
 * Port 0 lets the OS assign a free port; Chromium binds it to 127.0.0.1 only.
 */
export function maybeEnableRemoteDebugging(): void {
  if (!readFlagFromDisk()) {
    return;
  }

  preexistingPortFileContents = new Map(
    candidatePortFilePaths().flatMap((filePath) => {
      try {
        return [[filePath, fs.readFileSync(filePath, "utf-8")] as const];
      } catch {
        return [];
      }
    }),
  );
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  switchApplied = true;
  logger.info(
    "Test-run-in-preview experiment is on: enabled remote debugging on 127.0.0.1.",
  );
}

export function isRemoteDebuggingSwitchApplied(): boolean {
  return switchApplied;
}

function candidatePortFilePaths(): string[] {
  const paths: string[] = [];
  // Electron >= 21 points Chromium's user-data dir at sessionData, but dev
  // builds re-point userData (see main.ts), so check both.
  for (const name of ["sessionData", "userData"] as const) {
    try {
      paths.push(path.join(app.getPath(name), DEVTOOLS_ACTIVE_PORT_FILE));
    } catch {
      // getPath throws for names this platform/build doesn't provide.
    }
  }
  return [...new Set(paths)];
}

function readPortFile(filePath: string): number | null {
  try {
    // Chromium can leave this file behind after an unclean shutdown. Only
    // accept content that changed during the current launch; otherwise a
    // recycled port could point Playwright at an unrelated local debugging
    // service. Comparing contents avoids mixing Date.now() with filesystem
    // timestamp precision, which can reject a genuinely fresh file.
    const contents = fs.readFileSync(filePath, "utf-8");
    if (preexistingPortFileContents.get(filePath) === contents) {
      return null;
    }
    const firstLine = contents.split("\n")[0]?.trim();
    const port = Number(firstLine);
    // A truncated or stale file can hold something that parses as a number but
    // isn't a bindable port. An out-of-range value would make `httpEndpoint`
    // unusable while still reporting CDP as ready.
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the CDP endpoint, waiting briefly for Chromium to publish its port.
 * Returns null when the experiment is off (so callers can tell the user to
 * enable it and restart) or the port never appears.
 */
export async function resolveRemoteDebuggingEndpoint(): Promise<RemoteDebuggingEndpoint | null> {
  if (!switchApplied) {
    return null;
  }
  // Checked before the backoff: an overlapping poll may have cached a late port
  // after this one gave up, and a resolved endpoint always beats the backoff.
  if (cachedEndpoint) {
    return cachedEndpoint;
  }
  if (failedAt !== null && Date.now() - failedAt < FAILURE_RETRY_AFTER_MS) {
    return null;
  }

  const deadline = Date.now() + PORT_POLL_TIMEOUT_MS;
  for (;;) {
    for (const filePath of candidatePortFilePaths()) {
      const port = readPortFile(filePath);
      if (port !== null) {
        logger.info(`Resolved remote debugging port ${port} from ${filePath}`);
        cachedEndpoint = { port, httpEndpoint: `http://127.0.0.1:${port}` };
        return cachedEndpoint;
      }
    }

    if (Date.now() >= deadline) {
      logger.warn(
        `Remote debugging was enabled but no ${DEVTOOLS_ACTIVE_PORT_FILE} appeared within ${PORT_POLL_TIMEOUT_MS}ms.`,
      );
      failedAt = Date.now();
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, PORT_POLL_INTERVAL_MS));
  }
}

/** Test-only: clears module state between cases. */
export function resetRemoteDebuggingForTesting(): void {
  switchApplied = false;
  preexistingPortFileContents = new Map();
  cachedEndpoint = null;
  failedAt = null;
}
