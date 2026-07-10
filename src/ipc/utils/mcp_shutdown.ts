import { mcpManager } from "./mcp_manager";

let shutdownCleanupPromise: Promise<void> | undefined;

/** Close MCP transports once when Electron begins its normal shutdown. */
export function disposeMcpClientsForShutdown(): Promise<void> {
  shutdownCleanupPromise ??= mcpManager.disposeAll();
  return shutdownCleanupPromise;
}
