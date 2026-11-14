import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { readServerSecretMap } from "@/ipc/utils/secret_storage";
import { sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";

type McpServerRow = typeof mcpServers.$inferSelect;

export type PassthroughMcpServer =
  | {
      type: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  | { type: "http"; url: string; headers?: Record<string, string> };

export interface PassthroughMcpServers {
  /** CLI `mcpServers` entries, keyed by a `dyad-` prefixed name. */
  servers: Record<string, PassthroughMcpServer>;
  /** Dyad server ids that must stay proxied through Dyad's own MCP server
   * (OAuth servers: Dyad owns their token refresh). */
  proxiedServerIds: Set<number>;
  /** User-facing notes about servers that could not be passed through. */
  warnings: string[];
}

/** Translate one enabled Dyad MCP server into a CLI server entry. Returns
 * `"proxy"` when Dyad must keep serving it, or a warning string. */
export function toPassthroughServer(
  server: Pick<
    McpServerRow,
    | "name"
    | "transport"
    | "command"
    | "args"
    | "url"
    | "envEncrypted"
    | "envJson"
    | "headersEncrypted"
    | "headersJson"
    | "oauthEnabled"
  >,
  read = readServerSecretMap,
): PassthroughMcpServer | "proxy" | { warning: string } {
  if (server.oauthEnabled) return "proxy";
  if (server.transport === "stdio") {
    if (!server.command)
      return { warning: `MCP server "${server.name}" has no command.` };
    const env = read(server.envEncrypted, server.envJson);
    if (env.status === "unreadable")
      return {
        warning: `Could not read the environment variables for MCP server "${server.name}", so it was not passed to Claude Code.`,
      };
    return {
      type: "stdio",
      command: server.command,
      args: server.args ?? [],
      ...(env.value ? { env: env.value } : {}),
    };
  }
  if (server.transport === "http") {
    if (!server.url)
      return { warning: `MCP server "${server.name}" has no URL.` };
    const headers = read(server.headersEncrypted, server.headersJson);
    if (headers.status === "unreadable")
      return {
        warning: `Could not read the headers for MCP server "${server.name}", so it was not passed to Claude Code.`,
      };
    return {
      type: "http",
      url: server.url,
      ...(headers.value ? { headers: headers.value } : {}),
    };
  }
  return {
    warning: `MCP server "${server.name}" uses an unsupported transport.`,
  };
}

/**
 * Dyad-configured MCP servers for a native turn. Servers Claude Code can run
 * itself are passed straight to the CLI; OAuth servers stay on Dyad's bridge.
 * The result contains secrets: write it only to a 0600 per-turn file.
 */
export async function loadPassthroughMcpServers(): Promise<PassthroughMcpServers> {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true as any));
  const servers: Record<string, PassthroughMcpServer> = {};
  const proxiedServerIds = new Set<number>();
  const warnings: string[] = [];
  for (const row of rows) {
    const entry = toPassthroughServer(row);
    if (entry === "proxy") {
      proxiedServerIds.add(row.id);
      continue;
    }
    if ("warning" in entry) {
      warnings.push(entry.warning);
      continue;
    }
    let name = `dyad-${sanitizeMcpName(row.name || String(row.id))}`;
    if (name === "dyad-" || servers[name]) name = `${name}-${row.id}`;
    servers[name] = entry;
  }
  return { servers, proxiedServerIds, warnings };
}
