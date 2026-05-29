import { shell, safeStorage } from "electron";
import log from "electron-log";
import { eq } from "drizzle-orm";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { DEFAULT_OAUTH_CALLBACK_PORT } from "../types/mcp";

const logger = log.scope("mcp_oauth_provider");

// Stored shape of `oauth_state` (after decryption). Both fields are
// optional because the SDK fills them at different points in the flow.
interface StoredOAuthState {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
}

// PKCE code verifiers live on the provider instance so a superseded
// Connect's late `saveCodeVerifier` can't overwrite a fresh retry's
// verifier (a shared per-server map had that race).

// application/x-www-form-urlencoded per RFC 6749 §B / WHATWG URL.
// Differs from `encodeURIComponent`: ! ' ( ) * are percent-encoded
// and spaces become `+` rather than `%20`. Required for the Basic
// auth header per RFC 6749 §2.3.1.
function formUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%20/g, "+");
}

// Tags plaintext-fallback blobs so they stay readable if the OS
// keyring becomes available later.
const PLAINTEXT_PREFIX = "plain:";

export function encryptToString(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // No keyring (e.g. Linux without libsecret): store plaintext
    // rather than blocking OAuth on those hosts.
    logger.warn(
      "safeStorage encryption unavailable; OAuth state written as plaintext",
    );
    return PLAINTEXT_PREFIX + Buffer.from(plaintext, "utf8").toString("base64");
  }
  return safeStorage.encryptString(plaintext).toString("base64");
}

export function decryptFromString(stored: string): string {
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return Buffer.from(
      stored.slice(PLAINTEXT_PREFIX.length),
      "base64",
    ).toString("utf8");
  }
  const buf = Buffer.from(stored, "base64");
  if (!safeStorage.isEncryptionAvailable()) {
    // Untagged blob without a keyring: best-effort UTF-8. Garbage
    // bytes fall through JSON.parse upstream as empty state.
    return buf.toString("utf8");
  }
  try {
    return safeStorage.decryptString(buf);
  } catch (err) {
    // Either untagged plaintext from a no-keyring write
    // (recoverable) or undecryptable ciphertext (yields garbage that
    // JSON.parse upstream drops as empty state). Return bytes either
    // way and let the caller decide.
    logger.warn(
      "safeStorage.decryptString rejected OAuth state; treating as plaintext",
      err,
    );
    return buf.toString("utf8");
  }
}

// True only if the stored OAuth state has an access token. A
// non-empty `oauth_state` isn't enough -- it can hold just a
// registered client ID with no tokens yet. Drives the
// "OAuth: connected" badge.
export function oauthStateHasTokens(stored: string | null): boolean {
  if (!stored) return false;
  const json = decryptFromString(stored);
  if (!json) return false;
  try {
    const parsed = JSON.parse(json) as StoredOAuthState;
    return Boolean(parsed.tokens?.access_token);
  } catch {
    return false;
  }
}

async function readState(serverId: number): Promise<StoredOAuthState> {
  const rows = await db
    .select({ oauthState: mcpServers.oauthState })
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId));
  const raw = rows[0]?.oauthState;
  if (!raw) return {};
  const json = decryptFromString(raw);
  if (!json) return {};
  try {
    return JSON.parse(json) as StoredOAuthState;
  } catch {
    return {};
  }
}

async function writeState(
  serverId: number,
  state: StoredOAuthState,
): Promise<void> {
  // No tokens and no client info: store NULL instead of an encrypted
  // empty object, so the column clearly means "nothing stored".
  const isEmpty = !state.tokens && !state.clientInformation;
  const blob = isEmpty ? null : encryptToString(JSON.stringify(state));
  await db
    .update(mcpServers)
    .set({ oauthState: blob })
    .where(eq(mcpServers.id, serverId));
}

// Per-server queue so concurrent read-modify-write callers on the same
// `oauth_state` row don't trample each other's writes. Single-process
// Electron app means an in-memory chain is enough; SQLite doesn't give
// us row-level locking.
const stateLocks = new Map<number, Promise<unknown>>();

async function withStateLock<T>(
  serverId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = stateLocks.get(serverId) ?? Promise.resolve();
  // Catch so a rejected previous task doesn't block the queue.
  const next = prev.catch(() => undefined).then(fn);
  stateLocks.set(
    serverId,
    next.catch(() => undefined),
  );
  return next;
}

interface ProviderConfig {
  serverId: number;
  callbackPort?: number;
  scope?: string;
  // Client ID the user registered by hand, for servers that don't
  // support automatic registration. When set, the SDK skips its
  // `/register` call.
  preregisteredClientId?: string;
  // Pre-registered client_secret for confidential OAuth clients. Only
  // meaningful alongside `preregisteredClientId`.
  preregisteredClientSecret?: string;
  // Random anti-CSRF value put in the authorize URL and checked when
  // the browser redirects back. When unset, `state()` returns "" and
  // the SDK leaves `state=` off the URL.
  flowState?: string;
  // True only for the Connect-button flow, which also starts the
  // callback listener. Other providers pass false: they throw instead
  // of opening a browser, since no listener is running to catch the
  // redirect.
  allowInteractive?: boolean;
}

