/**
 * Test-only fetch override for every model-client factory in the main process.
 *
 * The hybrid vitest harness runs main-process code under happy-dom, whose
 * global fetch strips CORS-forbidden headers (Authorization) and mishandles
 * abort on stalled streams; the harness injects undici's fetch here so LLM
 * HTTP traffic behaves like real Node.
 *
 * Lives in its own dependency-free module (not get_model_client.ts) so
 * secondary factories — provider key validation, the help bot, Dyad Engine
 * transcription — can thread it without import cycles.
 *
 * The setter THROWS outside test environments: `process.env.VITEST` (set by
 * vitest itself) or an E2E test build. A `NODE_ENV === "production"` guard
 * would be dead code — packaged Electron builds never set NODE_ENV.
 */
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { IS_TEST_BUILD } from "./test_utils";

let testFetchOverride: FetchFunction | undefined;

export function setModelClientFetchForTesting(
  fetchImpl: FetchFunction | undefined,
): void {
  if (!process.env.VITEST && !IS_TEST_BUILD) {
    throw new Error(
      "setModelClientFetchForTesting is test-only (requires vitest or an E2E test build)",
    );
  }
  testFetchOverride = fetchImpl;
}

/**
 * Spread into any AI-SDK provider factory call:
 * `createOpenAI({ ..., ...getTestFetchOption() })`. Empty in production.
 */
export function getTestFetchOption(): { fetch?: FetchFunction } {
  return testFetchOverride ? { fetch: testFetchOverride } : {};
}
