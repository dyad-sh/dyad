import { mcpManager } from "./mcp_manager";
import { settleWithinTimeout } from "./promise_utils";

const MCP_SHUTDOWN_TIMEOUT_MS = 2_000;

let shutdownCleanupPromise: Promise<void> | undefined;

/** Close MCP transports once when Electron begins its normal shutdown. */
export function disposeMcpClientsForShutdown(): Promise<void> {
  shutdownCleanupPromise ??= mcpManager.disposeAll();
  return shutdownCleanupPromise;
}

type BeforeQuitEvent = {
  preventDefault(): void;
};

type McpBeforeQuitHandlerOptions = {
  quit: () => void;
  cleanup?: () => Promise<void>;
  timeoutMs?: number;
};

/**
 * Pause Electron's first before-quit event until MCP cleanup settles, then
 * re-trigger quit exactly once. The timeout keeps a dead transport from
 * trapping the application in its shutdown path indefinitely.
 */
export function createMcpBeforeQuitHandler({
  quit,
  cleanup = disposeMcpClientsForShutdown,
  timeoutMs = MCP_SHUTDOWN_TIMEOUT_MS,
}: McpBeforeQuitHandlerOptions): (event: BeforeQuitEvent) => void {
  let cleanupFinished = false;
  let cleanupWait: Promise<void> | undefined;

  return (event) => {
    if (cleanupFinished) return;

    event.preventDefault();
    cleanupWait ??= settleWithinTimeout(
      Promise.resolve().then(cleanup),
      timeoutMs,
    );
    void cleanupWait.then(() => {
      if (cleanupFinished) return;
      cleanupFinished = true;
      quit();
    });
  };
}
