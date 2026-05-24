// Fake OAuth-protected MCP server for local + automated testing.
//
// Bundles a minimal OAuth 2.1 authorization server (discovery, DCR,
// /authorize, /token, refresh) AND a Streamable-HTTP MCP endpoint
// behind it. Used to exercise the Dyad MCP OAuth flow against a
// deterministic, controllable target rather than a real provider.
//
// Env knobs:
//   PORT                  default 4002
//   FAKE_DCR              "1" (default) accepts /register; "0" rejects it
//   FAKE_CLIENT_ID        when DCR=0, the only accepted client_id
//   FAKE_CLIENT_SECRET    optional; when set, /token requires it
//   FAKE_REQUIRED_SCOPE   optional; /authorize 400s when scope missing
//   FAKE_TOKEN_TTL_SEC    access-token lifetime, default 3600
//
// The /authorize endpoint auto-redirects with a code -- no consent
// UI -- so tests can drive the full flow without a browser. PKCE is
// enforced (S256). Refresh tokens rotate on use.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4002;
const DCR_ENABLED = (process.env.FAKE_DCR ?? "1") === "1";
const STATIC_CLIENT_ID = process.env.FAKE_CLIENT_ID ?? null;
const STATIC_CLIENT_SECRET = process.env.FAKE_CLIENT_SECRET ?? null;
const REQUIRED_SCOPE = process.env.FAKE_REQUIRED_SCOPE ?? null;
const TOKEN_TTL_SEC = process.env.FAKE_TOKEN_TTL_SEC
  ? parseInt(process.env.FAKE_TOKEN_TTL_SEC, 10)
  : 3600;

if (!DCR_ENABLED && !STATIC_CLIENT_ID) {
  console.error(
    "FAKE_DCR=0 requires FAKE_CLIENT_ID to be set (no DCR + no static client = no clients).",
  );
  process.exit(1);
}

const BASE = `http://localhost:${PORT}`;

// In-memory stores. All reset on process restart -- the point of the
// fake is determinism per test run, not persistence.
const registeredClients = new Map(); // client_id -> {client_secret?}
const pendingCodes = new Map(); // code -> {client_id, code_challenge, redirect_uri, scope, expires_at}
const issuedTokens = new Map(); // access_token -> {client_id, expires_at, scope}
const refreshTokens = new Map(); // refresh_token -> {client_id, scope}

if (!DCR_ENABLED && STATIC_CLIENT_ID) {
  registeredClients.set(STATIC_CLIENT_ID, {
    client_secret: STATIC_CLIENT_SECRET ?? undefined,
    // `null` means "accept any redirect_uri" -- static clients here
    // don't pre-declare URIs, matching the legacy fixture behavior.
    redirect_uris: null,
  });
}

function makeOpaque(byteLen = 24) {
  return randomBytes(byteLen).toString("base64url");
}

function verifyPkce(verifier, challenge) {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

// RFC 8252 §7.3: loopback redirect URIs match by host + path with any
// port. Non-loopback URIs must match exactly. Returns true if the
// requested URI matches any registered URI under those rules.
function matchesRegisteredRedirect(requested, registeredList) {
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  let req;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  for (const candidate of registeredList) {
    if (candidate === requested) return true;
    let reg;
    try {
      reg = new URL(candidate);
    } catch {
      continue;
    }
    // RFC 8252 §7.3 only relaxes port matching, NOT host matching --
    // `localhost` registrations must not auto-match `127.0.0.1`/`::1`
    // and vice versa, or a malicious client could swap hosts to land
    // its callback on a different loopback listener.
    const sameLoopback =
      loopbackHosts.has(reg.hostname) &&
      reg.hostname === req.hostname &&
      reg.protocol === req.protocol &&
      reg.pathname === req.pathname;
    if (sameLoopback) return true;
  }
  return false;
}

// --- MCP server (one shared instance; auth gates the /mcp HTTP route) ---
const mcp = new McpServer({ name: "fake-oauth-mcp", version: "0.1.0" });

mcp.registerTool(
  "calculator_add",
  {
    title: "Calculator Add",
    description: "Add two numbers and return the sum",
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  }),
);

// AsyncLocalStorage scopes the authenticated client_id to the current
// request so concurrent `/mcp` calls can't see each other's identity.
const requestContext = new AsyncLocalStorage();

