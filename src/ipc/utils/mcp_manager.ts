import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { eq } from "drizzle-orm";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DyadOAuthClientProvider,
  decryptFromString,
} from "./mcp_oauth_provider";
import { settleWithinTimeout } from "./promise_utils";

type ClientInitialization = {
  cancelled: boolean;
  promise: Promise<MCPClient>;
};

const MCP_CLIENT_DISPOSAL_TIMEOUT_MS = 1_500;

export class McpManager {
  private static _instance: McpManager;
  static get instance(): McpManager {
    if (!this._instance) this._instance = new McpManager();
    return this._instance;
  }

  private clients = new Map<number, MCPClient>();
  private initializations = new Map<number, ClientInitialization>();
  private disposals = new Map<number, Promise<void>>();
  private disposeAllPromise: Promise<void> | undefined;

  async getClient(serverId: number): Promise<MCPClient> {
    while (true) {
      const disposal = this.disposeAllPromise ?? this.disposals.get(serverId);
      if (!disposal) break;
      await disposal;
    }

    const existing = this.clients.get(serverId);
    if (existing) return existing;

    const existingInitialization = this.initializations.get(serverId);
    if (existingInitialization) return existingInitialization.promise;

    const initialization = {} as ClientInitialization;
    initialization.cancelled = false;
    initialization.promise = this.createClient(serverId)
      .then(async (client) => {
        if (initialization.cancelled) {
          await Promise.allSettled([this.closeClient(client)]);
          throw new DyadError(
            `MCP client initialization cancelled for server ${serverId}`,
            DyadErrorKind.Precondition,
          );
        }

        // This should not normally be reachable because initialization promises
        // are coalesced above. Keep the guard so a future cache mutation cannot
        // leak a second transport or replace a client that is already in use.
        const raceWinner = this.clients.get(serverId);
        if (raceWinner) {
          await Promise.allSettled([this.closeClient(client)]);
          return raceWinner;
        }

        this.clients.set(serverId, client);
        return client;
      })
      .finally(() => {
        if (this.initializations.get(serverId) === initialization) {
          this.initializations.delete(serverId);
        }
      });

    this.initializations.set(serverId, initialization);
    return initialization.promise;
  }

  private async createClient(serverId: number): Promise<MCPClient> {
    const server = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, serverId));
    const s = server.find((x) => x.id === serverId);
    if (!s) throw new Error(`MCP server not found: ${serverId}`);

    let client: MCPClient;
    if (s.transport === "stdio") {
      const args = s.args ?? [];
      const env = s.envJson ?? undefined;
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
            serverId: s.id,
            callbackPort: s.oauthCallbackPort ?? undefined,
            scope: s.oauthScope ?? undefined,
            preregisteredClientId: s.oauthClientId ?? undefined,
            preregisteredClientSecret: s.oauthClientSecret
              ? decryptFromString(s.oauthClientSecret) || undefined
              : undefined,
          })
        : undefined;
      client = await createMCPClient({
        transport: {
          type: s.transport,
          url: s.url,
          headers: s.headersJson ?? undefined,
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

  dispose(serverId: number): Promise<void> {
    const existingDisposal = this.disposals.get(serverId);
    if (existingDisposal) return existingDisposal;

    const initialization = this.initializations.get(serverId);
    if (initialization) {
      initialization.cancelled = true;
      // Detach the cancelled initialization immediately. If startup itself is
      // hung, a later getClient can retry after the bounded disposal window.
      // Its eventual result still observes `cancelled` and closes itself.
      this.initializations.delete(serverId);
    }

    // Delete from the cache before yielding so getClient cannot hand out a
    // client once disposal has begun.
    const client = this.clients.get(serverId);
    this.clients.delete(serverId);

    const disposal = settleWithinTimeout(
      Promise.allSettled([
        ...(client ? [this.closeClient(client)] : []),
        ...(initialization ? [initialization.promise] : []),
      ]),
      MCP_CLIENT_DISPOSAL_TIMEOUT_MS,
    ).finally(() => {
      if (this.disposals.get(serverId) === disposal) {
        this.disposals.delete(serverId);
      }
    });

    this.disposals.set(serverId, disposal);
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

    const serverIds = new Set([
      ...this.clients.keys(),
      ...this.initializations.keys(),
      ...this.disposals.keys(),
    ]);
    const disposeAllPromise = Promise.allSettled(
      [...serverIds].map((serverId) => this.dispose(serverId)),
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
