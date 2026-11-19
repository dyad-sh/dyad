import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import log from "electron-log";
import { auth } from "@ai-sdk/mcp";
import {
  DyadOAuthClientProvider,
  decryptFromString,
  issueMcpOAuthWriteAuthority,
  revokeMcpOAuthWriteAuthority,
} from "./mcp_oauth_provider";
import { readMcpConnection } from "./mcp_connection_store";
import { DEFAULT_OAUTH_CALLBACK_PORT } from "../types/mcp";
import { mcpManager } from "./mcp_manager";
import { DyadError, DyadErrorKind } from "../../errors/dyad_error";
import {
  createMcpOAuthRegistry,
  type McpOAuthListenerHandle,
  type McpOAuthListenerRequest,
} from "@/mcp_oauth/registry";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { PendingReceiptLedger } from "@/state_machines/pending_receipt_ledger";
import { publishQueryInvalidations } from "./query_invalidation_delivery";
import {
  mcpConnectionKey,
  parseMcpConnectionKey,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

const logger = log.scope("mcp_oauth_flow");
const LOOPBACK_BIND_HOSTS = ["127.0.0.1", "::1"] as const;
// Keyed by mcpConnectionKey.
const mutatingConnections = new Set<string>();
const connectionMutationBarriers = new Map<string, Promise<unknown>>();
const latestOAuthRequestGeneration = new Map<string, number>();
const activeOAuthPreparations = new Set<
  Promise<{ success: boolean; error: string | null }>
>();
const OAUTH_REQUEST_RECEIPT_LIMIT = 128;
const OAUTH_REQUEST_RECEIPT_RETENTION_MS = 5 * 60_000;
let oauthShuttingDown = false;
const oauthReceiptLedger = new PendingReceiptLedger<{
  success: boolean;
  error: string | null;
}>({
  clock: systemClock,
  maxPendingEntries: OAUTH_REQUEST_RECEIPT_LIMIT,
  maxSettledEntries: OAUTH_REQUEST_RECEIPT_LIMIT,
  settledRetentionMs: OAUTH_REQUEST_RECEIPT_RETENTION_MS,
  disposal: {
    kind: "resolve",
    value: () => ({ success: false, error: "OAuth is shutting down." }),
  },
});

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

function renderCallbackPage(options: {
  kind: "success" | "error";
  title: string;
  message: string;
}): string {
  const isSuccess = options.kind === "success";
  const accent = isSuccess ? "#10b981" : "#ef4444";
  const safeTitle = escapeHtml(options.title);
  const safeMessage = escapeHtml(options.message);
  const returnUrl = "dyad://mcp-oauth-return";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${safeTitle} — Dyad</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
    background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
    color: #0f172a;
  }
  @media (prefers-color-scheme: dark) {
    body { background: linear-gradient(135deg, #0b1220 0%, #111827 100%); color: #e5e7eb; }
    .card { background: #1f2937; border-color: #374151; }
    .muted { color: #9ca3af; }
    a { color: #93c5fd; }
    .btn { background: #6366f1; color: #ffffff; }
    .btn:hover { background: #4f46e5; }
  }
  .card {
    max-width: 480px;
    width: calc(100% - 32px);
    padding: 32px;
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    text-align: center;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: ${accent}20;
    color: ${accent};
    margin-bottom: 20px;
    font-size: 28px;
    line-height: 1;
  }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0 0 20px; line-height: 1.5; }
  p:last-child { margin-bottom: 0; }
  .muted { color: #475569; font-size: 14px; }
  .btn {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 10px;
    background: #6366f1;
    color: #ffffff;
    font-weight: 600;
    text-decoration: none;
    border: none;
    cursor: pointer;
    margin-bottom: 16px;
  }
  .btn:hover { background: #4f46e5; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge" aria-hidden="true">${isSuccess ? "&#10003;" : "&#33;"}</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${
      isSuccess
        ? `<a class="btn" href="${returnUrl}">Open Dyad</a>
    <script>
      setTimeout(function () { window.location.href = ${JSON.stringify(returnUrl)}; }, 500);
    </script>`
        : `<p class="muted">You can close this window and return to Dyad.</p>`
    }
  </div>
</body>
</html>`;
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.close(finish);
    server.closeAllConnections();
    setTimeout(finish, 500);
  });
}

/** HTTP-only adapter: the registry owns all OAuth lifecycle decisions. */
function bindCallbackListener(
  request: McpOAuthListenerRequest,
): McpOAuthListenerHandle {
  const servers: Server[] = [];

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      if (!req.url) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${request.port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code") ?? undefined;
      const error = url.searchParams.get("error") ?? undefined;
      const claim = request.onCallback({
        invocationRef: request.invocationRef,
        state: url.searchParams.get("state"),
        code,
        error,
      });

      if (!claim.claimed) {
        logger.info(
          `Ignoring ${claim.reason} OAuth callback on port ${request.port}; keeping active flow alive.`,
        );
        res.writeHead(400, { "Content-Type": "text/html" }).end(
          renderCallbackPage({
            kind: "error",
            title: "Authorization could not be verified",
            message:
              "The browser's response didn't match the request Dyad started. You can close this window.",
          }),
        );
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          renderCallbackPage({
            kind: "success",
            title: "Authorization successful",
            message: "You can close this tab and return to Dyad.",
          }),
        );
        return;
      }

      res.writeHead(400, { "Content-Type": "text/html" }).end(
        renderCallbackPage({
          kind: "error",
          title: "Authorization failed",
          message: error ?? "missing code",
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`OAuth callback handler crashed: ${message}`);
      if (!res.headersSent) {
        res
          .writeHead(500, { "Content-Type": "text/plain" })
          .end("Internal error");
      }
    }
  };

  type BindResult =
    | { host: string; server: Server }
    | { host: string; error: "in_use" | "other" };
  const tryBind = (host: string): Promise<BindResult> =>
    new Promise((resolve) => {
      const server = createServer(handler);
      const onError = (error: Error & { code?: string }) => {
        logger.warn(
          `Could not bind OAuth callback listener on ${host}:${request.port}: ${error.message}`,
        );
        resolve({
          host,
          error: error.code === "EADDRINUSE" ? "in_use" : "other",
        });
      };
      server.once("error", onError);
      server.listen(request.port, host, () => {
        server.removeListener("error", onError);
        servers.push(server);
        resolve({ host, server });
      });
    });

  const bindResults = Promise.all(LOOPBACK_BIND_HOSTS.map(tryBind));
  const settled = bindResults.then((results) => {
    const boundHosts = results.flatMap((result) =>
      "server" in result ? [result.host] : [],
    );
    logger.info(
      `OAuth callback listener bind settled on http://localhost:${request.port} (${boundHosts.length} stack${boundHosts.length === 1 ? "" : "s"})`,
    );
    return {
      boundHosts,
      anyInUse: results.some(
        (result) => "error" in result && result.error === "in_use",
      ),
    };
  });

  let closing: Promise<void> | undefined;
  return {
    settled,
    close() {
      closing ??= bindResults
        .then(() => Promise.all(servers.map(closeServer)))
        .then(() => undefined);
      return closing;
    },
  };
}

const mcpOAuthRegistry = createMcpOAuthRegistry({
  clock: systemClock,
  ids: uuidIdSource,
  bindListener: bindCallbackListener,
  onSettled: (connectionKey) => {
    // Issuing an interactive authority invalidates any cached background
    // provider for this server. Rebuild it after every terminal outcome,
    // including cancellation/failure, so later refreshes capture the current
    // epoch instead of remaining permanently fenced.
    const connection = parseMcpConnectionKey(connectionKey);
    void mcpManager.dispose(connection).catch(() => {});
    publishQueryInvalidations([
      { family: "mcp-servers" },
      { family: "mcp-tools", serverId: connection.serverId },
    ]);
  },
});

interface RunOAuthFlowParams {
  connection: McpConnectionRef;
  /** Required by IPC; optional only for direct main-process callers/tests. */
  rendererMessageId?: string;
  callbackPort?: number;
}

/** Preserve the IPC-facing `{success, error}` contract. */
export function runOAuthFlow(
  params: RunOAuthFlowParams,
): Promise<{ success: boolean; error: string | null }> {
  const rendererMessageId =
    params.rendererMessageId ?? `main:${globalThis.crypto.randomUUID()}`;
  if (oauthShuttingDown) {
    return Promise.resolve({
      success: false,
      error: "OAuth is shutting down.",
    });
  }
  let admitted = false;
  const connectionKey = mcpConnectionKey(params.connection);
  const claim = oauthReceiptLedger.claim({
    scope: "mcp-oauth-flow",
    messageId: rendererMessageId,
    fingerprint: connectionKey,
    start: () => {
      const generation =
        (latestOAuthRequestGeneration.get(connectionKey) ?? 0) + 1;
      latestOAuthRequestGeneration.set(connectionKey, generation);
      const preparation = prepareAndRunOAuthFlow(
        { ...params, rendererMessageId },
        generation,
        () => {
          admitted = true;
        },
      );
      activeOAuthPreparations.add(preparation);
      const release = () => activeOAuthPreparations.delete(preparation);
      void preparation.then(release, release);
      return preparation;
    },
    retention: () => (admitted ? "retain" : "remove"),
  });
  if (claim.kind === "fresh" || claim.kind === "duplicate") {
    return claim.receipt;
  }
  if (claim.kind === "conflict") {
    return Promise.resolve({
      success: false,
      error: "OAuth retry message ID was reused for a different server.",
    });
  }
  return Promise.resolve({
    success: false,
    error:
      claim.kind === "capacity-rejected"
        ? "Too many OAuth requests are already pending; finish or cancel one and retry."
        : "OAuth is shutting down.",
  });
}

async function prepareAndRunOAuthFlow(
  params: RunOAuthFlowParams & { rendererMessageId: string },
  generation: number,
  onAdmitted: () => void,
): Promise<{ success: boolean; error: string | null }> {
  const connectionKey = mcpConnectionKey(params.connection);
  if (oauthShuttingDown || mutatingConnections.has(connectionKey)) {
    return {
      success: false,
      error: oauthShuttingDown
        ? "OAuth is shutting down."
        : "MCP server configuration is changing; retry OAuth in a moment.",
    };
  }
  // Every await comes before the recheck below, so nothing can change the
  // connection between the recheck and issuing its write authority.
  const server = await readMcpConnection(params.connection);
  if (
    oauthShuttingDown ||
    mutatingConnections.has(connectionKey) ||
    latestOAuthRequestGeneration.get(connectionKey) !== generation
  ) {
    return {
      success: false,
      error: oauthShuttingDown
        ? "OAuth is shutting down."
        : latestOAuthRequestGeneration.get(connectionKey) !== generation
          ? "OAuth flow superseded by a newer Connect attempt."
          : "MCP server configuration is changing; retry OAuth in a moment.",
    };
  }
  if (!server) {
    return {
      success: false,
      error: `MCP server not found: ${connectionKey}`,
    };
  }
  if (!server.url) {
    return {
      success: false,
      error: `MCP server "${server.displayName}" has no URL; OAuth requires HTTP transport.`,
    };
  }
  if (server.transport !== "http") {
    return {
      success: false,
      error: `OAuth not supported for transport "${server.transport}".`,
    };
  }

  const serverUrl = server.url;
  const callbackPort =
    params.callbackPort ??
    server.oauthCallbackPort ??
    DEFAULT_OAUTH_CALLBACK_PORT;
  const scope = server.oauthScope ?? undefined;
  let decryptedClientSecret: string | undefined;
  try {
    decryptedClientSecret = server.oauthClientSecret
      ? decryptFromString(server.oauthClientSecret) || undefined
      : undefined;
  } catch {
    throw new DyadError(
      "Saved MCP OAuth client secret could not be opened. Unlock or restore your OS keyring and retry, or re-enter the client secret in the plugin settings. Resetting OAuth does not remove the configured client secret.",
      DyadErrorKind.Precondition,
    );
  }
  const expectedState = generateState();
  const writeAuthority = issueMcpOAuthWriteAuthority(server.connection);
  const provider = new DyadOAuthClientProvider({
    connection: server.connection,
    callbackPort,
    scope,
    preregisteredClientId: server.oauthClientId ?? undefined,
    preregisteredClientSecret: decryptedClientSecret,
    flowState: expectedState,
    allowInteractive: true,
    writeAuthority,
  });

  let silentlyAuthorized = false;
  onAdmitted();
  const result = await mcpOAuthRegistry.connect({
    port: callbackPort,
    connectionKey,
    rendererMessageId: params.rendererMessageId,
    expectedState,
    authorize: async (authorizationCode) => {
      const authResult = await auth(provider, {
        serverUrl,
        scope,
        ...(authorizationCode === undefined ? {} : { authorizationCode }),
      });
      silentlyAuthorized =
        authorizationCode === undefined && authResult === "AUTHORIZED";
      return authResult;
    },
    onAbort: () => provider.abort(),
  });

  if (result.success) {
    if (silentlyAuthorized) {
      await mcpManager.dispose(server.connection);
    } else {
      void mcpManager.dispose(server.connection).catch(() => {});
    }
  } else {
    logger.warn(
      `OAuth flow failed for server ${connectionKey}: ${result.error}`,
    );
  }
  return result;
}

export async function disconnectOAuth(
  connection: McpConnectionRef,
): Promise<{ success: boolean }> {
  return withMcpOAuthServerMutation(
    connection,
    "OAuth flow cancelled because the server was disconnected.",
    async () => {
      if (!(await readMcpConnection(connection))) {
        throw new DyadError(
          `MCP server not found: ${mcpConnectionKey(connection)}`,
          DyadErrorKind.NotFound,
        );
      }
      const provider = new DyadOAuthClientProvider({
        connection,
        allowInteractive: true,
      });
      await provider.disconnect();
      void mcpManager.dispose(connection).catch(() => {});
      return { success: true };
    },
  );
}

/**
 * Revoke a server flow before any deletion or OAuth-relevant row mutation.
 * Registry cancellation aborts provider work and settles the renderer waiter;
 * the authority barrier then fences writes that were already queued.
 */
export async function cancelMcpOAuthForServer(
  connection: McpConnectionRef,
  reason: string,
): Promise<void> {
  await mcpOAuthRegistry.cancelConnection(mcpConnectionKey(connection), reason);
  await revokeMcpOAuthWriteAuthority(connection);
}

export function withMcpOAuthServerMutation<T>(
  connection: McpConnectionRef,
  reason: string,
  mutate: () => Promise<T>,
): Promise<T> {
  // Fence both active flows and preparations that are currently awaiting the
  // row read. Keep the admission fence raised across an entire queued
  // mutation chain; only the last barrier for this server may lower it.
  const connectionKey = mcpConnectionKey(connection);
  mutatingConnections.add(connectionKey);
  latestOAuthRequestGeneration.set(
    connectionKey,
    (latestOAuthRequestGeneration.get(connectionKey) ?? 0) + 1,
  );
  const previous =
    connectionMutationBarriers.get(connectionKey)?.catch(() => undefined) ??
    Promise.resolve();
  const operation = previous.then(async () => {
    await cancelMcpOAuthForServer(connection, reason);
    return await mutate();
  });
  connectionMutationBarriers.set(connectionKey, operation);
  const clearBarrier = () => {
    if (connectionMutationBarriers.get(connectionKey) === operation) {
      connectionMutationBarriers.delete(connectionKey);
      mutatingConnections.delete(connectionKey);
    }
  };
  void operation.then(clearBarrier, clearBarrier);
  return operation;
}

export async function disposeMcpOAuthForShutdown(): Promise<void> {
  oauthShuttingDown = true;
  const pendingPreparations = [...activeOAuthPreparations];
  oauthReceiptLedger.dispose();
  await Promise.all([
    mcpOAuthRegistry.dispose(),
    Promise.allSettled(pendingPreparations),
  ]);
}
