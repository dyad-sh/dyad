import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { TestCaseLifecycle } from "./isolated_test_db";

export const TEST_CASE_ENDPOINT_ENV = "DYAD_TEST_CASE_ENDPOINT";
export const TEST_CASE_TOKEN_ENV = "DYAD_TEST_CASE_TOKEN";

/**
 * Run-scoped bridge from Playwright's auto fixture to main-owned provider hooks.
 * Privileged database/admin credentials never enter the Playwright process.
 * The caller holds the app's provider/runtime claims until close() has drained.
 */
export async function startTestCaseLifecycleServer(
  lifecycle: TestCaseLifecycle,
  { onSlowShutdown }: { onSlowShutdown?: () => void } = {},
) {
  const token = randomBytes(32).toString("hex");
  let closing = false;
  let failure: Error | undefined;
  let activeCase: string | undefined;
  let pending = Promise.resolve();
  let activeController: AbortController | undefined;
  let closePromise: Promise<void> | undefined;
  const closingError = new Error("Test case lifecycle is closing.");
  const rememberFailure = (error: unknown) => {
    // Shutdown cancellation is expected; final cleanup can still genuinely fail.
    if (error === closingError) return;
    failure ??= error instanceof Error ? error : new Error(String(error));
  };
  const runHook = async <T>(hook: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController();
    activeController = controller;
    const timer = setTimeout(
      () =>
        controller.abort(new Error("Isolated test data operation timed out.")),
      110_000,
    );
    try {
      const result = await hook(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      clearTimeout(timer);
      activeController = undefined;
    }
  };
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (
      closing ||
      request.method !== "POST" ||
      request.headers.authorization !== `Bearer ${token}` ||
      request.headers.origin
    ) {
      response.writeHead(403).end();
      return;
    }
    const match = /^\/(before|after)\/([a-zA-Z0-9-]{1,100})$/.exec(
      request.url ?? "",
    );
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    // The runner uses one worker. Serialize even late requests from a worker
    // that timed out, and fence stale teardown by the individual attempt ID.
    pending = pending
      .then(async () => {
        try {
          if (closing) return;
          if (failure) throw failure;
          const [, phase, caseId] = match;
          let credentials: Record<string, string> = {};
          if (phase === "before") {
            if (activeCase) await runHook(lifecycle.afterEach);
            if (closing) return;
            activeCase = caseId;
            credentials = await runHook(lifecycle.beforeEach);
          } else if (activeCase === caseId) {
            await runHook(lifecycle.afterEach);
            activeCase = undefined;
          }
          response.setHeader("Content-Type", "application/json");
          response.writeHead(200).end(JSON.stringify(credentials));
        } catch (error) {
          // Fail closed after any provisioning/cleanup failure. Later cases must
          // not run against dirty data, even if Playwright continues the suite.
          rememberFailure(error);
          if (!response.destroyed && !response.headersSent) {
            response
              .writeHead(500)
              .end("Couldn't prepare or clean up isolated test data.");
          } else {
            response.destroy();
          }
        }
      })
      .catch((error) => {
        rememberFailure(error);
        response.destroy();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Couldn't start the test case lifecycle server.");
  }
  return {
    env: {
      [TEST_CASE_ENDPOINT_ENV]: `http://127.0.0.1:${address.port}`,
      [TEST_CASE_TOKEN_ENV]: token,
    },
    get failure() {
      return failure;
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      activeController?.abort(closingError);
      closePromise = (async () => {
        const closed = new Promise<void>((resolve) =>
          server.close(() => resolve()),
        );
        server.closeAllConnections();
        // Retain provider ownership if a dependency ignores cancellation. Make
        // that wait visible instead of releasing the lock over live mutations.
        const warningTimer = setTimeout(() => onSlowShutdown?.(), 10_000);
        try {
          await pending;
          if (activeCase) await runHook(lifecycle.afterEach);
        } catch (error) {
          rememberFailure(error);
        } finally {
          clearTimeout(warningTimer);
          await closed;
        }
      })();
      return closePromise;
    },
  };
}
