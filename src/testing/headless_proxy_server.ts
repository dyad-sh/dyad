/**
 * TEST-ONLY replacement for `@/ipc/utils/start_proxy_server`.
 *
 * Production resolves the proxy worker relative to the bundle location:
 *
 *   path.resolve(__dirname, "..", "..", "worker", "proxy_server.js")
 *
 * Packaged, `__dirname` is `.vite/build`, so that lands on
 * `<app>/worker/proxy_server.js`. Under vitest the module is loaded from
 * source, `__dirname` is `src/ipc/utils`, and the same expression resolves to
 * `src/worker/proxy_server.js` — a file that does not exist. `startProxy`
 * only logs the resulting Worker `error` event, so `onStarted` never fires,
 * `runningApps.get(appId).proxyUrl` stays undefined, and every
 * `waitForAppReady` burns its full timeout (120s for restart, 600s for
 * rebuild) before failing.
 *
 * This module returns a drop-in module shape with the identical contract but
 * an absolute path to the real `worker/proxy_server.js`, so everything
 * downstream (proxyUrl, `[dyad-proxy-server]started=[…]`, the app-run actor's
 * PROXY_READY transition, `waitForAppReady`) behaves exactly as in production.
 *
 * Install it from a test file's hoisted section:
 *
 *   vi.mock("@/ipc/utils/start_proxy_server", async () => {
 *     const { createHeadlessProxyModule } = await import(
 *       "@/testing/headless_proxy_server"
 *     );
 *     return createHeadlessProxyModule();
 *   });
 *
 * Kept in its own file (no import of the mocked module) so the `vi.mock`
 * factory above cannot deadlock on a cyclic import.
 */
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  PROXY_FALLBACK_MAX_ATTEMPTS,
  getProxyFallbackPortStart,
} from "../../shared/ports";

/**
 * Marker property set on the replacement `startProxy`, so the harness can
 * detect a missing `vi.mock` immediately instead of stalling for two minutes
 * inside `waitForAppReady`.
 */
export const HEADLESS_PROXY_MARKER = "__dyadHeadlessProxy" as const;

export function resolveProxyWorkerPath(): string {
  const candidates = [
    // The eval/benchmark runners always execute from the repo root.
    path.join(process.cwd(), "worker", "proxy_server.js"),
    // …but don't depend on it: src/testing -> ../../worker is the repo copy.
    path.resolve(__dirname, "..", "..", "worker", "proxy_server.js"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "headless proxy: could not locate worker/proxy_server.js. Tried:\n  " +
        candidates.join("\n  "),
    );
  }
  return found;
}

export interface HeadlessStartProxyOptions {
  port: number;
  onStarted?: (proxyUrl: string) => void;
  onError?: (error: DyadError) => void;
  fixedHeaders?: Record<string, string>;
}

export function createHeadlessProxyModule(): {
  startProxy: (
    targetOrigin: string,
    opts: HeadlessStartProxyOptions,
  ) => Promise<Worker>;
} {
  const workerPath = resolveProxyWorkerPath();

  const startProxy = async (
    targetOrigin: string,
    opts: HeadlessStartProxyOptions,
  ): Promise<Worker> => {
    if (!/^https?:\/\//.test(targetOrigin)) {
      throw new DyadError(
        "startProxy: targetOrigin must be absolute http/https URL",
        DyadErrorKind.Validation,
      );
    }
    const { port, onStarted, onError, fixedHeaders } = opts;
    const fallbackPortStart = getProxyFallbackPortStart();

    const worker = new Worker(workerPath, {
      workerData: {
        targetOrigin,
        port,
        fallbackPortStart,
        maxPortAttempts: PROXY_FALLBACK_MAX_ATTEMPTS,
        fixedHeaders,
      },
    });

    worker.on("message", (m) => {
      if (typeof m === "string" && m.startsWith("proxy-server-start url=")) {
        onStarted?.(m.substring("proxy-server-start url=".length));
      } else if (typeof m === "string" && m.startsWith("proxy-server-error")) {
        onError?.(
          new DyadError(
            `Could not start the preview proxy: every port from ${port} to ${
              fallbackPortStart + PROXY_FALLBACK_MAX_ATTEMPTS - 1
            } is in use. Free up a port and restart the app.`,
            DyadErrorKind.Conflict,
          ),
        );
      }
    });
    worker.on("error", (error) => {
      onError?.(
        new DyadError(
          `Preview proxy worker failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          DyadErrorKind.External,
        ),
      );
    });

    return worker;
  };

  Object.defineProperty(startProxy, HEADLESS_PROXY_MARKER, { value: true });

  return { startProxy };
}
