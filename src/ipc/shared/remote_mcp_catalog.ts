import log from "electron-log";
import { z } from "zod";

const logger = log.scope("remote_mcp_catalog");

const REMOTE_MCP_CATALOG_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 1000;

function getRemoteMcpCatalogUrl() {
  if (process.env.DYAD_MCP_CATALOG_URL) {
    return process.env.DYAD_MCP_CATALOG_URL;
  }

  if (process.env.E2E_TEST_BUILD === "true" && process.env.FAKE_LLM_PORT) {
    return `http://localhost:${process.env.FAKE_LLM_PORT}/api/mcp-catalog`;
  }

  return "https://api.dyad.sh/v1/mcp-catalog";
}

// Only http entries are supported. The transport literal makes any
// other transport fail per-entry validation and drop out, so the
// catalog can serve entry kinds this client doesn't know about yet.
export const McpCatalogEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  transport: z.literal("http"),
  url: z.string().url(),
  oauth: z.enum(["required", "optional", "none"]),
  oauthScope: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type McpCatalogEntry = z.infer<typeof McpCatalogEntrySchema>;

// The envelope is parsed strictly but entries are validated one by
// one: a single bad entry drops out instead of taking down the whole
// catalog.
const McpCatalogResponseSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  servers: z.array(z.unknown()),
});

type McpCatalogCacheEntry = {
  entries: McpCatalogEntry[];
  expiresAt: number;
};

let catalogCache: McpCatalogCacheEntry | null = null;
let catalogFetchPromise: Promise<McpCatalogEntry[]> | null = null;

function parseEntries(raw: unknown[]): McpCatalogEntry[] {
  const entries: McpCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const result = McpCatalogEntrySchema.safeParse(candidate);
    if (!result.success) {
      logger.debug("Dropping catalog entry that failed validation");
      continue;
    }
    if (seen.has(result.data.slug)) {
      logger.debug(`Dropping catalog entry with duplicate slug`);
      continue;
    }
    seen.add(result.data.slug);
    entries.push(result.data);
  }
  return entries;
}

async function fetchRemoteMcpCatalog(): Promise<{
  entries: McpCatalogEntry[];
  expiresAt: number;
}> {
  const response = await fetch(getRemoteMcpCatalogUrl(), {
    signal: AbortSignal.timeout(REMOTE_MCP_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `MCP catalog request failed with status ${response.status}`,
    );
  }
  const parsed = McpCatalogResponseSchema.parse(await response.json());
  return {
    entries: parseEntries(parsed.servers),
    expiresAt: parsed.expiresAt
      ? Date.parse(parsed.expiresAt)
      : Date.now() + DEFAULT_CACHE_TTL_MS,
  };
}

/**
 * The curated MCP server catalog, or an empty list when it can't be
 * fetched — callers treat "no catalog" as a normal state (offline,
 * endpoint not deployed yet).
 */
export async function getRemoteMcpCatalog(): Promise<McpCatalogEntry[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.entries;
  }

  if (!catalogFetchPromise) {
    catalogFetchPromise = (async () => {
      try {
        const { entries, expiresAt } = await fetchRemoteMcpCatalog();
        catalogCache = { entries, expiresAt };
        return entries;
      } catch (error) {
        logger.warn("Failed to fetch MCP catalog", error);
        catalogCache = {
          entries: [],
          expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
        };
        return [];
      } finally {
        catalogFetchPromise = null;
      }
    })();
  }

  return catalogFetchPromise;
}

export function clearMcpCatalogCacheForTests() {
  catalogCache = null;
  catalogFetchPromise = null;
}
