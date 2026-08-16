import crypto from "node:crypto";
import http from "node:http";
import { shell } from "electron";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { X_OAUTH_REDIRECT_URI, X_OAUTH_SCOPES } from "@/lib/xOAuth";

export { X_OAUTH_REDIRECT_URI, X_OAUTH_SCOPES } from "@/lib/xOAuth";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const CALLBACK_TIMEOUT_MS = 180_000;

export interface XOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function callbackPage(message: string, success: boolean): string {
  const color = success ? "#22c55e" : "#ef4444";
  return `<!doctype html><meta charset="utf-8"><title>X authorization</title><body style="margin:0;background:#080b12;color:#f8fafc;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;padding:32px;border:1px solid #273244;border-radius:20px;background:#111827;text-align:center"><div style="font-size:36px;color:${color}">${success ? "\u2713" : "!"}</div><h1>${success ? "X connected" : "Could not connect X"}</h1><p style="color:#94a3b8;line-height:1.6">${message}</p></main></body>`;
}

function tokenAuthorization(clientId: string, clientSecret?: string) {
  return clientSecret
    ? `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    : undefined;
}

async function readTokenError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    return json.error_description ?? json.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function exchangeToken(
  clientId: string,
  clientSecret: string | undefined,
  body: URLSearchParams,
): Promise<XOAuthTokens> {
  const authorization = tokenAuthorization(clientId, clientSecret);
  if (!authorization) body.set("client_id", clientId);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body,
  });
  if (!response.ok) {
    throw new DyadError(
      `X could not issue a user access token: ${await readTokenError(response)}`,
      DyadErrorKind.Auth,
    );
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new DyadError(
      "X did not return a user access token.",
      DyadErrorKind.Auth,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in
      ? Date.now() + json.expires_in * 1000
      : undefined,
    scopes: json.scope?.split(/\s+/).filter(Boolean) ?? [],
  };
}

export async function authorizeXUser(
  clientId: string,
  clientSecret?: string,
): Promise<XOAuthTokens> {
  const state = base64Url(crypto.randomBytes(24));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  const redirect = new URL(X_OAUTH_REDIRECT_URI);

  let settle: ((value: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const codePromise = new Promise<string>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let finished = false;
  const server = http.createServer((request, response) => {
    const callback = new URL(request.url ?? "/", X_OAUTH_REDIRECT_URI);
    if (callback.pathname !== redirect.pathname) {
      response.writeHead(404).end("Not found");
      return;
    }
    const error = callback.searchParams.get("error");
    const code = callback.searchParams.get("code");
    const returnedState = callback.searchParams.get("state");
    if (error) {
      response
        .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        .end(callbackPage("Authorization was cancelled or denied.", false));
      fail?.(
        new DyadError(`X authorization failed: ${error}`, DyadErrorKind.Auth),
      );
    } else if (!code || returnedState !== state) {
      response
        .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        .end(callbackPage("The authorization response was invalid.", false));
      fail?.(
        new DyadError(
          "X returned an invalid OAuth response.",
          DyadErrorKind.Auth,
        ),
      );
    } else {
      response
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          callbackPage(
            "You can close this window and return to Meta Human OS.",
            true,
          ),
        );
      settle?.(code);
    }
    finished = true;
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(redirect.port), redirect.hostname, resolve);
  }).catch((error) => {
    throw new DyadError(
      `Could not start the X sign-in callback on port ${redirect.port}: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.Precondition,
    );
  });

  const timeout = setTimeout(() => {
    if (!finished) {
      fail?.(
        new DyadError(
          "X authorization timed out. Start the connection again.",
          DyadErrorKind.UserCancelled,
        ),
      );
    }
  }, CALLBACK_TIMEOUT_MS);

  try {
    const authorizationUrl = new URL(AUTHORIZE_URL);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", X_OAUTH_REDIRECT_URI);
    authorizationUrl.searchParams.set("scope", X_OAUTH_SCOPES.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    await shell.openExternal(authorizationUrl.toString());
    const code = await codePromise;
    return exchangeToken(
      clientId,
      clientSecret,
      new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: X_OAUTH_REDIRECT_URI,
        code_verifier: verifier,
      }),
    );
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

export async function refreshXUserToken(
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string,
): Promise<XOAuthTokens> {
  return exchangeToken(
    clientId,
    clientSecret,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}
