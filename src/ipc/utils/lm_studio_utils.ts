import { readSettings } from "../../main/settings";
import {
  DEFAULT_LM_STUDIO_ENDPOINT,
  DEFAULT_LM_STUDIO_PORT,
} from "@/constants/localModels";

function ensureProtocol(host: string, defaultPort: number): string {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
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
    const address = host.startsWith("[") ? host : `[${host}]`;
    return `http://${address}:${defaultPort}`;
  }

  return `http://${host}:${defaultPort}`;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeLmStudioBaseUrl(endpoint?: string): string {
  if (!endpoint) {
    return DEFAULT_LM_STUDIO_ENDPOINT;
  }

  const trimmed = endpoint.trim();
  if (!trimmed) {
    return DEFAULT_LM_STUDIO_ENDPOINT;
  }

  const withProtocol = ensureProtocol(trimmed, DEFAULT_LM_STUDIO_PORT);
  let normalized = stripTrailingSlashes(withProtocol);

  if (normalized.toLowerCase().endsWith("/v1")) {
    normalized = stripTrailingSlashes(normalized.slice(0, -3));
  }

  return normalized || DEFAULT_LM_STUDIO_ENDPOINT;
}

export function getLMStudioBaseUrl(): string {
  const override = process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
  if (override && override.trim()) {
    return normalizeLmStudioBaseUrl(override);
  }

  const settings = readSettings();
  return normalizeLmStudioBaseUrl(settings.lmStudioEndpoint);
}
