import { app, safeStorage, shell } from "electron";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// Public native-client registration used by Codex/OpenCode; not a client secret.
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const REDIRECT = "http://localhost:1455/auth/callback";
const Credentials = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  accountId: z.string().min(1),
  expires: z.number(),
});
type Credentials = z.infer<typeof Credentials>;
const Tokens = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().positive().optional(),
});
let generation = 0;
let server: Server | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let lastError: string | undefined;
let refreshing: Promise<Credentials> | undefined;

function credentialPath() {
  return path.join(app.getPath("userData"), "codex-subscription.enc");
}
function requireEncryption() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new DyadError(
      "Secure credential storage is unavailable. Configure an OS keyring before connecting ChatGPT.",
      DyadErrorKind.Precondition,
    );
  }
}
function load(): Credentials | undefined {
  if (!fs.existsSync(credentialPath())) return undefined;
  requireEncryption();
  try {
    return Credentials.parse(
      JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialPath()))),
    );
  } catch {
    throw new DyadError(
      "Reconnect your ChatGPT subscription; its saved credentials could not be opened.",
      DyadErrorKind.Auth,
    );
  }
}
function save(credentials: Credentials) {
  requireEncryption();
  const target = credentialPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    `${target}.tmp`,
    safeStorage.encryptString(JSON.stringify(credentials)),
    { mode: 0o600 },
  );
  fs.renameSync(`${target}.tmp`, target);
}
function stopLogin() {
  clearTimeout(timer);
  timer = undefined;
  server?.close();
  server = undefined;
  pending = false;
}
export function getCodexSubscriptionStatus() {
  try {
    return { connected: Boolean(load()), pending, error: lastError };
  } catch {
    return {
      connected: false,
      pending,
      error:
        "Saved ChatGPT credentials could not be opened. Restore your OS keyring or reconnect.",
    };
  }
}
export function disconnectCodexSubscription() {
  generation++;
  stopLogin();
  refreshing = undefined;
  lastError = undefined;
  fs.rmSync(credentialPath(), { force: true });
}
export function validateOAuthState(expected: string, actual: string | null) {
  return (
    actual !== null &&
    Buffer.byteLength(expected) === Buffer.byteLength(actual) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  );
}
async function exchange(
  params: Record<string, string>,
  previousAccountId?: string,
): Promise<Credentials> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: CLIENT_ID }),
  });
  if (!response.ok)
    throw new DyadError(
      "ChatGPT authentication failed. Reconnect your subscription.",
      DyadErrorKind.Auth,
    );
  try {
    const tokens = Tokens.parse(await response.json());
    // Claims are only used to route an already-issued token, not to authorize IPC.
    const claims = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url").toString(),
    );
    return Credentials.parse({
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      accountId:
        claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
        previousAccountId,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    });
  } catch {
    throw new DyadError(
      "ChatGPT returned an invalid authentication response. Reconnect your subscription.",
      DyadErrorKind.Auth,
    );
  }
}
export async function getCodexSubscriptionCredentials(): Promise<Credentials> {
  const stored = load();
  if (!stored)
    throw new DyadError(
      "Connect your ChatGPT subscription in the model picker.",
      DyadErrorKind.Auth,
    );
  if (stored.expires > Date.now() + 60_000) return stored;
  if (!refreshing) {
    const current = generation;
    refreshing = exchange(
      { grant_type: "refresh_token", refresh_token: stored.refresh },
      stored.accountId,
    )
      .then((credentials) => {
        if (generation !== current)
          throw new DyadError(
            "ChatGPT connection changed. Try again.",
            DyadErrorKind.Auth,
          );
        save(credentials);
        return credentials;
      })
      .finally(() => {
        if (generation === current) refreshing = undefined;
      });
  }
  return refreshing;
}
export async function connectCodexSubscription() {
  requireEncryption();
  if (pending) return;
  const current = ++generation;
  refreshing = undefined;
  lastError = undefined;
  pending = true;
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (
      req.method !== "GET" ||
      url.pathname !== "/auth/callback" ||
      !validateOAuthState(state, url.searchParams.get("state"))
    ) {
      res.writeHead(400);
      res.end("Invalid sign-in callback.");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) {
      lastError = "Sign-in was not completed. Try connecting again.";
      res.end(lastError);
      stopLogin();
      return;
    }
    // Consume the callback once; shutdown also prevents duplicate exchanges.
    stopLogin();
    pending = true;
    void exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    })
      .then((credentials) => {
        if (generation !== current) {
          res.end("Sign-in cancelled.");
          return;
        }
        save(credentials);
        res.end("ChatGPT connected. Return to Dyad.");
      })
      .catch(() => {
        if (generation === current)
          lastError = "ChatGPT sign-in failed. Please try again.";
        res.end("ChatGPT sign-in failed. Return to Dyad and try again.");
      })
      .finally(() => {
        if (generation === current) pending = false;
      });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(1455, "127.0.0.1", resolve);
    });
    timer = setTimeout(() => {
      if (generation === current) {
        lastError = "Sign-in timed out. Try again.";
        generation++;
        stopLogin();
      }
    }, 5 * 60_000);
    timer.unref();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "openid profile email offline_access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "dyad",
    });
    await shell.openExternal(`${ISSUER}/oauth/authorize?${params}`);
  } catch {
    stopLogin();
    throw new DyadError(
      "Unable to start ChatGPT sign-in. Close other sign-in windows using port 1455 and try again.",
      DyadErrorKind.Precondition,
    );
  }
}
