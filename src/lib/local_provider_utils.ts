import type { LocalProviderSetting, UserSettings } from "@/lib/schemas";

export const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Normalize a host/base URL (no trailing slash, no /v1 suffix). */
export function parseLMStudioBaseUrl(url?: string): string {
  if (!url?.trim()) {
    return (
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING?.replace(/\/$/, "") ||
      DEFAULT_LM_STUDIO_BASE_URL
    );
  }

  let normalized = url.trim().replace(/\/$/, "");
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `http://${normalized}`;
  }
  if (normalized.endsWith("/v1")) {
    normalized = normalized.slice(0, -3);
  }
  return normalized.replace(/\/$/, "");
}

export function getLMStudioBaseUrlFromSettings(
  settings?: UserSettings | null,
): string {
  const stored = settings?.providerSettings?.lmstudio as
    | LocalProviderSetting
    | undefined;
  if (stored?.apiBaseUrl?.trim()) {
    return parseLMStudioBaseUrl(stored.apiBaseUrl);
  }
  return parseLMStudioBaseUrl();
}

/** OpenAI-compatible API root (…/v1) for chat completions and /v1/models. */
export function getLMStudioApiBaseUrl(settings?: UserSettings | null): string {
  const base = getLMStudioBaseUrlFromSettings(settings);
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function parseOllamaBaseUrl(host?: string): string {
  if (!host?.trim()) {
    return parseOllamaHost(process.env.OLLAMA_HOST);
  }
  return parseOllamaHost(host);
}

/** @deprecated use parseOllamaBaseUrl — kept for handler import compatibility */
export function parseOllamaHost(host?: string): string {
  if (!host) {
    return DEFAULT_OLLAMA_BASE_URL;
  }

  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host.replace(/\/$/, "");
  }

  if (host.startsWith("[") && host.includes("]:")) {
    return `http://${host}`;
  }

  if (
    host.includes(":") &&
    !host.includes("::") &&
    host.split(":").length === 2
  ) {
    return `http://${host}`;
  }

  if (host.includes("::") || host.split(":").length > 2) {
    return `http://[${host}]:11434`;
  }

  return `http://${host}:11434`;
}

export function getOllamaBaseUrlFromSettings(
  settings?: UserSettings | null,
): string {
  const stored = settings?.providerSettings?.ollama as
    | LocalProviderSetting
    | undefined;
  if (stored?.apiBaseUrl?.trim()) {
    return parseOllamaBaseUrl(stored.apiBaseUrl);
  }
  return parseOllamaBaseUrl();
}

export function getOllamaApiUrl(settings?: UserSettings | null): string {
  const base = getOllamaBaseUrlFromSettings(settings);
  return base.endsWith("/api") ? base : `${base}/api`;
}

export function isLocalProviderId(
  providerId: string,
): providerId is "lmstudio" | "ollama" | "mx_serve" {
  return (
    providerId === "lmstudio" ||
    providerId === "ollama" ||
    // MX Serve runs on the user's own machine, so it inherits every
    // local-only privilege: private memory may be sent to it, and no
    // cloud-egress warning applies.
    providerId === "mx_serve"
  );
}
