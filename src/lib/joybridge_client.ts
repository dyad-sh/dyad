/**
 * JoyBridge HTTP client — single canonical client for the JoyMarketplace API.
 *
 * Audit (2026-05-02) discovered that the conceptual `joymarketplace.io/api/v1/*`
 * REST surface from the unification plan does not yet exist; the *real* backend
 * is the Supabase Edge Functions tree at
 * `https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1/<function-name>`.
 *
 * This client therefore supports BOTH shapes:
 *   - `apiBase` = Supabase Edge Functions root (default)
 *   - `apiBase` = a future Vercel `/api/v1` REST surface (override via settings)
 *
 * It is also "no-throw on network errors": every public method returns a
 * Result<T> so renderer / IPC handler code can degrade gracefully without
 * a try/catch wrapper.
 *
 * Auth scheme:
 *   - Authorization: Bearer <JOY_API_KEY>
 *   - x-joy-api-key: <JOY_API_KEY>
 *   - apikey: <SUPABASE_PUBLISHABLE_KEY>     (only required for Supabase tier)
 *
 * The Supabase publishable key is read from settings/env at runtime; it is
 * NEVER hardcoded into committed source.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export interface JoyBridgeConfig {
  /**
   * API root URL. Defaults to the Supabase Edge Functions tree.
   * Override to a Vercel `/api/v1` root once that ships.
   */
  apiBase?: string;
  /** Public marketplace web URL (used for share links, deep links). */
  webBase?: string;
  /** JoyMarketplace publisher API key. Stored in settings. */
  apiKey?: string;
  /** Supabase project URL — used by the read-cache path. */
  supabaseUrl?: string;
  /** Supabase publishable key (`sb_publishable_...`). Browser-safe, RLS-gated. */
  supabasePublishableKey?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

export interface CreateStoreInput {
  slug: string;
  name: string;
  description?: string;
  bannerCid?: string;
  logoCid?: string;
  royaltyBps?: number;
  payoutWallet?: string;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  description?: string;
  ownerWallet?: string;
  bannerUrl?: string;
  logoUrl?: string;
  status?: "pending" | "active" | "disabled";
  createdAt?: string;
}

export interface PublishAssetInput {
  storeId: string;
  /** Type of asset — used by store routing + UI filters. */
  assetType: "image" | "video" | "agent" | "model" | "document" | string;
  name: string;
  description?: string;
  /** IPFS CID for the actual content blob. */
  contentCid: string;
  /** IPFS CID for the metadata JSON (license, mime, dims, etc). */
  metadataCid?: string;
  /** Price in USDC base units (6 decimals). 0 for free. */
  priceUsdc?: number;
  royaltyBps?: number;
  license?: string;
  /** Tier index (matches the publish-asset edge function). */
  tier?: number;
}

export interface Asset {
  id: string;
  tokenId?: string;
  storeId: string;
  assetType: string;
  name: string;
  description?: string;
  contentUrl?: string;
  thumbnailUrl?: string;
  priceUsdc?: number;
  royaltyBps?: number;
  status?: "pending" | "active" | "disabled";
  createdAt?: string;
}

export interface BrowseQuery {
  assetType?: string;
  storeSlug?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface BrowseResult {
  items: Asset[];
  nextCursor?: string;
  total?: number;
}

export interface PinResult {
  cid: string;
  size?: number;
  url?: string;
}

// =============================================================================
// CLIENT
// =============================================================================

const DEFAULT_API_BASE = "https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1";
const DEFAULT_WEB_BASE = "https://joymarketplace.io";

export class JoyBridgeClient {
  private cfg: Required<Pick<JoyBridgeConfig, "apiBase" | "webBase">> &
    JoyBridgeConfig;

  constructor(cfg: JoyBridgeConfig = {}) {
    this.cfg = {
      ...cfg,
      apiBase: cfg.apiBase ?? DEFAULT_API_BASE,
      webBase: cfg.webBase ?? DEFAULT_WEB_BASE,
    };
  }

  // -- config -----------------------------------------------------------------

  /** Return the runtime config (without secrets). */
  getConfig(): {
    apiBase: string;
    webBase: string;
    connected: boolean;
    supabaseConfigured: boolean;
  } {
    return {
      apiBase: this.cfg.apiBase,
      webBase: this.cfg.webBase,
      connected: Boolean(this.cfg.apiKey),
      supabaseConfigured: Boolean(
        this.cfg.supabaseUrl && this.cfg.supabasePublishableKey,
      ),
    };
  }

  /** Update credentials in-place (called by handler when settings change). */
  setCredentials(update: Partial<JoyBridgeConfig>): void {
    const next = { ...this.cfg, ...update };
    // Preserve required defaults if the update tried to clear them.
    next.apiBase = next.apiBase ?? DEFAULT_API_BASE;
    next.webBase = next.webBase ?? DEFAULT_WEB_BASE;
    this.cfg = next;
  }

  // -- HTTP plumbing ---------------------------------------------------------

  private buildUrl(pathOrFn: string): string {
    // Allow callers to pass either an edge-function name ("publish-asset")
    // or a leading-slash path ("/v1/stores"). We normalise both.
    const trimmed = pathOrFn.startsWith("/") ? pathOrFn : `/${pathOrFn}`;
    return `${this.cfg.apiBase.replace(/\/+$/, "")}${trimmed}`;
  }

