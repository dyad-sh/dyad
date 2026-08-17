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

import { CANVA_OAUTH_REDIRECT_URL } from "@/lib/canvaMcp";
import { decrypt, encrypt } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";

const logger = log.scope("canva_mcp_oauth");
const CANVA_OAUTH_FILE = "canva-mcp-oauth.json";
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";

type EncryptedValue = ReturnType<typeof encrypt>;

interface StoredCanvaOAuthCredentials {
  clientInformation?: EncryptedValue;
  tokens?: EncryptedValue;
}

function credentialsPath() {
  return path.join(getUserDataPath(), CANVA_OAUTH_FILE);
}

function readStoredCredentials(): StoredCanvaOAuthCredentials {
  try {
    const filePath = credentialsPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as StoredCanvaOAuthCredentials;
  } catch (error) {
    logger.warn("Could not read Canva OAuth credentials", error);
    return {};
  }
}

function writeStoredCredentials(value: StoredCanvaOAuthCredentials) {
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
    logger.warn("Could not decrypt Canva OAuth credentials", error);
    return undefined;
  }
}

function saveEncryptedJson(
  key: keyof StoredCanvaOAuthCredentials,
  value: unknown,
) {
  writeStoredCredentials({
    ...readStoredCredentials(),
    [key]: encrypt(JSON.stringify(value)),
  });
}

export function hasCanvaOAuthTokens() {
  return Boolean(
    parseEncryptedJson<OAuthTokens>(readStoredCredentials().tokens)
      ?.access_token,
  );
}

export function clearCanvaOAuthCredentials() {
  const filePath = credentialsPath();
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function getCanvaOAuthClientMetadata(
  redirectUrl = CANVA_OAUTH_REDIRECT_URL,
): OAuthClientMetadata {
  return {
    client_name: "Meta Human OS for Canva",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

/**
 * Canva recommends CIMD for approved production clients and retains dynamic
 * client registration for compatibility. This provider supports DCR today;
 * the saved client registration can later be replaced with the approved CIMD
 * identity without changing the renderer or MCP tool path.
 */
export class CanvaOAuthClientProvider implements OAuthClientProvider {
  private verifier?: string;
  private oauthRedirectUrl = CANVA_OAUTH_REDIRECT_URL;

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
    return getCanvaOAuthClientMetadata(this.oauthRedirectUrl);
  }

  state() {
    return this.oauthState;
  }

  get expectedState() {
    return this.oauthState;
  }

  clientInformation(): OAuthClientInformation | undefined {
    return parseEncryptedJson<OAuthClientInformationFull>(
      readStoredCredentials().clientInformation,
    );
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
    await this.onAuthorization?.(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.verifier) {
      throw new Error("Canva OAuth code verifier is unavailable");
    }
    return this.verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "verifier") {
      this.verifier = undefined;
      return;
    }
    if (scope === "all") {
      clearCanvaOAuthCredentials();
      this.verifier = undefined;
      return;
    }
    const stored = readStoredCredentials();
    delete stored[scope === "client" ? "clientInformation" : "tokens"];
    writeStoredCredentials(stored);
  }
}

export interface CanvaOAuthCallbackListener {
  redirectUrl: string;
  waitForCode: Promise<string>;
  close: () => Promise<void>;
}

export async function listenForCanvaOAuthCallback(
  expectedState: string,
  timeoutMs = 180_000,
): Promise<CanvaOAuthCallbackListener> {
  let settle: ((code: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  let settled = false;
  const waitForCode = new Promise<string>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
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

  const server = http.createServer((request, response) => {
    const callbackUrl = new URL(request.url ?? "/", `http://${CALLBACK_HOST}`);
    if (callbackUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end("Not found");
      return;
    }
    const error = callbackUrl.searchParams.get("error");
    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    if (error) {
      response
        .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        .end(callbackPage("Canva authorization was cancelled.", false));
      failOnce(new Error(`Canva authorization failed: ${error}`));
      return;
    }
    if (!code || state !== expectedState) {
      response
        .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        .end(callbackPage("The authorization response was invalid.", false));
      failOnce(new Error("Canva returned an invalid OAuth response"));
      return;
    }
    response
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        callbackPage(
          "Canva is connected. You can close this window and return to Meta Human OS.",
          true,
        ),
      );
    settleOnce(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CALLBACK_HOST, () => resolve());
  }).catch((error) => {
    throw new Error(
      `Could not start the Canva sign-in callback: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine the Canva sign-in callback port.");
  }
  const redirectUrl = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;
  const timer = setTimeout(() => {
    failOnce(new Error("Canva authorization timed out"));
    server.close();
  }, timeoutMs);
  timer.unref();

  return {
    redirectUrl,
    waitForCode,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timer);
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
  <head><meta charset="utf-8"><title>Meta Human OS · Canva</title></head>
  <body style="background:#07111f;color:#d8f7ff;font-family:system-ui;padding:48px">
    <main style="max-width:560px;margin:auto">
      <h1>${success ? "Connected" : "Authorization failed"}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}