export class DyadOAuthClientProvider implements OAuthClientProvider {
  private readonly serverId: number;
  private readonly callbackPort: number;
  private readonly scope: string | undefined;
  private readonly preregisteredClientId: string | undefined;
  private readonly preregisteredClientSecret: string | undefined;
  private readonly flowState: string | undefined;
  private readonly allowInteractive: boolean;
  // Client info kept in memory. The SDK calls `addClientAuthentication`
  // without awaiting it, so that method can't do an async DB read --
  // it uses this instead. Set by `clientInformation()` and
  // `saveClientInformation()`.
  private cachedClientInformation: OAuthClientInformation | undefined;
  // PKCE verifier for this flow only. Per-instance so a superseded
  // flow's late save can't clobber the active flow.
  private codeVerifierBuf: string | undefined;
  // Flipped to true when the OAuth flow that owns this provider has
  // been superseded by another Connect. Persistent writes
  // (`saveTokens`, `saveClientInformation`, seed-on-first-read,
  // `invalidateCredentials`) become no-ops so a late SDK call from a
  // stale flow can't overwrite the active flow's row.
  private aborted = false;

  constructor(config: ProviderConfig) {
    this.serverId = config.serverId;
    this.callbackPort = config.callbackPort ?? DEFAULT_OAUTH_CALLBACK_PORT;
    this.scope = config.scope;
    this.preregisteredClientId = config.preregisteredClientId;
    this.preregisteredClientSecret = config.preregisteredClientSecret;
    this.flowState = config.flowState;
    this.allowInteractive = config.allowInteractive ?? false;
  }

  // Marks this provider's flow as superseded. After this returns, the
  // persistent writes below short-circuit so a stale SDK callback
  // can't clobber the row.
  abort(): void {
    this.aborted = true;
  }

  // The SDK reads this when building the authorize URL. Returns ""
  // when no state is set, so the SDK leaves `state=` off.
  state(): string {
    return this.flowState ?? "";
  }

  get redirectUrl(): string {
    return `http://localhost:${this.callbackPort}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    // Match `addClientAuthentication` below: Basic for confidential
    // clients, `none` for public (plain PKCE).
    const tokenEndpointAuthMethod = this.preregisteredClientSecret
      ? "client_secret_basic"
      : "none";
    return {
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      client_name: "Dyad",
      scope: this.scope,
    };
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const state = await readState(this.serverId);
    return state.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (this.aborted) return;
    await withStateLock(this.serverId, async () => {
      if (this.aborted) return;
      const state = await readState(this.serverId);
      // Servers that don't rotate refresh tokens omit `refresh_token`
      // from the response; carry the previous one forward so the SDK
      // can still silently refresh later.
      const next: OAuthTokens = { ...tokens };
      if (!next.refresh_token && state.tokens?.refresh_token) {
        next.refresh_token = state.tokens.refresh_token;
      }
      state.tokens = next;
      await writeState(this.serverId, state);
    });
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return withStateLock(this.serverId, async () => {
      const state = await readState(this.serverId);
      if (state.clientInformation) {
        this.cachedClientInformation = state.clientInformation;
        return state.clientInformation;
      }
      // If the user gave us a client ID, return it on first read so the
      // SDK skips its `/register` call. Saved too, so later reads just
      // load it from storage.
      if (this.preregisteredClientId) {
        const seeded: OAuthClientInformation = {
          client_id: this.preregisteredClientId,
          ...(this.preregisteredClientSecret
            ? { client_secret: this.preregisteredClientSecret }
            : {}),
        };
        // Skip the seed write if this flow has been superseded; a
        // fresh flow will reseed on its own first read.
        if (!this.aborted) {
          await writeState(this.serverId, {
            ...state,
            clientInformation: seeded,
          });
        }
        this.cachedClientInformation = seeded;
        return seeded;
      }
      this.cachedClientInformation = undefined;
      return undefined;
    });
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    // Update the in-memory copy before the DB write -- the SDK may
    // call `addClientAuthentication` (which reads it) before this
    // returns.
    this.cachedClientInformation = clientInformation;
    // Skip DB write for non-interactive so a background DCR /register
    // can't overwrite an in-flight Connect's client_id between
    // /authorize and /token.
    if (!this.allowInteractive) return;
    if (this.aborted) return;
    await withStateLock(this.serverId, async () => {
      if (this.aborted) return;
      const state = await readState(this.serverId);
      state.clientInformation = clientInformation;
      await writeState(this.serverId, state);
    });
  }

  async codeVerifier(): Promise<string> {
    if (!this.codeVerifierBuf) {
      throw new Error(
        `No PKCE code verifier in memory for MCP server ${this.serverId}; the OAuth flow must be restarted.`,
      );
    }
    return this.codeVerifierBuf;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    // Non-interactive providers don't drive PKCE.
    if (!this.allowInteractive) return;
    this.codeVerifierBuf = codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Only the Connect-button flow opens a browser. Other providers
    // throw here -- no callback listener is running, so a redirect
    // would have nowhere to land. See `allowInteractive`.
    if (!this.allowInteractive) {
      throw new Error(
        "OAuth not currently allowed (interactive consent required; click Connect on the server row).",
      );
    }
    // Refuse non-http(s) schemes so a malicious or misconfigured server
    // can't trick us into handing arbitrary URIs (file:, javascript:,
    // custom protocol handlers) to `shell.openExternal`. http: is
    // allowed only for loopback so local test fixtures still work.
    // WHATWG URL keeps IPv6 literals bracketed in `.hostname`
    // (`http://[::1]/` -> `"[::1]"`), so both forms are checked --
    // some upstream code paths and tests still pass the bare `::1`.
    const isLoopback =
      authorizationUrl.hostname === "localhost" ||
      authorizationUrl.hostname === "127.0.0.1" ||
      authorizationUrl.hostname === "[::1]" ||
      authorizationUrl.hostname === "::1";
    if (
      authorizationUrl.protocol !== "https:" &&
      !(authorizationUrl.protocol === "http:" && isLoopback)
    ) {
      throw new Error(
        `Refusing to open OAuth authorize URL with protocol "${authorizationUrl.protocol}" (only https, or http on localhost).`,
      );
    }
    logger.info(
      `Opening browser for OAuth: ${authorizationUrl.origin}${authorizationUrl.pathname}`,
    );
    await shell.openExternal(authorizationUrl.toString());
  }