mcp.registerTool(
  "whoami",
  {
    title: "Who Am I",
    description:
      "Returns the bearer-token client_id this request authenticated as",
    inputSchema: {},
  },
  async (_args, _extra) => {
    const ctx = requestContext.getStore();
    return {
      content: [{ type: "text", text: ctx?.clientId ?? "anonymous" }],
    };
  },
);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await mcp.connect(transport);

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);

  // CORS preflight (kept permissive; this is a test fixture)
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // RFC 8414 discovery
    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      const meta = {
        issuer: BASE,
        authorization_endpoint: `${BASE}/authorize`,
        token_endpoint: `${BASE}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: STATIC_CLIENT_SECRET
          ? ["client_secret_post", "none"]
          : ["none"],
      };
      if (DCR_ENABLED) meta.registration_endpoint = `${BASE}/register`;
      jsonResponse(res, 200, meta);
      return;
    }

    // RFC 9728 protected-resource metadata (the SDK looks here too)
    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/oauth-protected-resource"
    ) {
      jsonResponse(res, 200, {
        resource: BASE,
        authorization_servers: [BASE],
      });
      return;
    }

    // RFC 7591 dynamic client registration
    if (req.method === "POST" && url.pathname === "/register") {
      if (!DCR_ENABLED) {
        jsonResponse(res, 404, {
          error: "registration_not_supported",
          error_description: "This fake is configured with DCR disabled.",
        });
        return;
      }
      const body = JSON.parse(await readBody(req));
      const clientId = `dcr-${makeOpaque(8)}`;
      // Persist the registered redirect_uris so /authorize can enforce
      // exact-match (RFC 6749 §3.1.2.2 / §10.6) instead of trusting
      // whatever the request says.
      const redirectUris = Array.isArray(body.redirect_uris)
        ? body.redirect_uris
        : [];
      registeredClients.set(clientId, { redirect_uris: redirectUris });
      jsonResponse(res, 201, {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: body.grant_types ?? [
          "authorization_code",
          "refresh_token",
        ],
        response_types: body.response_types ?? ["code"],
      });
      return;
    }

    // Authorization endpoint -- auto-grants and redirects with code
    if (req.method === "GET" && url.pathname === "/authorize") {
      const clientId = url.searchParams.get("client_id");
      const redirectUri = url.searchParams.get("redirect_uri");
      const responseType = url.searchParams.get("response_type");
      const codeChallenge = url.searchParams.get("code_challenge");
      const codeChallengeMethod = url.searchParams.get("code_challenge_method");
      const scope = url.searchParams.get("scope") ?? "";
      const state = url.searchParams.get("state");

      if (!clientId || !registeredClients.has(clientId)) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          "<h1>Invalid client. The client_id provided does not match.</h1>",
        );
        return;
      }
      if (responseType !== "code") {
        res.writeHead(400).end("unsupported_response_type");
        return;
      }
      if (!codeChallenge || codeChallengeMethod !== "S256") {
        res.writeHead(400).end("PKCE S256 required");
        return;
      }
      if (!redirectUri) {
        res.writeHead(400).end("redirect_uri required");
        return;
      }
      // Enforce that the requested redirect_uri matches one of the
      // client's registered URIs. `redirect_uris: null` means the
      // static-client fixture path that accepts any URI. Per RFC 8252
      // §7.3, loopback URIs match by host+path with any port, so
      // native apps that pick an ephemeral callback port still work.
      const registered = registeredClients.get(clientId);
      const allowed = registered?.redirect_uris;
      if (
        Array.isArray(allowed) &&
        !matchesRegisteredRedirect(redirectUri, allowed)
      ) {
        res.writeHead(400).end("redirect_uri does not match registered URIs");
        return;
      }
      if (REQUIRED_SCOPE && !scope.split(" ").includes(REQUIRED_SCOPE)) {
        res.writeHead(400).end(`required scope missing: ${REQUIRED_SCOPE}`);
        return;
      }

      const code = makeOpaque(16);
      pendingCodes.set(code, {
        client_id: clientId,
        code_challenge: codeChallenge,
        redirect_uri: redirectUri,
        scope,
        expires_at: Date.now() + 60_000,
      });

      const dest = new URL(redirectUri);
      dest.searchParams.set("code", code);
      if (state) dest.searchParams.set("state", state);
      res.writeHead(302, { Location: dest.toString() });
      res.end();
      return;
    }

    // Token endpoint -- handles authorization_code + refresh_token grants
    if (req.method === "POST" && url.pathname === "/token") {
      const params = parseForm(await readBody(req));
      const grantType = params.grant_type;
      const clientId = params.client_id;
      const clientSecret = params.client_secret;

      if (!clientId || !registeredClients.has(clientId)) {
        jsonResponse(res, 401, {
          error: "invalid_client",
          error_description: "Client ID is required",
        });
        return;
      }
      const registered = registeredClients.get(clientId);
      // If we configured a static client_secret, require it on the token
      // request. (Tests for the "none" auth method run without this set.)
      if (
        registered.client_secret &&
        registered.client_secret !== clientSecret
      ) {
        jsonResponse(res, 401, {
          error: "invalid_client",
          error_description: "client_secret mismatch",
        });
        return;
      }

      if (grantType === "authorization_code") {
        const code = params.code;
        const codeVerifier = params.code_verifier;
        const pending = pendingCodes.get(code);
        if (!pending || pending.expires_at < Date.now()) {
          jsonResponse(res, 400, { error: "invalid_grant" });
          return;
        }
        if (pending.client_id !== clientId) {
          jsonResponse(res, 400, {
            error: "invalid_grant",
            error_description: "client mismatch",
          });
          return;
        }
        if (
          !codeVerifier ||
          !verifyPkce(codeVerifier, pending.code_challenge)
        ) {
          jsonResponse(res, 400, {
            error: "invalid_grant",
            error_description: "PKCE failure",
          });
          return;
        }
        pendingCodes.delete(code);

        const accessToken = makeOpaque(20);
        const refreshToken = makeOpaque(20);
        issuedTokens.set(accessToken, {
          client_id: clientId,
          expires_at: Date.now() + TOKEN_TTL_SEC * 1000,
          scope: pending.scope,
        });
        refreshTokens.set(refreshToken, {
          client_id: clientId,
          scope: pending.scope,
        });
        jsonResponse(res, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: TOKEN_TTL_SEC,
          refresh_token: refreshToken,
          scope: pending.scope,
        });
        return;
      }

      if (grantType === "refresh_token") {
        const refreshToken = params.refresh_token;
        const stored = refreshTokens.get(refreshToken);
        if (!stored || stored.client_id !== clientId) {
          jsonResponse(res, 400, { error: "invalid_grant" });
          return;
        }
        // Rotate: old refresh dies, new one issued.
        refreshTokens.delete(refreshToken);
        const newAccess = makeOpaque(20);
        const newRefresh = makeOpaque(20);
        issuedTokens.set(newAccess, {
          client_id: clientId,
          expires_at: Date.now() + TOKEN_TTL_SEC * 1000,
          scope: stored.scope,
        });
        refreshTokens.set(newRefresh, {
          client_id: clientId,
          scope: stored.scope,
        });
        jsonResponse(res, 200, {
          access_token: newAccess,
          token_type: "Bearer",
          expires_in: TOKEN_TTL_SEC,
          refresh_token: newRefresh,
          scope: stored.scope,
        });
        return;
      }

      jsonResponse(res, 400, { error: "unsupported_grant_type" });
      return;
    }

    // MCP endpoint -- requires a valid bearer token
    if (url.pathname === "/mcp") {
      const auth = req.headers.authorization ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(auth);
      const token = match?.[1];
      const tokenInfo = token ? issuedTokens.get(token) : null;
      if (!tokenInfo || tokenInfo.expires_at < Date.now()) {
        // RFC 6750 + RFC 9728 challenge so the SDK can discover the AS.
        res.writeHead(401, {
          "WWW-Authenticate": `Bearer realm="${BASE}", resource_metadata="${BASE}/.well-known/oauth-protected-resource"`,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      await requestContext.run({ clientId: tokenInfo.client_id }, async () => {
        await transport.handleRequest(req, res);
      });
      return;
    }

    res.writeHead(404).end("Not Found");
  } catch (err) {
    console.error("Fake OAuth MCP server error:", err);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: "internal_error", message: String(err) });
    }
  }
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`Fake OAuth MCP server listening on ${BASE}`);
  console.log(
    `  DCR: ${DCR_ENABLED ? "enabled" : "disabled (static client_id only)"}`,
  );
  if (STATIC_CLIENT_ID) {
    console.log(`  static client_id: ${STATIC_CLIENT_ID}`);
    console.log(
      `  static client_secret: ${STATIC_CLIENT_SECRET ? "set" : "(none)"}`,
    );
  }
  if (REQUIRED_SCOPE) console.log(`  required scope: ${REQUIRED_SCOPE}`);
  console.log(`  MCP endpoint: ${BASE}/mcp`);
});

process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
