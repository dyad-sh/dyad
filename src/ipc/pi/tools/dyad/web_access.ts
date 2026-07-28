import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  escapeXmlAttr,
  escapeXmlContent,
} from "../../../../../shared/xmlEscape";
import type {
  AgentContext,
  ToolDefinition,
  WebSearchConfig,
  WebSearchProvider,
} from "./types";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 80_000;

export type { WebSearchConfig, WebSearchProvider } from "./types";

interface WebSearchInput {
  query?: string;
  queries?: string[];
  numResults?: number;
}

interface WebSearchDependencies {
  fetchFn?: typeof fetch;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

interface ResolvedPublicUrl {
  url: URL;
  addresses: ResolvedAddress[];
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::", 96],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fec0::", 10],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const family = isIP(normalized);
  if (family === 4) return blockedAddresses.check(normalized, "ipv4");
  if (family === 6) return blockedAddresses.check(normalized, "ipv6");
  return true;
}

async function resolvePublicHttpUrl(url: string): Promise<ResolvedPublicUrl> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DyadError("Invalid URL", DyadErrorKind.Validation);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DyadError(
      "Only HTTP and HTTPS URLs are supported",
      DyadErrorKind.Validation,
    );
  }
  if (parsed.username || parsed.password) {
    throw new DyadError(
      "URLs containing credentials are not allowed",
      DyadErrorKind.Validation,
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new DyadError(
      "Private URLs are not allowed",
      DyadErrorKind.Validation,
    );
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new DyadError(
        "Private URLs are not allowed",
        DyadErrorKind.Validation,
      );
    }
    return {
      url: parsed,
      addresses: [{ address: hostname, family: isIP(hostname) }],
    };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new DyadError(
      `Could not resolve ${hostname}`,
      DyadErrorKind.External,
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new DyadError(
      "Private URLs are not allowed",
      DyadErrorKind.Validation,
    );
  }
  return {
    url: parsed,
    addresses: addresses.sort((left, right) => left.family - right.family),
  };
}

export async function assertPublicHttpUrl(url: string): Promise<URL> {
  return (await resolvePublicHttpUrl(url)).url;
}

function chooseProvider(
  config: WebSearchConfig,
): Exclude<WebSearchProvider, "auto"> {
  const provider = config.provider;
  if (provider === "exa") {
    if (!config.exaApiKey) {
      throw new DyadError(
        "An Exa API key is required",
        DyadErrorKind.Validation,
      );
    }
    return "exa";
  }
  if (provider === "brave") {
    if (!config.braveApiKey) {
      throw new DyadError(
        "A Brave API key is required",
        DyadErrorKind.Validation,
      );
    }
    return "brave";
  }
  if (config.exaApiKey) return "exa";
  if (config.braveApiKey) return "brave";
  throw new DyadError(
    "A web search API key is required",
    DyadErrorKind.Validation,
  );
}

function normalizedQueries(input: WebSearchInput): string[] {
  const values = input.queries ?? (input.query ? [input.query] : []);
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
}

async function searchExa(
  query: string,
  count: number,
  apiKey: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const response = await fetchFn(EXA_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: count,
      text: true,
    }),
    signal: combineSignals(signal, FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw await responseError("Exa", response);
  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
      highlights?: string[];
    }>;
  };
  return (data.results ?? [])
    .filter(
      (item): item is typeof item & { url: string } =>
        typeof item.url === "string",
    )
    .map((item) => ({
      title: item.title?.trim() || item.url,
      url: item.url,
      snippet: item.text?.trim() || item.highlights?.join(" ").trim() || "",
    }));
}

async function searchBrave(
  query: string,
  count: number,
  apiKey: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("extra_snippets", "true");
  url.searchParams.set("safesearch", "moderate");
  const response = await fetchFn(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: combineSignals(signal, FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw await responseError("Brave", response);
  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
      }>;
    };
  };
  return (data.web?.results ?? [])
    .filter(
      (item): item is typeof item & { url: string } =>
        typeof item.url === "string",
    )
    .map((item) => ({
      title: item.title?.trim() || item.url,
      url: item.url,
      snippet: [item.description, ...(item.extra_snippets ?? [])]
        .filter(Boolean)
        .join(" "),
    }));
}

export async function searchWeb(
  input: WebSearchInput,
  config: WebSearchConfig,
  dependencies: WebSearchDependencies = {},
  signal?: AbortSignal,
): Promise<{ provider: "exa" | "brave"; text: string }> {
  const queries = normalizedQueries(input);
  if (queries.length === 0) {
    throw new DyadError(
      "Provide at least one search query",
      DyadErrorKind.Validation,
    );
  }
  const count = Math.min(10, Math.max(1, Math.floor(input.numResults ?? 5)));
  const provider = chooseProvider(config);
  const fetchFn = dependencies.fetchFn ?? fetch;
  const sections: string[] = [];
  for (const query of queries) {
    const results =
      provider === "exa"
        ? await searchExa(query, count, config.exaApiKey!, fetchFn, signal)
        : await searchBrave(query, count, config.braveApiKey!, fetchFn, signal);
    sections.push(
      `## Query: ${query}\n\n${
        results
          .map(
            (result, index) =>
              `${index + 1}. ${result.title}\n${result.url}${result.snippet ? `\n${result.snippet}` : ""}`,
          )
          .join("\n\n") || "No results found."
      }`,
    );
  }
  return { provider, text: truncate(sections.join("\n\n")) };
}

async function responseError(
  provider: string,
  response: Response,
): Promise<Error> {
  const body = (await response.text()).slice(0, 500);
  return new DyadError(
    `${provider} search failed (${response.status})${body ? `: ${body}` : ""}`,
    DyadErrorKind.External,
  );
}

function combineSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function getHeader(
  response: http.IncomingMessage,
  name: string,
): string | undefined {
  const value = response.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

async function readLimitedBody(
  response: http.IncomingMessage,
): Promise<string> {
  const contentLength = Number(getHeader(response, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    response.destroy();
    throw new DyadError(
      "Web page is too large to fetch",
      DyadErrorKind.Validation,
    );
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      response.destroy();
      throw new DyadError(
        "Web page is too large to fetch",
        DyadErrorKind.Validation,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function requestPublicUrl(
  resolved: ResolvedPublicUrl,
  signal?: AbortSignal,
): Promise<http.IncomingMessage> {
  const addresses = resolved.addresses;
  let addressIndex = 0;
  const pinnedLookup: NonNullable<http.RequestOptions["lookup"]> = (
    _hostname,
    options,
    callback,
  ) => {
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const selected = addresses[addressIndex++ % addresses.length];
    callback(null, selected.address, selected.family);
  };
  const transport = resolved.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      resolved.url,
      {
        method: "GET",
        signal: combineSignals(signal, FETCH_TIMEOUT_MS),
        lookup: pinnedLookup,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain,text/markdown",
          "User-Agent": "Dyad Web Access/1.0",
        },
      },
      resolve,
    );
    request.once("error", reject);
    request.end();
  });
}

export async function fetchPublicContent(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<{ url: string; title: string; content: string }> {
  let current = await resolvePublicHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await requestPublicUrl(current, signal);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = getHeader(response, "location");
      response.destroy();
      if (!location || redirects === 5) {
        throw new DyadError(
          "Too many web page redirects",
          DyadErrorKind.External,
        );
      }
      current = await resolvePublicHttpUrl(new URL(location, current.url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      const body = (await readLimitedBody(response)).slice(0, 500);
      throw new DyadError(
        `Web fetch failed (${status})${body ? `: ${body}` : ""}`,
        DyadErrorKind.External,
      );
    }
    const contentType =
      getHeader(response, "content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("text/") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      response.destroy();
      throw new DyadError(
        "Unsupported web page content type",
        DyadErrorKind.Validation,
      );
    }
    const body = await readLimitedBody(response);
    if (!contentType.includes("html") && !contentType.includes("xhtml")) {
      return {
        url: current.url.href,
        title: current.url.pathname.split("/").pop() || current.url.hostname,
        content: truncate(body),
      };
    }
    const { document } = parseHTML(body);
    const article = new Readability(document as unknown as Document).parse();
    if (!article) {
      throw new DyadError(
        "Could not extract readable page content",
        DyadErrorKind.External,
      );
    }
    const markdown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    }).turndown(article.content);
    return {
      url: current.url.href,
      title: article.title || current.url.hostname,
      content: truncate(markdown),
    };
  }
  throw new DyadError("Could not fetch web page", DyadErrorKind.External);
}

function truncate(value: string): string {
  if (value.length <= MAX_RESULT_CHARS) return value;
  const marker = "\n\n<!-- truncated -->";
  return `${value.slice(0, MAX_RESULT_CHARS - marker.length)}${marker}`;
}

const webSearchSchema = z.object({
  query: z.string().optional(),
  queries: z.array(z.string()).max(4).optional(),
  numResults: z.number().int().min(1).max(10).optional(),
});

function hasConfiguredSearchProvider(config: WebSearchConfig | undefined) {
  if (!config) return false;
  if (config.provider === "exa") return Boolean(config.exaApiKey);
  if (config.provider === "brave") return Boolean(config.braveApiKey);
  return Boolean(config.exaApiKey || config.braveApiKey);
}

export const webSearchTool: ToolDefinition<z.infer<typeof webSearchSchema>> = {
  name: "web_search",
  description:
    "Search the current web for documentation, recent information, error messages, and external facts. Use multiple focused queries for broader research.",
  inputSchema: webSearchSchema,
  defaultConsent: "always",
  isEnabled: (ctx) =>
    Boolean(
      ctx.webAccessEnabled && hasConfiguredSearchProvider(ctx.webSearchConfig),
    ),
  buildXml: (args) => {
    const query = args.query ?? args.queries?.[0];
    return query
      ? `<dyad-web-search query="${escapeXmlAttr(query)}">`
      : undefined;
  },
  execute: async (args, ctx: AgentContext) => {
    const result = await searchWeb(
      args,
      ctx.webSearchConfig!,
      {},
      ctx.abortSignal,
    );
    const query = args.query ?? args.queries?.join("; ") ?? "";
    ctx.onXmlComplete(
      `<dyad-web-search query="${escapeXmlAttr(query)}">${escapeXmlContent(result.text)}</dyad-web-search>`,
    );
    return result.text;
  },
};

const fetchContentSchema = z.object({
  url: z.url(),
});

export const fetchContentTool: ToolDefinition<
  z.infer<typeof fetchContentSchema>
> = {
  name: "fetch_content",
  description:
    "Fetch a specific public HTTP or HTTPS URL and return its readable content as markdown. Use this when the user provides a direct URL.",
  inputSchema: fetchContentSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => Boolean(ctx.webAccessEnabled),
  buildXml: (args) => `<dyad-web-fetch>${escapeXmlContent(args.url)}`,
  execute: async (args, ctx) => {
    ctx.onXmlStream(`<dyad-web-fetch>${escapeXmlContent(args.url)}`);
    try {
      const result = await fetchPublicContent(args.url, ctx.abortSignal);
      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(result.url)}</dyad-web-fetch>`,
      );
      return truncate(
        `# ${result.title}\n\nSource: ${result.url}\n\n${result.content}`,
      );
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );
      throw error;
    }
  },
};
