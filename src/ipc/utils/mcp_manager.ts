import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  captureMcpOAuthWriteAuthority,
  DyadOAuthClientProvider,
} from "./mcp_oauth_provider";
import {
  decryptFromString,
  readServerSecretMap,
  type ServerSecretRead,
} from "./secret_storage";
import { settleWithinTimeout } from "./promise_utils";
import { syncVendoredOAuthClient } from "./vendored_oauth_client";
import { readMcpConnection } from "./mcp_connection_store";
import {
  mcpConnectionKey,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

// Connecting without a secret we know exists would talk to the server
// unauthenticated, so refuse and point at the likely cause.
function requireReadableSecret(
  read: ServerSecretRead,
  serverName: string,
  label: string,
): Record<string, string> | null {
  if (read.status === "unreadable") {
    throw new DyadError(
      `Could not decrypt the ${label} for "${serverName}". This usually means the OS keyring is unavailable. Fix the keyring and try again, or re-enter the values.`,
      DyadErrorKind.Precondition,
    );
  }
  return read.value;
}

type ClientInitialization = {
  cancelled: boolean;
  promise: Promise<MCPClient>;
};

export type McpToolSet = Awaited<ReturnType<MCPClient["tools"]>>;

const MCP_CLIENT_DISPOSAL_TIMEOUT_MS = 1_500;

/** Default cap on connecting to one MCP server and listing its tools. */
export const MCP_LIST_TOOLS_TIMEOUT_MS = 10_000;

export class McpListToolsTimeoutError extends DyadError {
  constructor(connection: McpConnectionRef, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs / 1000}s waiting for tools from server ${mcpConnectionKey(connection)}.`,
      DyadErrorKind.Precondition,
    );
    this.name = "McpListToolsTimeoutError";
  }
}

export class McpManager {
  private static _instance: McpManager;
  static get instance(): McpManager {
    if (!this._instance) this._instance = new McpManager();
    return this._instance;
  }

  // Keyed by mcpConnectionKey.
  private clients = new Map<string, MCPClient>();
  private initializations = new Map<string, ClientInitialization>();
  private disposals = new Map<string, Promise<void>>();
  private disposeAllPromise: Promise<void> | undefined;

  async getClient(connection: McpConnectionRef): Promise<MCPClient> {
    const key = mcpConnectionKey(connection);
    while (true) {
      const disposal = this.disposeAllPromise ?? this.disposals.get(key);
      if (!disposal) break;
      await disposal;
    }

    const existing = this.clients.get(key);
    if (existing) return existing;

    const existingInitialization = this.initializations.get(key);
    if (existingInitialization) return existingInitialization.promise;

    const initialization = {} as ClientInitialization;
    initialization.cancelled = false;
    initialization.promise = this.createClient(connection)
      .then(async (client) => {
        if (initialization.cancelled) {
          await Promise.allSettled([this.closeClient(client)]);
          throw new DyadError(
            `MCP client initialization cancelled for server ${key}`,
            DyadErrorKind.Precondition,
          );
        }

        // This should not normally be reachable because initialization promises
        // are coalesced above. Keep the guard so a future cache mutation cannot
        // leak a second transport or replace a client that is already in use.
        const raceWinner = this.clients.get(key);
        if (raceWinner) {
          await Promise.allSettled([this.closeClient(client)]);
          return raceWinner;
        }

        this.clients.set(key, client);
        return client;
      })
      .finally(() => {
        if (this.initializations.get(key) === initialization) {
          this.initializations.delete(key);
        }
      });

    this.initializations.set(key, initialization);
    return initialization.promise;
  }

  /**
   * Connect (or reuse the cached client) and list the server's tools, giving
   * up after `timeoutMs` or when `signal` aborts. A server that accepts the
   * connection but never answers (e.g. a wedged local desktop-app server)
   * would otherwise block its caller forever.
   *
   * Giving up only stops waiting; it deliberately does not dispose the client.
   * Disposing would kill a slow-starting stdio server (e.g. `npx` on a cold
   * cache) mid-launch on every turn, and could close a client another chat is
   * using for an in-flight tool call. A still-pending initialization stays
   * coalesced, so a later call picks up the client once it finishes; each
   * call still waits at most `timeoutMs`. Callers that own the server's
   * lifecycle (settings edits) dispose explicitly.
   */
  async listToolsWithin(
    connection: McpConnectionRef,
    {
      timeoutMs = MCP_LIST_TOOLS_TIMEOUT_MS,
      signal,
    }: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<McpToolSet> {
    signal?.throwIfAborted();
    const load = this.getClient(connection).then((client) => client.tools());
    // Keep a late rejection after timeout/abort from going unhandled.
    load.catch(() => undefined);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<McpToolSet>((resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new McpListToolsTimeoutError(connection, timeoutMs)),
          timeoutMs,
        );
        if (signal) {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
        }
        load.then(resolve, reject);
      });
    } finally {
      clearTimeout(timeoutId);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }

  private async createClient(connection: McpConnectionRef): Promise<MCPClient> {
    // Runs before the row is read so a refreshed client is picked up here,
    // including on the silent token refresh path. Cached-only: building a
    // client must not wait on a catalog fetch.
    await syncVendoredOAuthClient(connection, { cachedOnly: true });
    const s = await readMcpConnection(connection);
    if (!s) {
      throw new Error(`MCP server not found: ${mcpConnectionKey(connection)}`);
    }

    let client: MCPClient;
    if (s.transport === "stdio") {
      const args = s.args ?? [];
      const env =
        requireReadableSecret(
          readServerSecretMap(s.envEncrypted, s.envJson),
          s.displayName,
          "environment variables",
        ) ?? undefined;
      if (!s.command) throw new Error("MCP server command is required");
      const stdio = new StdioClientTransport({
        command: s.command,
        args,
        env,
      });
      client = await createMCPClient({ transport: stdio });
    } else if (s.transport === "http") {
      if (!s.url) throw new Error(`http MCP requires url`);
      const authProvider = s.oauthEnabled
        ? new DyadOAuthClientProvider({
            connection: s.connection,
            callbackPort: s.oauthCallbackPort ?? undefined,
            scope: s.oauthScope ?? undefined,
            preregisteredClientId: s.oauthClientId ?? undefined,
            preregisteredClientSecret: s.oauthClientSecret
              ? decryptFromString(s.oauthClientSecret) || undefined
              : undefined,
            writeAuthority: captureMcpOAuthWriteAuthority(s.connection),
          })
        : undefined;
      client = await createMCPClient({
        transport: {
          type: s.transport,
          url: s.url,
          headers:
            requireReadableSecret(
              readServerSecretMap(s.headersEncrypted, s.headersJson),
              s.displayName,
              "headers",
            ) ?? undefined,
          authProvider,
        },
      });
    } else {
      throw new DyadError(
        `Unsupported MCP transport: ${s.transport}`,
        DyadErrorKind.Validation,
      );
    }

    return client;
  }

  private closeClient(client: MCPClient): Promise<void> {
    return Promise.resolve().then(() => client.close());
  }

  dispose(connection: McpConnectionRef): Promise<void> {
    return this.disposeKey(mcpConnectionKey(connection));
  }

  private disposeKey(key: string): Promise<void> {
    const existingDisposal = this.disposals.get(key);
    if (existingDisposal) return existingDisposal;

    const initialization = this.initializations.get(key);
    if (initialization) {
      initialization.cancelled = true;
      // Detach the cancelled initialization immediately. If startup itself is
      // hung, a later getClient can retry after the bounded disposal window.
      // Its eventual result still observes `cancelled` and closes itself.
      this.initializations.delete(key);
    }

    // Delete from the cache before yielding so getClient cannot hand out a
    // client once disposal has begun.
    const client = this.clients.get(key);
    this.clients.delete(key);

    const disposal = settleWithinTimeout(
      Promise.allSettled([
        ...(client ? [this.closeClient(client)] : []),
        ...(initialization ? [initialization.promise] : []),
      ]),
      MCP_CLIENT_DISPOSAL_TIMEOUT_MS,
    ).finally(() => {
      if (this.disposals.get(key) === disposal) {
        this.disposals.delete(key);
      }
    });

    this.disposals.set(key, disposal);
    return disposal;
  }

  // Close every cached client. Server ids are only unique per database, so
  // anything that swaps databases (the test harness) must clear the cache or
  // a new server can silently reuse a stale client keyed to the same id.
  // Best-effort per client (allSettled): one dead transport must not block
  // closing the rest, and a rejection must not surface as an unhandled
  // promise rejection.
  disposeAll(): Promise<void> {
    if (this.disposeAllPromise) return this.disposeAllPromise;

    const keys = new Set([
      ...this.clients.keys(),
      ...this.initializations.keys(),
      ...this.disposals.keys(),
    ]);
    const disposeAllPromise = Promise.allSettled(
      [...keys].map((key) => this.disposeKey(key)),
    )
      .then(() => undefined)
      .finally(() => {
        if (this.disposeAllPromise === disposeAllPromise) {
          this.disposeAllPromise = undefined;
        }
      });

    this.disposeAllPromise = disposeAllPromise;
    return disposeAllPromise;
  }
}

export const mcpManager = McpManager.instance;