  // Arrow field so `this` still works when the SDK calls it as a
  // loose function. Stays synchronous: the SDK doesn't await it, so it
  // reads `cachedClientInformation` instead of doing an async DB read.
  addClientAuthentication = (
    headers: Headers,
    params: URLSearchParams,
  ): void => {
    const info = this.cachedClientInformation;
    if (!info) {
      logger.warn(
        `addClientAuthentication invoked without cached clientInformation for MCP server ${this.serverId}; token exchange will fail.`,
      );
      return;
    }
    const method = (
      info as OAuthClientInformation & { token_endpoint_auth_method?: string }
    ).token_endpoint_auth_method;
    const hasSecret = Boolean(info.client_secret);
    // RFC 6749 §2.3.1 makes Basic REQUIRED and Post OPTIONAL for
    // confidential clients, so default to Basic when the server hasn't
    // told us which method to use (typical for pre-registered clients).
    // DCR-registered clients get an explicit `token_endpoint_auth_method`
    // back from the server and take the branch above.
    const chosen = method ?? (hasSecret ? "client_secret_basic" : "none");

    if (chosen === "client_secret_basic" && info.client_secret) {
      // RFC 6749 §2.3.1: each credential is form-urlencoded (spaces as
      // `+`, RFC 3986 reserved chars percent-encoded) before the ":"
      // join and the final base64 wrap, so a `:` or `@` in the id or
      // secret can't break out of the Basic header format.
      const credentials = Buffer.from(
        `${formUrlEncode(info.client_id)}:${formUrlEncode(info.client_secret)}`,
      ).toString("base64");
      headers.set("Authorization", `Basic ${credentials}`);
      return;
    }

    if (chosen === "client_secret_post") {
      params.set("client_id", info.client_id);
      if (info.client_secret) params.set("client_secret", info.client_secret);
      return;
    }

    params.set("client_id", info.client_id);
  };

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    logger.debug(
      `invalidateCredentials(${scope}) for MCP server ${this.serverId}`,
    );
    // The SDK only ever calls with "all" or "tokens"; warn (rather
    // than silently no-op) if that ever changes so we notice.
    if (scope !== "all" && scope !== "tokens") {
      logger.warn(
        `invalidateCredentials(${scope}) is unhandled; SDK only calls 'all'/'tokens'`,
      );
      return;
    }
    // Skip for non-interactive so a background 401 path can't nuke
    // tokens or client info out from under an active session.
    if (!this.allowInteractive) return;
    if (this.aborted) return;
    await withStateLock(this.serverId, async () => {
      if (this.aborted) return;
      const state = await readState(this.serverId);
      delete state.tokens;
      if (scope === "all") {
        this.codeVerifierBuf = undefined;
        delete state.clientInformation;
        this.cachedClientInformation = undefined;
      }
      await writeState(this.serverId, state);
    });
  }
}

// Kept for backwards compatibility with existing tests; the verifier
// now lives on each provider instance, so resetting at module scope
// is a no-op.
export function _resetCodeVerifiersForTest(): void {}
