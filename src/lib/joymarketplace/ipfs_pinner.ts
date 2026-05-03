/**
 * IpfsPinner — pins JSON / blobs to IPFS with provider fallback.
 *
 * Provider order:
 *   1. 4everland   (POST https://api.4everland.dev/bucket/pin)
 *   2. Pinata      (POST https://api.pinata.cloud/pinning/pinFileToIPFS
 *                       /pinning/pinJSONToIPFS)
 *   3. Local Helia (best-effort; returns CID with `pinnedRemotely: false`)
 *
 * Reads API keys from environment variables OR
 *   `<userData>/marketplace-pinning.json` of the form
 *     { "foureverland": { "apiKey": "..." },
 *       "pinata":       { "jwt": "...", "apiKey": "...", "secretKey": "..." } }
 *
 * Never throws on remote-pin failure when Helia succeeds — instead returns
 * `pinnedRemotely: false` so callers can warn.
 *
 * NOTE on Helia: import is dynamic so unit tests can mock fetch and verify
 * provider-fallback order without spinning up an in-process IPFS node.
 */

import log from "electron-log";

const logger = log.scope("ipfs_pinner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PinResult {
  cid: string;
  url: string;
  /** false when only Helia / local pinning succeeded and remote pin failed. */
  pinnedRemotely: boolean;
  /** "4everland" | "pinata" | "helia" */
  provider: PinProvider;
  size?: number;
}

export type PinProvider = "4everland" | "pinata" | "helia";

export interface PinnerKeys {
  foureverland?: { apiKey: string };
  pinata?: { jwt?: string; apiKey?: string; secretKey?: string };
}

export interface IpfsPinnerOptions {
  keys?: PinnerKeys;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override Helia loader (tests). Resolves to an object with `add(bytes)`. */
  heliaLoader?: () => Promise<{ add: (bytes: Uint8Array) => Promise<{ cid: string }> }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gatewayUrl(cid: string): string {
  return `https://ipfs.io/ipfs/${cid}`;
}

function toUint8(input: Buffer | ArrayBuffer | Uint8Array | Blob): Uint8Array | Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return input.arrayBuffer().then((b) => new Uint8Array(b));
  }
  // Buffer is a Uint8Array subclass
  return new Uint8Array(input as Buffer);
}

// ---------------------------------------------------------------------------
// Pinner
// ---------------------------------------------------------------------------

export class IpfsPinner {
  private keys: PinnerKeys;
  private fetchImpl: typeof fetch;
  private heliaLoader?: IpfsPinnerOptions["heliaLoader"];

  constructor(opts: IpfsPinnerOptions = {}) {
    this.keys = opts.keys ?? {};
    this.fetchImpl = opts.fetchImpl ?? ((globalThis.fetch?.bind(globalThis)) as typeof fetch);
    this.heliaLoader = opts.heliaLoader;
  }

  /** Replace keys (e.g. after the user updates settings). */
  setKeys(keys: PinnerKeys): void {
    this.keys = keys;
  }

  // -- public ---------------------------------------------------------------

  async pinJson(obj: object, name?: string): Promise<PinResult> {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    return this.pinBytes(bytes, `${name ?? "metadata"}.json`, "application/json");
  }

  async pinBlob(
    data: Buffer | Blob | ArrayBuffer | Uint8Array,
    filename: string,
    contentType?: string,
  ): Promise<PinResult> {
    const bytes = await toUint8(data);
    return this.pinBytes(bytes, filename, contentType);
  }

  // -- core dispatch --------------------------------------------------------

  private async pinBytes(
    bytes: Uint8Array,
    filename: string,
    contentType?: string,
  ): Promise<PinResult> {
    // 1. 4everland
    if (this.keys.foureverland?.apiKey) {
      try {
        const r = await this.pinTo4everland(bytes, filename, contentType);
        if (r) {
          logger.info(`Pinned ${filename} via 4everland: ${r.cid}`);
          return r;
        }
      } catch (err) {
        logger.warn(`4everland pin failed: ${(err as Error).message}`);
      }
    }

    // 2. Pinata
    if (this.keys.pinata?.jwt || (this.keys.pinata?.apiKey && this.keys.pinata.secretKey)) {
      try {
        const r = await this.pinToPinata(bytes, filename, contentType);
        if (r) {
          logger.info(`Pinned ${filename} via Pinata: ${r.cid}`);
          return r;
        }
      } catch (err) {
        logger.warn(`Pinata pin failed: ${(err as Error).message}`);
      }
    }

    // 3. Helia (local) — best-effort, marks `pinnedRemotely: false`
    try {
      const r = await this.pinToHelia(bytes);
      logger.info(`Pinned ${filename} via local Helia (no remote): ${r.cid}`);
      return r;
    } catch (err) {
      throw new Error(
        `All pinning providers failed (no remote keys and Helia unavailable): ${(err as Error).message}`,
      );
    }
  }

  // -- 4everland ------------------------------------------------------------

