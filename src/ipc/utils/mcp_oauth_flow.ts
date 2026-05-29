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
import { DyadError, DyadErrorKind } from "../../errors/dyad_error";

const logger = log.scope("mcp_oauth_flow");

// Cap on how long the loopback listener waits for browser-side
// consent. Past this, tear it down and error out -- otherwise a
// closed tab would leak the listener indefinitely.
const OAUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingFlow {
  reject: (err: Error) => void;
  // Servers are pushed as their bind completes (even if the flow has
  // since been superseded), so a supersede can enumerate them via
  // `servers` after awaiting `binding`.
  servers: Server[];
  // Resolves once the initial bind attempts have all settled. A
  // supersede awaits this so the previous flow's `listen()` calls
  // can't win the port between our `pendingFlows.delete` and our own
  // bind, which would surface as EADDRINUSE.
  binding: Promise<void>;
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Self-contained (no external assets) so it works on the loopback
// listener. On success, auto-fires the `dyad://mcp-oauth-return`
// deep link to bring Dyad to the foreground, with a visible "Open
// Dyad" button as a fallback for browsers that block scripted
// protocol-handler navigation.
function renderCallbackPage(opts: {
  kind: "success" | "error";
  title: string;
  message: string;
}): string {
  const isSuccess = opts.kind === "success";
  const accent = isSuccess ? "#10b981" : "#ef4444";
  const safeTitle = escapeHtml(opts.title);
  const safeMessage = escapeHtml(opts.message);
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
      // Try to hand focus back to Dyad automatically; the button above
      // is the fallback for browsers that block scripted navigation
      // to custom protocol handlers.
      setTimeout(function () { window.location.href = ${JSON.stringify(returnUrl)}; }, 500);
    </script>`
        : `<p class="muted">You can close this window and return to Dyad.</p>`
    }
  </div>
</body>
</html>`;
}

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
    // Wait for any in-flight `tryBind` calls so `existing.servers`
    // includes every socket that successfully bound, even ones that
    // bound after the supersede flipped `disposed`.
    await existing.binding;
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

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Pre-attach a no-op observer so a rejection fired before the caller
  // gets the listener (e.g. a supersede landing while we're still
  // awaiting the loopback bind) doesn't surface as an unhandled
  // rejection in the Electron main process. Real observers attached
  // later still see the rejection.
  code.catch(() => undefined);

  // Set before flow.reject so a supersede also flips `disposed` and
  // any in-flight bind from this flow tears itself down on completion.
  let disposed = false;

  const flow: PendingFlow = {
    reject: (err: Error) => {
      disposed = true;
      rejectCode(err);
    },
    servers: [],
    // Overwritten below before `pendingFlows.set` exposes the flow.
    binding: Promise.resolve(),
    timeout: null,
  };

  // Tears down only this flow's resources; drops the map entry only
  // while it still belongs to this flow.
  const dispose = (): void => {
    disposed = true;
    if (flow.timeout) clearTimeout(flow.timeout);
    for (const s of flow.servers) s.close();
    if (pendingFlows.get(port) === flow) pendingFlows.delete(port);
  };

  const settle = (fn: () => void): void => {
    dispose();
    fn();
  };

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    try {
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
        // Don't tear down the listener: a stale callback from a
        // superseded Connect attempt (old browser tab finishing after
        // a retry) carries the previous flow's `state`. Returning an
        // error page is enough to dismiss it; the active flow's real
        // callback can still arrive.
        logger.info(
          `Ignoring OAuth callback with mismatched state on port ${port}; keeping active flow alive.`,
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
        settle(() => resolveCode(code));
        return;
      }

      const safeErr = escapeHtml(errParam ?? "missing code");
      res.writeHead(400, { "Content-Type": "text/html" }).end(
        renderCallbackPage({
          kind: "error",
          title: "Authorization failed",
          message: safeErr,
        }),
      );
      settle(() =>
        rejectCode(
          new Error(`OAuth callback error: ${errParam ?? "missing code"}`),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`OAuth callback handler crashed: ${message}`);
      if (!res.headersSent) {
        res
          .writeHead(500, { "Content-Type": "text/plain" })
          .end("Internal error");
      }
      settle(() => rejectCode(err instanceof Error ? err : new Error(message)));
    }
  };

  // EADDRINUSE means the other process owns the address; "other"
  // means the stack is unavailable (e.g. IPv6 disabled). Partial-bind
  // is safe only for the second case.
  type BindResult =
    | { server: Server }
    | { error: "in_use" }
    | { error: "other" };
  const tryBind = (host: string): Promise<BindResult> =>
    new Promise((resolveBind) => {
      const s = createServer(handler);
      const onError = (err: Error & { code?: string }) => {
        logger.warn(
          `Could not bind OAuth callback listener on ${host}:${port}: ${err.message}`,
        );
        resolveBind({ error: err.code === "EADDRINUSE" ? "in_use" : "other" });
      };
      s.once("error", onError);
      s.listen(port, host, () => {
        s.removeListener("error", onError);
        resolveBind({ server: s });
      });
    });

  // Push to `flow.servers` as soon as a bind succeeds (rather than
  // after the whole `Promise.all`) so a supersede landing during the
  // bind window can observe and close every bound socket.
  const bindPromises = LOOPBACK_BIND_HOSTS.map(async (host) => {
    const result = await tryBind(host);
    if ("server" in result) flow.servers.push(result.server);
    return result;
  });
  flow.binding = Promise.all(bindPromises).then(() => undefined);

  // Register the pending flow before kicking off the async bind so a
  // concurrent Connect on the same port sees this entry and supersedes
  // it (rather than racing into its own bind and hitting EADDRINUSE).
  pendingFlows.set(port, flow);

  // Await the bind so callers can safely open the browser knowing the
  // callback endpoint is actually listening. Without this, `auth()`
  // could redirect before the socket was ready and hit ECONNREFUSED.
  await flow.binding;

  if (disposed) {
    for (const s of flow.servers) s.close();
    if (pendingFlows.get(port) === flow) pendingFlows.delete(port);
    // Throw rather than return: a returned listener would let
    // `runOAuthFlow` proceed into `auth(provider)` and open the
    // browser for an already-superseded flow, whose stale callback
    // could land on the new listener with a mismatching `state` and
    // abort the real flow.
    throw new Error("OAuth flow superseded before listener bound.");
  }
  // Already settled — `flow.binding` awaited the same promises.
  const bindResults = await Promise.all(bindPromises);
  // EADDRINUSE on either stack is fatal: `localhost` could resolve
  // to the busy address and the callback would land out of reach.
  if (bindResults.some((r) => "error" in r && r.error === "in_use")) {
    for (const s of flow.servers) s.close();
    if (pendingFlows.get(port) === flow) pendingFlows.delete(port);
    throw new Error(
      `Could not bind OAuth callback listener on port ${port}: ` +
        `another local process is holding one of the loopback stacks (127.0.0.1 / ::1). ` +
        `Stop the conflicting process or configure a different OAuth callback port.`,
    );
  }
  if (flow.servers.length === 0) {
    if (pendingFlows.get(port) === flow) pendingFlows.delete(port);
    // Don't reject `code` here: we throw before returning, so the
    // caller never gets a listener to attach `code.catch(...)` to,
    // and a rejected-but-unobserved `code` would surface as an
    // unhandled rejection in the Electron main process.
    throw new Error(
      `Could not bind OAuth callback listener on port ${port} (tried IPv4 and IPv6 loopback).`,
    );
  }

  flow.timeout = setTimeout(() => {
    dispose();
    rejectCode(
      new Error(
        `OAuth flow timed out after ${OAUTH_FLOW_TIMEOUT_MS / 1000}s. Did you close the browser tab?`,
      ),
    );
  }, OAUTH_FLOW_TIMEOUT_MS);
  logger.info(
    `OAuth callback listener bound on http://localhost:${port} (${flow.servers.length} stack${flow.servers.length === 1 ? "" : "s"})`,
  );

  return { code, dispose };
}

