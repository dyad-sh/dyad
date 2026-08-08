/**
 * MX Serve — local OpenAI-compatible inference for macOS.
 *
 * It speaks the same wire format as LM Studio, so the existing OpenAI provider
 * path does the actual work; what is specific to MX Serve is where it lives and
 * how it is checked.
 *
 * The API key is optional and usually absent, which is the detail that matters
 * most here. A server that expects no auth and receives `Authorization: Bearer`
 * with an empty value will often reject the request outright, so a blank key
 * must mean *no header at all* rather than an empty one.
 */

import type { LocalProviderSetting, UserSettings } from "@/lib/schemas";

export const MX_SERVE_PROVIDER_ID = "mx_serve";
export const MX_SERVE_DISPLAY_NAME = "MX Serve";
export const MX_SERVE_DESCRIPTION = "Fast local LLM inference for macOS";

/** Where MX Serve listens out of the box. */
export const DEFAULT_MX_SERVE_BASE_URL = "http://127.0.0.1:8080/v1";

/**
 * Normalises whatever the user typed into a host root, without `/v1`.
 *
 * People paste all of these: a bare host and port, a trailing slash, the full
 * `/v1` root copied from the server's own output. All of them mean the same
 * server.
 */
export function parseMxServeBaseUrl(url?: string): string {
  const fallback = DEFAULT_MX_SERVE_BASE_URL.replace(/\/v1$/, "");
  if (!url?.trim()) return fallback;

  let normalised = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalised)) {
    normalised = `http://${normalised}`;
  }
  if (normalised.endsWith("/v1")) {
    normalised = normalised.slice(0, -3);
  }
  return normalised.replace(/\/+$/, "");
}

export function getMxServeBaseUrlFromSettings(
  settings?: UserSettings | null,
): string {
  const stored = settings?.providerSettings?.[MX_SERVE_PROVIDER_ID] as
    | LocalProviderSetting
    | undefined;
  return parseMxServeBaseUrl(stored?.apiBaseUrl);
}

/** The OpenAI-compatible root — what `/chat/completions` hangs off. */
export function getMxServeApiBaseUrl(settings?: UserSettings | null): string {
  return `${getMxServeBaseUrlFromSettings(settings)}/v1`;
}

/** `/health`, which sits beside `/v1` rather than inside it. */
export function getMxServeHealthUrl(settings?: UserSettings | null): string {
  return `${getMxServeBaseUrlFromSettings(settings)}/health`;
}

/**
 * Headers for a request.
 *
 * A blank, whitespace-only or absent key produces no `Authorization` header at
 * all — sending an empty bearer token is worse than sending nothing, because a
 * server with auth disabled may still reject a malformed one.
 */
export function buildMxServeHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * Both loopback spellings of a host.
 *
 * MX Serve binds to IPv6 loopback only, so `127.0.0.1` simply does not answer
 * — while other setups are IPv4-only. Rather than pick a side and be wrong
 * half the time, try the given address and then its counterpart.
 */
export function loopbackVariants(root: string): string[] {
  const variants = [root];
  if (root.includes("127.0.0.1")) {
    variants.push(root.replace("127.0.0.1", "[::1]"));
  } else if (root.includes("[::1]")) {
    variants.push(root.replace("[::1]", "127.0.0.1"));
  } else if (root.includes("localhost")) {
    variants.push(
      root.replace("localhost", "[::1]"),
      root.replace("localhost", "127.0.0.1"),
    );
  }
  return [...new Set(variants)];
}

export type MxServeModel = { id: string; label: string };

/**
 * One entry per model, whatever the address it arrived on.
 *
 * IPv4 and IPv6 loopback usually reach the *same* MX Serve process, so a
 * dual-stack server is discovered twice and reports its models twice. Keying
 * by provider and model id collapses that back to what is really there.
 */
export function dedupeMxServeModels<T extends { id: string }>(
  models: T[],
): T[] {
  return Array.from(
    new Map(models.map((model) => [`mx_serve:${model.id}`, model])).values(),
  );
}

/** Reads the model list out of an OpenAI-shaped `/v1/models` response. */
export function parseModelsResponse(payload: unknown): MxServeModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => {
      const id = (entry as { id?: unknown })?.id;
      return typeof id === "string" && id.trim() ? { id, label: id } : null;
    })
    .filter((model): model is MxServeModel => model !== null);
}

export type ConnectionResult =
  | { ok: true; models: MxServeModel[] }
  | { ok: false; message: string };

/**
 * Turns a failure into something a person can act on.
 *
 * "Failed to fetch" tells the user nothing; naming the likely cause and the
 * fix is the difference between a dead end and a next step.
 */
export function describeConnectionError(
  stage: "health" | "models",
  error: unknown,
  status?: number,
): string {
  if (status === 401 || status === 403) {
    return "MX Serve rejected the API key. Clear the key if the server does not require one.";
  }
  if (status === 404 && stage === "models") {
    return "Connected, but MX Serve did not return a model list. Load a model in MX Serve and try again.";
  }
  if (status != null && status >= 500) {
    return `MX Serve returned an error (${status}). Check the server log.`;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/abort|timeout/i.test(message)) {
    return "MX Serve did not respond in time. Is a model still loading?";
  }
  // The overwhelmingly common case: the server simply is not running.
  return "Could not reach MX Serve. Open MX Serve, load a model, and start the server.";
}

/**
 * Checks the server, then asks what it can run.
 *
 * Health first, because it distinguishes "not running" from "running but no
 * model loaded" — two problems with different fixes.
 */
export async function testMxServeConnection(
  options: {
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
  } = {},
): Promise<ConnectionResult> {
  const configured = parseMxServeBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const headers = buildMxServeHeaders(options.apiKey);
  const timeoutMs = options.timeoutMs ?? 5_000;

  // The server may be listening on only one loopback family.
  let root = configured;
  let reachable = false;
  let lastStatus: number | undefined;
  let lastError: unknown = null;

  for (const candidate of loopbackVariants(configured)) {
    try {
      const probe = await fetcher(`${candidate}/health`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = probe.status;
      if (probe.ok) {
        root = candidate;
        reachable = true;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!reachable) {
    return {
      ok: false,
      message: describeConnectionError("health", lastError, lastStatus),
    };
  }

  try {
    const response = await fetcher(`${root}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: describeConnectionError("models", null, response.status),
      };
    }
    const models = parseModelsResponse(await response.json());
    if (models.length === 0) {
      return {
        ok: false,
        message:
          "MX Serve is running but has no model loaded. Load a model in MX Serve and test again.",
      };
    }
    return { ok: true, models };
  } catch (error) {
    return { ok: false, message: describeConnectionError("models", error) };
  }
}
