import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import log from "electron-log";

import { decrypt, encrypt } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import {
  LOVABLE_OAUTH_CUSTOM_REDIRECT_URL,
  LOVABLE_OAUTH_PUBLIC_CLIENT_ID,
  LOVABLE_OAUTH_REDIRECT_URL,
  LOVABLE_OAUTH_SCOPE,
} from "@/lib/lovableMcp";

export {
  LOVABLE_OAUTH_CUSTOM_REDIRECT_URL,
  LOVABLE_OAUTH_REDIRECT_URL,
  LOVABLE_OAUTH_SCOPE,
} from "@/lib/lovableMcp";

const logger = log.scope("lovable_mcp_oauth");
const LOVABLE_OAUTH_FILE = "lovable-mcp-oauth.json";
const LOVABLE_CALLBACK_HOST = "127.0.0.1";
const LOVABLE_CALLBACK_PATH = "/callback";

type EncryptedValue = ReturnType<typeof encrypt>;

interface StoredLovableOAuthCredentials {
  clientInformation?: EncryptedValue;
  tokens?: EncryptedValue;
}

function credentialsPath() {
  return path.join(getUserDataPath(), LOVABLE_OAUTH_FILE);
}

function readStoredCredentials(): StoredLovableOAuthCredentials {
  try {
    const filePath = credentialsPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as StoredLovableOAuthCredentials;
  } catch (error) {
    logger.warn("Could not read Lovable OAuth credentials", error);
    return {};
  }
}

function writeStoredCredentials(value: StoredLovableOAuthCredentials) {
  const filePath = credentialsPath();
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function parseEncryptedJson<T>(
  value: EncryptedValue | undefined,
): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(decrypt(value)) as T;
  } catch (error) {
    logger.warn("Could not decrypt Lovable OAuth credentials", error);
    return undefined;
  }
}

function saveEncryptedJson(
  key: keyof StoredLovableOAuthCredentials,
  value: unknown,
) {
  writeStoredCredentials({
    ...readStoredCredentials(),
    [key]: encrypt(JSON.stringify(value)),
  });
}

export function hasLovableOAuthTokens() {
  return Boolean(
    parseEncryptedJson<OAuthTokens>(readStoredCredentials().tokens)
      ?.access_token,
  );
}

