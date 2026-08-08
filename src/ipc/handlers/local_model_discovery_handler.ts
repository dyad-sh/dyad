import os from "node:os";

import { createTypedHandler } from "./base";
import { languageModelContracts } from "../types/language-model";
import type {
  DiscoveredLocalModelServer,
  LocalModel,
} from "../types/language-model";

const LOCAL_MODEL_PORTS = [11434, 1234] as const;
const PROBE_TIMEOUT_MS = 450;
const MAX_CONCURRENCY = 32;

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

export function getLocalSubnetHosts(): string[] {
  const hosts = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        entry.family !== "IPv4" ||
        entry.internal ||
        !isPrivateIpv4(entry.address)
      ) {
        continue;
      }
      const prefix = entry.address.split(".").slice(0, 3).join(".");
      for (let last = 1; last <= 254; last += 1) {
        hosts.add(`${prefix}.${last}`);
      }
    }
  }
  return [...hosts];
}

function normalizeManualTarget(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  try {
    return new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`,
    ).origin;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseOllamaModels(value: unknown): LocalModel[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { models?: unknown }).models;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): LocalModel[] => {
    if (!item || typeof item !== "object") return [];
    const model = item as {
      name?: unknown;
      size?: unknown;
      details?: {
        parameter_size?: unknown;
        quantization_level?: unknown;
      };
    };
    if (typeof model.name !== "string" || !model.name.trim()) return [];
    return [
      {
        provider: "ollama",
        modelName: model.name,
        displayName: model.name,
        sizeBytes: typeof model.size === "number" ? model.size : undefined,
        parameterSize:
          typeof model.details?.parameter_size === "string"
            ? model.details.parameter_size
            : undefined,
        quantization:
          typeof model.details?.quantization_level === "string"
            ? model.details.quantization_level
            : undefined,
        loaded: true,
      },
    ];
  });
}

function parseOpenAiModels(value: unknown): LocalModel[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { data?: unknown }).data;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): LocalModel[] => {
    if (!item || typeof item !== "object") return [];
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) return [];
    return [
      {
        provider: "lmstudio",
        modelName: id,
        displayName: id,
        loaded: true,
      },
    ];
  });
}

/** Local model servers this app knows how to talk to. */
type LocalServerProvider = "ollama" | "lmstudio" | "mx_serve";

const LOCAL_SERVER_NAMES: Record<LocalServerProvider, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  mx_serve: "MX Serve",
};

async function probeServer(
  provider: LocalServerProvider,
  origin: string,
): Promise<DiscoveredLocalModelServer | null> {
  const started = performance.now();
  // Ollama has its own route; everything else here is OpenAI-compatible.
  const endpoint =
    provider === "ollama" ? `${origin}/api/tags` : `${origin}/v1/models`;
  const data = await fetchJson(endpoint);
  if (!data) return null;
  const models =
    provider === "ollama" ? parseOllamaModels(data) : parseOpenAiModels(data);
  const parsed = new URL(origin);
  return {
    provider,
    name: `${LOCAL_SERVER_NAMES[provider]} on ${parsed.hostname}`,
    url: origin,
    host: parsed.hostname,
    port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    models,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

export async function discoverLocalModelServers({
  scanLocalSubnet,
  targets,
}: {
  scanLocalSubnet: boolean;
  targets: string[];
}): Promise<{
  servers: DiscoveredLocalModelServer[];
  scannedHostCount: number;
}> {
  const probes = new Map<
    string,
    { provider: LocalServerProvider; origin: string }
  >();

  const addProbe = (provider: LocalServerProvider, origin: string) => {
    probes.set(`${provider}:${origin}`, { provider, origin });
  };

  addProbe("ollama", "http://localhost:11434");
  addProbe("lmstudio", "http://localhost:1234");
  // MX Serve commonly binds IPv6 loopback only, so probe both spellings.
  addProbe("mx_serve", "http://127.0.0.1:8080");
  addProbe("mx_serve", "http://[::1]:8080");

  for (const target of targets) {
    const origin = normalizeManualTarget(target);
    if (!origin) continue;
    const port = Number(new URL(origin).port);
    if (port === 11434) addProbe("ollama", origin);
    else if (port === 1234) addProbe("lmstudio", origin);
    else if (port === 8080) addProbe("mx_serve", origin);
    else {
      addProbe("ollama", origin);
      addProbe("lmstudio", origin);
    }
  }

  if (scanLocalSubnet) {
    for (const host of getLocalSubnetHosts()) {
      addProbe("ollama", `http://${host}:${LOCAL_MODEL_PORTS[0]}`);
      addProbe("lmstudio", `http://${host}:${LOCAL_MODEL_PORTS[1]}`);
    }
  }

  const candidates = [...probes.values()];
  const results = await mapWithConcurrency(candidates, ({ provider, origin }) =>
    probeServer(provider, origin),
  );
  const servers = results
    .filter((server): server is DiscoveredLocalModelServer => server !== null)
    .sort((a, b) => a.latencyMs - b.latencyMs);
  return {
    servers,
    scannedHostCount: new Set(
      candidates.map(({ origin }) => new URL(origin).hostname),
    ).size,
  };
}

export function registerLocalModelDiscoveryHandlers() {
  createTypedHandler(
    languageModelContracts.discoverLocalServers,
    async (_, input) => discoverLocalModelServers(input),
  );
}
