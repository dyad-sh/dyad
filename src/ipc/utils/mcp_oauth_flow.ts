import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import log from "electron-log";
import { auth } from "@ai-sdk/mcp";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import {
  DyadOAuthClientProvider,
  decryptFromString,
} from "./mcp_oauth_provider";
import { DEFAULT_OAUTH_CALLBACK_PORT } from "../types/mcp";
import { mcpManager } from "./mcp_manager";

const logger = log.scope("mcp_oauth_flow");

// Cap on how long the loopback listener waits for browser-side
// consent. Past this, tear it down and error out -- otherwise a
// closed tab would leak the listener indefinitely.
const OAUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingFlow {
  reject: (err: Error) => void;
  servers: Server[];
  timeout: NodeJS.Timeout | null;
}

// Returned by startCallbackListener: the awaited code, plus a dispose
// that tears down only this flow's own listener.
interface CallbackListener {
  code: Promise<string>;
  dispose: () => void;
}

// At most one OAuth flow per port at a time. A second Connect on the
// same port supersedes the first (which rejects with "superseded")
// rather than queueing. Map key is the port number.
const pendingFlows = new Map<number, PendingFlow>();

function generateState(): string {
  // 16 random bytes -> 22-char base64url. Used as the OAuth `state`
  // parameter for CSRF protection: verified on callback before we
  // accept the `code`.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// Bind both IPv4 and IPv6 loopback: `localhost` often resolves to
// `::1` first, so a `127.0.0.1`-only listener would miss the browser's
// callback. Partial success is fine -- one bound stack is enough.
const LOOPBACK_BIND_HOSTS = ["127.0.0.1", "::1"] as const;

async function startCallbackListener(
  port: number,
  expectedState: string,
): Promise<CallbackListener> {
  // Supersede any flow already pending on this port (user clicked
  // Connect again). Reject the old promise, then wait for its sockets
  // to finish closing before the new listener binds.
  const existing = pendingFlows.get(port);
  if (existing) {
    logger.info(`Superseding stale OAuth flow on port ${port}`);
    if (existing.timeout) clearTimeout(existing.timeout);
    pendingFlows.delete(port);
    existing.reject(
      new Error("OAuth flow superseded by a new Connect attempt."),
    );
    await Promise.all(
      existing.servers.map(
        (s) =>
          new Promise<void>((resolveClose) => {
            s.close(() => resolveClose());
            setTimeout(() => resolveClose(), 500);
          }),
      ),
    );
  }

  const flow: PendingFlow = { reject: () => {}, servers: [], timeout: null };
  let disposed = false;

  // Tears down only this flow's resources; drops the map entry only
  // while it still belongs to this flow.
  const dispose = (): void => {
    disposed = true;
    if (flow.timeout) clearTimeout(flow.timeout);
    for (const s of flow.servers) s.close();
    if (pendingFlows.get(port) === flow) pendingFlows.delete(port);
  };

  const code = new Promise<string>((resolve, reject) => {
    flow.reject = reject;

    const settle = (fn: () => void) => {
      dispose();
      fn();
    };

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      if (!req.url) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const errParam = url.searchParams.get("error");
      const state = url.searchParams.get("state");

      if (state !== expectedState) {
        res
          .writeHead(400, { "Content-Type": "text/html" })
          .end(
            "<html><body><h1>OAuth state mismatch</h1><p>This window can be closed; the flow will be retried.</p></body></html>",
          );
        settle(() =>
          reject(
            new Error(
              "OAuth callback `state` did not match. Aborting to prevent CSRF.",
            ),
          ),
        );
        return;
      }

      if (code) {
        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            "<html><body><h1>Authorization successful</h1><p>You can close this window and return to Dyad.</p></body></html>",
          );
        settle(() => resolve(code));
        return;
      }

      const safeErr = (errParam ?? "missing code").replace(
        /[&<>"']/g,
        (c) => `&#${c.charCodeAt(0)};`,
      );
      res
        .writeHead(400, { "Content-Type": "text/html" })
        .end(`<html><body><h1>OAuth error</h1><p>${safeErr}</p></body></html>`);
      settle(() =>
        reject(
          new Error(`OAuth callback error: ${errParam ?? "missing code"}`),
        ),
      );
    };

    const tryBind = (host: string): Promise<Server | null> =>
      new Promise((resolveBind) => {
        const s = createServer(handler);
        const onError = (err: Error) => {
          logger.warn(
            `Could not bind OAuth callback listener on ${host}:${port}: ${err.message}`,
          );
          resolveBind(null);
        };
        s.once("error", onError);
        s.listen(port, host, () => {
          s.removeListener("error", onError);
          resolveBind(s);
        });
      });

    Promise.all(LOOPBACK_BIND_HOSTS.map(tryBind)).then((bindResults) => {
      const bound = bindResults.filter((s): s is Server => s !== null);
      // Disposed before the bind resolved (e.g. silent-refresh path):
      // close the sockets and never register.
      if (disposed) {
        for (const s of bound) s.close();
        return;
      }
      if (bound.length === 0) {
        reject(
          new Error(
            `Could not bind OAuth callback listener on port ${port} (tried IPv4 and IPv6 loopback).`,
          ),
        );
        return;
      }
      flow.servers.push(...bound);
      flow.timeout = setTimeout(() => {
        dispose();
        reject(
          new Error(
            `OAuth flow timed out after ${OAUTH_FLOW_TIMEOUT_MS / 1000}s. Did you close the browser tab?`,
          ),
        );
      }, OAUTH_FLOW_TIMEOUT_MS);
      pendingFlows.set(port, flow);
      logger.info(
        `OAuth callback listener bound on http://localhost:${port} (${bound.length} stack${bound.length === 1 ? "" : "s"})`,
      );
    });
  });

  return { code, dispose };
}