export function clearLovableOAuthCredentials() {
  const filePath = credentialsPath();
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function getLovableOAuthClientMetadata(): OAuthClientMetadata {
  return {
    client_name: "Meta Human OS",
    redirect_uris: [
      LOVABLE_OAUTH_REDIRECT_URL,
      LOVABLE_OAUTH_CUSTOM_REDIRECT_URL,
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: LOVABLE_OAUTH_SCOPE,
  };
}

export class LovableOAuthClientProvider implements OAuthClientProvider {
  private verifier?: string;
  private oauthRedirectUrl = LOVABLE_OAUTH_REDIRECT_URL;

  constructor(
    private readonly oauthState = crypto.randomBytes(24).toString("hex"),
    private readonly onAuthorization?: (url: URL) => void | Promise<void>,
  ) {}

  get redirectUrl() {
    return this.oauthRedirectUrl;
  }

  setRedirectUrl(redirectUrl: string) {
    this.oauthRedirectUrl = redirectUrl;
  }

  get clientMetadata() {
    return getLovableOAuthClientMetadata();
  }

  state() {
    return this.oauthState;
  }

  get expectedState() {
    return this.oauthState;
  }

  clientInformation(): OAuthClientInformation | undefined {
    const stored = parseEncryptedJson<OAuthClientInformationFull>(
      readStoredCredentials().clientInformation,
    );
    return stored?.client_id === LOVABLE_OAUTH_PUBLIC_CLIENT_ID
      ? stored
      : { client_id: LOVABLE_OAUTH_PUBLIC_CLIENT_ID };
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull) {
    saveEncryptedJson("clientInformation", clientInformation);
  }

  tokens(): OAuthTokens | undefined {
    return parseEncryptedJson<OAuthTokens>(readStoredCredentials().tokens);
  }

  saveTokens(tokens: OAuthTokens) {
    saveEncryptedJson("tokens", tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    // The SDK derives this from clientMetadata.scope. Set it again at the
    // browser boundary so a future SDK change cannot silently drop permissions.
    authorizationUrl.searchParams.set("scope", LOVABLE_OAUTH_SCOPE);
    await this.onAuthorization?.(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.verifier) {
      throw new Error("Lovable OAuth code verifier is unavailable");
    }
    return this.verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "verifier") {
      this.verifier = undefined;
      return;
    }

    if (scope === "all") {
      clearLovableOAuthCredentials();
      this.verifier = undefined;
      return;
    }

    const stored = readStoredCredentials();
    delete stored[scope === "client" ? "clientInformation" : "tokens"];
    writeStoredCredentials(stored);
  }
}

export interface LovableOAuthCallbackListener {
  redirectUrl: string;
  waitForCode: Promise<string>;
  close: () => Promise<void>;
}

interface PendingLovableProtocolCallback {
  expectedState: string;
  settle: (code: string) => void;
  fail: (error: Error) => void;
}

let pendingProtocolCallback: PendingLovableProtocolCallback | undefined;

export function handleLovableOAuthProtocolCallback(url: string) {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(url);
  } catch {
    return false;
  }
  if (
    callbackUrl.protocol !== "metahumanos:" ||
    callbackUrl.hostname !== "oauth" ||
    callbackUrl.pathname !== "/callback"
  ) {
    return false;
  }

  const pending = pendingProtocolCallback;
  if (!pending) return true;
  const error = callbackUrl.searchParams.get("error");
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  if (error) {
    pending.fail(new Error(`Lovable authorization failed: ${error}`));
  } else if (!code || state !== pending.expectedState) {
    pending.fail(new Error("Lovable returned an invalid OAuth response"));
  } else {
    pending.settle(code);
  }
  return true;
}

export async function listenForLovableOAuthCallback(
  expectedState: string,
  timeoutMs = 180_000,
): Promise<LovableOAuthCallbackListener> {
  let settle: ((code: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const waitForCode = new Promise<string>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let settled = false;
  const settleOnce = (code: string) => {
    if (settled) return;
    settled = true;
    settle?.(code);
  };
  const failOnce = (error: Error) => {
    if (settled) return;
    settled = true;
    fail?.(error);
  };
  pendingProtocolCallback = {
    expectedState,
    settle: settleOnce,
    fail: failOnce,
  };

  const server = http.createServer((request, response) => {
    const callbackUrl = new URL(
      request.url ?? "/",
      `http://${LOVABLE_CALLBACK_HOST}`,
    );
    if (callbackUrl.pathname !== LOVABLE_CALLBACK_PATH) {
      response.writeHead(404).end("Not found");
      return;
    }

    const error = callbackUrl.searchParams.get("error");
    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    if (error) {
      response
        .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        .end(callbackPage("Lovable authorization was cancelled.", false));
      failOnce(new Error(`Lovable authorization failed: ${error}`));
      return;
    }
    if (!code || state !== expectedState) {
      response
        .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        .end(callbackPage("The authorization response was invalid.", false));
      failOnce(new Error("Lovable returned an invalid OAuth response"));
      return;
    }

    response
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        callbackPage(
          "Lovable is connected. You can close this window and return to Meta Human OS.",
          true,
        ),
      );
    settleOnce(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOVABLE_CALLBACK_HOST, () => resolve());
  }).catch((error) => {
    throw new Error(
      `Could not start the Lovable sign-in callback: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine the Lovable sign-in callback port.");
  }
  const redirectUrl = `http://${LOVABLE_CALLBACK_HOST}:${address.port}${LOVABLE_CALLBACK_PATH}`;

  const timer = setTimeout(() => {
    failOnce(new Error("Lovable authorization timed out"));
    server.close();
  }, timeoutMs);
  timer.unref();

  return {
    redirectUrl,
    waitForCode,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timer);
        if (pendingProtocolCallback?.expectedState === expectedState) {
          pendingProtocolCallback = undefined;
        }
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      }),
  };
}

function callbackPage(message: string, success: boolean) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Meta Human OS · Lovable</title></head>
  <body style="background:#07111f;color:#d8f7ff;font-family:system-ui;padding:48px">
    <main style="max-width:560px;margin:auto">
      <h1>${success ? "Connected" : "Authorization failed"}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}
