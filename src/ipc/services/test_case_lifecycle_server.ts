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
) {
  const token = randomBytes(32).toString("hex");
  let closing = false;
  let failure: Error | undefined;
  let activeCase: string | undefined;
  let pending = Promise.resolve();
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
    pending = pending.then(async () => {
      try {
        if (failure) throw failure;
        const [, phase, caseId] = match;
        let credentials: Record<string, string> = {};
        if (phase === "before") {
          if (activeCase) await lifecycle.afterEach();
          activeCase = caseId;
          credentials = await lifecycle.beforeEach();
        } else if (activeCase === caseId) {
          await lifecycle.afterEach();
          activeCase = undefined;
        }
        response.setHeader("Content-Type", "application/json");
        response.writeHead(200).end(JSON.stringify(credentials));
      } catch (error) {
        // Fail closed after any provisioning/cleanup failure. Later cases must
        // not run against dirty data, even if Playwright continues the suite.
        failure ??= error instanceof Error ? error : new Error(String(error));
        response
          .writeHead(500)
          .end("Couldn't prepare or clean up isolated test data.");
      }
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
    async close() {
      closing = true;
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeAllConnections();
      await pending;
      try {
        if (activeCase) await lifecycle.afterEach();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
      await closed;
    },
  };
}