interface RunOAuthFlowParams {
  serverId: number;
  callbackPort?: number;
}

/**
 * Drive the full OAuth flow for a configured MCP server. Every
 * failure path (validation, not-found, live OAuth) returns
 * `{success, error}` so the renderer's `connectFeedback` UI can
 * render inline. (`disconnectOAuth` throws `DyadError(NotFound)`
 * instead — its caller `try/catch`es it.)
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
      error: `MCP server "${s.name}" has no URL; OAuth requires HTTP transport.`,
    };
  }
  if (s.transport !== "http") {
    return {
      success: false,
      error: `OAuth not supported for transport "${s.transport}".`,
    };
  }

  const callbackPort =
    params.callbackPort ?? s.oauthCallbackPort ?? DEFAULT_OAUTH_CALLBACK_PORT;
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
  // A bind failure here must surface through the `{success, error}`
  // return contract, not as an uncaught throw across the IPC boundary.
  let listener: CallbackListener;
  try {
    listener = await startCallbackListener(callbackPort, expectedState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Could not start OAuth callback listener for server ${s.id}: ${message}`,
    );
    return { success: false, error: message };
  }
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
  if (!rows[0]) {
    throw new DyadError(
      `MCP server not found: ${serverId}`,
      DyadErrorKind.NotFound,
    );
  }
  // `invalidateCredentials` only deletes state; no need to read /
  // decrypt the pre-registered client_id / client_secret.
  // `allowInteractive` so the invalidate guard doesn't no-op this
  // user-initiated cleanup.
  const provider = new DyadOAuthClientProvider({
    serverId,
    allowInteractive: true,
  });
  await provider.invalidateCredentials("all");
  mcpManager.dispose(serverId);
  return { success: true };
}