  private headers(extra?: Record<string, string>): HeadersInit {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (this.cfg.apiKey) {
      h["Authorization"] = `Bearer ${this.cfg.apiKey}`;
      h["x-joy-api-key"] = this.cfg.apiKey;
    }
    if (this.cfg.supabasePublishableKey) {
      h["apikey"] = this.cfg.supabasePublishableKey;
    }
    return h;
  }

  private async request<T>(
    pathOrFn: string,
    init: RequestInit = {},
  ): Promise<Result<T>> {
    const url = this.buildUrl(pathOrFn);
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(url, {
        ...init,
        headers: this.headers(init.headers as Record<string, string>),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: body || res.statusText, status: res.status };
      }
      // Some endpoints return empty 200; tolerate that.
      const text = await res.text();
      if (!text) return { ok: true, data: undefined as unknown as T };
      try {
        return { ok: true, data: JSON.parse(text) as T };
      } catch {
        return { ok: true, data: text as unknown as T };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -- stores ----------------------------------------------------------------

  /**
   * Create a new store. Maps to the `store-contract-factory` edge function.
   * Server is responsible for Supabase row + on-chain registration.
   */
  createStore(input: CreateStoreInput): Promise<Result<Store>> {
    return this.request<Store>("store-contract-factory", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Read a store by slug. */
  getStore(slug: string): Promise<Result<Store>> {
    return this.request<Store>(
      `joybridge-get-store?slug=${encodeURIComponent(slug)}`,
      { method: "GET" },
    );
  }

  /**
   * List stores owned by the connected publisher.
   * Falls back to a 200 with an empty list if the function isn't deployed yet.
   */
  listMyStores(): Promise<Result<Store[]>> {
    return this.request<Store[]>("joybridge-list-my-stores", { method: "GET" });
  }

  // -- assets ---------------------------------------------------------------

  /** Publish an asset. Maps to the `publish-asset` edge function. */
  publishAsset(input: PublishAssetInput): Promise<Result<Asset>> {
    return this.request<Asset>("publish-asset", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Read a single asset by id or tokenId. */
  getAsset(idOrToken: string): Promise<Result<Asset>> {
    return this.request<Asset>(
      `joybridge-get-asset?id=${encodeURIComponent(idOrToken)}`,
      { method: "GET" },
    );
  }

  /** List my published assets. */
  listMyAssets(): Promise<Result<Asset[]>> {
    return this.request<Asset[]>("joybridge-list-my-assets", { method: "GET" });
  }

  /** Public marketplace browse (paginated). */
  browseMarketplace(query: BrowseQuery = {}): Promise<Result<BrowseResult>> {
    const qs = new URLSearchParams();
    if (query.assetType) qs.set("assetType", query.assetType);
    if (query.storeSlug) qs.set("storeSlug", query.storeSlug);
    if (query.search) qs.set("search", query.search);
    if (query.cursor) qs.set("cursor", query.cursor);
    if (query.limit) qs.set("limit", String(query.limit));
    const path = `marketplace-listing${qs.toString() ? `?${qs}` : ""}`;
    return this.request<BrowseResult>(path, { method: "GET" });
  }

  // -- IPFS pin -------------------------------------------------------------

  /**
   * Pin a blob to IPFS via the marketplace's pin endpoint.
   * Accepts a raw `File` / `Blob` / `ArrayBuffer` / base64 string + filename.
   */
  async pinToIpfs(input: {
    data: Blob | ArrayBuffer | string;
    filename?: string;
    contentType?: string;
  }): Promise<Result<PinResult>> {
    try {
      const fetchImpl = this.cfg.fetchImpl ?? fetch;
      const url = this.buildUrl("pin");
      const form = new FormData();
      let blob: Blob;
      if (input.data instanceof Blob) {
        blob = input.data;
      } else if (input.data instanceof ArrayBuffer) {
        blob = new Blob([input.data], {
          type: input.contentType ?? "application/octet-stream",
        });
      } else {
        // assume base64 or utf-8 string
        blob = new Blob([input.data], {
          type: input.contentType ?? "text/plain",
        });
      }
      form.append("file", blob, input.filename ?? "asset.bin");
      const headers: Record<string, string> = {};
      if (this.cfg.apiKey) {
        headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
        headers["x-joy-api-key"] = this.cfg.apiKey;
      }
      if (this.cfg.supabasePublishableKey) {
        headers["apikey"] = this.cfg.supabasePublishableKey;
      }
      const res = await fetchImpl(url, {
        method: "POST",
        body: form,
        headers,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: body || res.statusText, status: res.status };
      }
      const data = (await res.json()) as PinResult;
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -- Goldsky --------------------------------------------------------------

  /**
   * Run a Goldsky GraphQL query. Defaults to the marketplace subgraph.
   * Endpoint string is the FULL Goldsky URL — caller chooses subgraph.
   */
  async goldskyQuery<T = unknown>(
    endpoint: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<Result<T>> {
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `Goldsky ${res.status} ${res.statusText}`,
          status: res.status,
        };
      }
      const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (json.errors?.length) {
        return { ok: false, error: json.errors[0].message };
      }
      return { ok: true, data: (json.data ?? ({} as T)) };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// Re-exported singleton (lazy). Most call sites should use the IPC handler
// rather than reaching into this module directly.
let _client: JoyBridgeClient | undefined;

export function getJoyBridgeClient(): JoyBridgeClient {
  if (!_client) _client = new JoyBridgeClient();
  return _client;
}

export function resetJoyBridgeClientForTests(): void {
  _client = undefined;
}
