import { db } from "@/db";
import { readSettings, writeSettings } from "@/main/settings";
import { gitService, GitService } from "../services/git_service";
import { safeSend } from "../utils/safe_sender";

/**
 * Dependencies that IPC handlers need but should not import directly.
 *
 * Handlers that read their dependencies through `getHandlerContext()` can be
 * unit-tested with `setupHandlerTestHarness()` (see
 * `src/testing/handler_test_harness.ts`) instead of `vi.mock`-ing each module
 * (db, settings, git, ...) individually.
 *
 * Migration is incremental: new handlers and handlers being refactored should
 * use the context; existing handlers keep their direct imports until touched.
 */
export interface HandlerContext {
  db: typeof db;
  readSettings: typeof readSettings;
  writeSettings: typeof writeSettings;
  gitService: GitService;
  safeSend: typeof safeSend;
}

const productionContext: HandlerContext = {
  db,
  readSettings,
  writeSettings,
  gitService,
  safeSend,
};

let activeContext: HandlerContext = productionContext;

export function getHandlerContext(): HandlerContext {
  return activeContext;
}

/**
 * Swaps the context handlers see. Pass null to restore the production
 * context. Test-only seam.
 */
export function setHandlerContextForTesting(
  context: HandlerContext | null,
): void {
  activeContext = context ?? productionContext;
}