  private async pinTo4everland(
    bytes: Uint8Array,
    filename: string,
    contentType?: string,
  ): Promise<PinResult | null> {
    const apiKey = this.keys.foureverland?.apiKey;
    if (!apiKey) return null;
    const url = "https://api.4everland.dev/bucket/pin";
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: contentType ?? "application/octet-stream" }),
      filename,
    );
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        // 4everland accepts the API key as Authorization
        Authorization: apiKey,
      },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`4everland ${res.status}: ${txt || res.statusText}`);
    }
    const data = (await res.json().catch(() => ({}))) as {
      cid?: string;
      Hash?: string;
      hash?: string;
      size?: number;
    };
    const cid = data.cid ?? data.Hash ?? data.hash;
    if (!cid) throw new Error("4everland response missing cid");
    return {
      cid,
      url: gatewayUrl(cid),
      pinnedRemotely: true,
      provider: "4everland",
      size: data.size ?? bytes.byteLength,
    };
  }

  // -- Pinata ---------------------------------------------------------------

  private async pinToPinata(
    bytes: Uint8Array,
    filename: string,
    contentType?: string,
  ): Promise<PinResult | null> {
    const p = this.keys.pinata;
    if (!p) return null;
    // JSON shortcut when content-type === application/json
    if (contentType === "application/json") {
      const url = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
      const headers = this.pinataHeaders(true);
      // Re-decode so Pinata gets the parsed object.
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        parsed = { raw: new TextDecoder().decode(bytes) };
      }
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pinataContent: parsed,
          pinataMetadata: { name: filename },
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Pinata ${res.status}: ${txt || res.statusText}`);
      }
      const data = (await res.json()) as { IpfsHash?: string; PinSize?: number };
      if (!data.IpfsHash) throw new Error("Pinata response missing IpfsHash");
      return {
        cid: data.IpfsHash,
        url: gatewayUrl(data.IpfsHash),
        pinnedRemotely: true,
        provider: "pinata",
        size: data.PinSize ?? bytes.byteLength,
      };
    }
    // File path
    const url = "https://api.pinata.cloud/pinning/pinFileToIPFS";
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: contentType ?? "application/octet-stream" }),
      filename,
    );
    const headers = this.pinataHeaders(false);
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Pinata ${res.status}: ${txt || res.statusText}`);
    }
    const data = (await res.json()) as { IpfsHash?: string; PinSize?: number };
    if (!data.IpfsHash) throw new Error("Pinata response missing IpfsHash");
    return {
      cid: data.IpfsHash,
      url: gatewayUrl(data.IpfsHash),
      pinnedRemotely: true,
      provider: "pinata",
      size: data.PinSize ?? bytes.byteLength,
    };
  }

  private pinataHeaders(isJson: boolean): Record<string, string> {
    const p = this.keys.pinata!;
    const h: Record<string, string> = {};
    if (p.jwt) {
      h["Authorization"] = `Bearer ${p.jwt}`;
    } else if (p.apiKey && p.secretKey) {
      h["pinata_api_key"] = p.apiKey;
      h["pinata_secret_api_key"] = p.secretKey;
    }
    if (isJson) h["Content-Type"] = "application/json";
    return h;
  }

  // -- Helia (local) --------------------------------------------------------

  private async pinToHelia(bytes: Uint8Array): Promise<PinResult> {
    const loader = this.heliaLoader ?? defaultHeliaLoader;
    const fs = await loader();
    const { cid } = await fs.add(bytes);
    return {
      cid,
      url: gatewayUrl(cid),
      pinnedRemotely: false,
      provider: "helia",
      size: bytes.byteLength,
    };
  }
}

// ---------------------------------------------------------------------------
// Default Helia loader (lazy import to keep test runs cheap)
// ---------------------------------------------------------------------------

async function defaultHeliaLoader(): Promise<{
  add: (bytes: Uint8Array) => Promise<{ cid: string }>;
}> {
  const [{ createHelia }, { unixfs }] = await Promise.all([
    import("helia"),
    import("@helia/unixfs"),
  ]);
  // In-memory blockstore by default; fine for "best-effort local CID".
  const helia = await createHelia();
  const fs = unixfs(helia);
  return {
    add: async (bytes: Uint8Array) => {
      const cid = await fs.addBytes(bytes);
      return { cid: cid.toString() };
    },
  };
}

// ---------------------------------------------------------------------------
// Default-keys loader (settings file + env)
// ---------------------------------------------------------------------------

/**
 * Read pinning keys from env first, then `<userData>/marketplace-pinning.json`.
 * Safe to call from main process; uses a dynamic import for `electron` so
 * it can also be invoked from Node-only test contexts.
 */
export async function loadPinnerKeysFromSettings(): Promise<PinnerKeys> {
  const out: PinnerKeys = {};

  // Env first
  const envFour = process.env.FOUREVERLAND_API_KEY;
  if (envFour) out.foureverland = { apiKey: envFour };

  const envPinJwt = process.env.PINATA_JWT;
  const envPinKey = process.env.PINATA_API_KEY;
  const envPinSec = process.env.PINATA_SECRET_KEY;
  if (envPinJwt || (envPinKey && envPinSec)) {
    out.pinata = {
      jwt: envPinJwt,
      apiKey: envPinKey,
      secretKey: envPinSec,
    };
  }

  // Settings file overlay (only fills missing keys, env wins)
  try {
    const electron = await import("electron").catch(() => null);
    const fs = await import("fs-extra").catch(() => null);
    const path = await import("path").catch(() => null);
    if (!electron?.app || !fs || !path) return out;
    const file = path.join(electron.app.getPath("userData"), "marketplace-pinning.json");
    if (!(await fs.pathExists(file))) return out;
    const data = (await fs.readJson(file)) as PinnerKeys;
    if (!out.foureverland && data.foureverland?.apiKey) {
      out.foureverland = data.foureverland;
    }
    if (!out.pinata && data.pinata) {
      out.pinata = data.pinata;
    }
  } catch (err) {
    logger.warn(`loadPinnerKeysFromSettings: ${(err as Error).message}`);
  }

  return out;
}