interface RunOAuthFlowParams {
  serverId: number;
  callbackPort?: number;
}

/**
 * Drive the full OAuth flow for a configured MCP server. Validation
 * and flow failures return `{success: false, error}` so the renderer
 * can show the message inline.
 */
export async function runOAuthFlow(
  params: RunOAuthFlowParams,
): Promise<{ success: boolean; error: string | null }> {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, params.serverId));
  const s = rows[0];
  if (!s) {
    return {
      success: false,
      error: `MCP server not found: ${params.serverId}`,
    };
  }
  if (!s.url) {
    return {
      success: false,
      error: `MCP server "${s.name}" has no URL; OAuth requires HTTP or SSE transport.`,
    };
  }
  if (s.transport !== "http" && s.transport !== "sse") {
    return {
      success: false,
      error: `OAuth not supported for transport "${s.transport}".`,
    };
  }

  const callbackPort = params.callbackPort ?? DEFAULT_OAUTH_CALLBACK_PORT;
  // Scope values are defined by each OAuth server; there is no
  // universal default that works across providers. Pass through
  // whatever the user configured, otherwise omit the `scope`
  // parameter entirely so the server applies its own default.
  const scope = s.oauthScope ?? undefined;
  const decryptedClientSecret = s.oauthClientSecret
    ? decryptFromString(s.oauthClientSecret) || undefined
    : undefined;
  const expectedState = generateState();
  const provider = new DyadOAuthClientProvider({
    serverId: s.id,
    callbackPort,
    scope,
    preregisteredClientId: s.oauthClientId ?? undefined,
    preregisteredClientSecret: decryptedClientSecret,
    flowState: expectedState,
    allowInteractive: true,
  });

  // Start the listener before `auth()` -- `auth()` opens the browser
  // and the callback can arrive before a later bind would be ready.
  const listener = await startCallbackListener(callbackPort, expectedState);
  // Side-handler so an early bind-failure rejection isn't unhandled
  // during the long `await auth()`; the real rejection still
  // propagates through `await listener.code` below.
  listener.code.catch(() => undefined);

  try {
    // First call kicks off discovery / DCR and opens the browser.
    // Returns 'AUTHORIZED' when a silent refresh already succeeded.
    const initial = await auth(provider, {
      serverUrl: s.url,
      scope,
    });
    if (initial === "AUTHORIZED") {
      listener.dispose();
      mcpManager.dispose(s.id);
      return { success: true, error: null };
    }

    const code = await listener.code;
    const final = await auth(provider, {
      serverUrl: s.url,
      authorizationCode: code,
    });
    if (final !== "AUTHORIZED") {
      return {
        success: false,
        error: "OAuth completed without authorization; please try again.",
      };
    }

    // Rebuild the cached MCP client so it picks up the new tokens.
    mcpManager.dispose(s.id);
    return { success: true, error: null };
  } catch (err) {
    listener.dispose();
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`OAuth flow failed for server ${s.id}: ${message}`);
    return { success: false, error: message };
  }
}

export async function disconnectOAuth(
  serverId: number,
): Promise<{ success: boolean }> {
  const rows = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId));
  if (!rows[0]) return { success: false };
  // `invalidateCredentials` only deletes state; it doesn't read the
  // pre-registered client_id / client_secret, so don't decrypt or
  // pass them.
  const provider = new DyadOAuthClientProvider({ serverId });
  await provider.invalidateCredentials("all");
  mcpManager.dispose(serverId);
  return { success: true };
}
