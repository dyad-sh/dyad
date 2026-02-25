import { z } from "zod";
import log from "electron-log";
import { lookup } from "node:dns/promises";
import type { AgentContext, ToolDefinition } from "./types";

const logger = log.scope("web_fetch");

const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_OUTPUT_CHARS = 60_000;
const MAX_REDIRECTS = 5;

const webFetchSchema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .default("markdown")
    .describe("Output format. Defaults to markdown."),
  timeout: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_SECONDS)
    .optional()
    .describe("Optional timeout in seconds (max 120)."),
});

const DESCRIPTION = `Fetch content from a URL.

Use this when you need the contents of a specific web page or endpoint.

Parameters:
- url: Must start with http:// or https://
- format: "text", "markdown", or "html" (defaults to "markdown")
- timeout: Optional timeout in seconds (max 120)

Notes:
- Responses larger than 5MB are rejected.
- Binary responses (including images) are not returned as text content.`;

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 0) return true; // 0.0.0.0/8
  }
  return false;
}

function isPrivateIp(hostname: string): boolean {
  // IPv6 loopback
  if (hostname === "[::1]" || hostname === "::1") return true;

  // Strip brackets for IPv6
  const ip = hostname.replace(/^\[|\]$/g, "");
  const lowerIp = ip.toLowerCase();

  // Unspecified address
  if (lowerIp === "::" || /^0(:0){7}$/.test(lowerIp)) return true;

  // Unique local addresses (fc00::/7)
  if (/^f[cd]/i.test(lowerIp)) return true;

  // Link-local addresses (fe80::/10)
  if (/^fe[89ab]/i.test(lowerIp)) return true;

  // IPv4-mapped IPv6 in dotted form (::ffff:x.x.x.x)
  const v4MappedMatch = lowerIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    return isPrivateIpv4(v4MappedMatch[1]);
  }

  // IPv4-mapped IPv6 in hex form (e.g. ::ffff:7f00:1 = ::ffff:127.0.0.1)
  const v4MappedHexMatch = lowerIp.match(
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (v4MappedHexMatch) {
    const high = parseInt(v4MappedHexMatch[1], 16);
    const low = parseInt(v4MappedHexMatch[2], 16);
    const reconstructed = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isPrivateIpv4(reconstructed);
  }

  // IPv4 patterns
  return isPrivateIpv4(ip);
}

async function resolveAndValidateHost(hostname: string): Promise<void> {
  // Skip validation for IP literals — already checked by isPrivateIp in validateHttpUrl
  if (hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;
  // Skip blocked hostnames — already checked
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return;

  try {
    const results = await lookup(hostname, { all: true });
    for (const entry of results) {
      if (isPrivateIp(entry.address)) {
        throw new Error(
          "URL resolves to a private or internal network address, which is not allowed",
        );
      }
    }
  } catch (err) {
    // Re-throw our own private-network errors
    if (err instanceof Error && err.message.includes("private or internal")) {
      throw err;
    }
    // DNS resolution failures are left for fetch to surface
  }
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

function validateHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }

  if (
    BLOCKED_HOSTNAMES.has(parsed.hostname.toLowerCase()) ||
    isPrivateIp(parsed.hostname)
  ) {
    throw new Error(
      "URL points to a private or internal network address, which is not allowed",
    );
  }

  return parsed.toString();
}

function buildAcceptHeader(format: "text" | "markdown" | "html"): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
    default:
      return "*/*";
  }
}

function isHtmlMime(mime: string): boolean {
  return mime === "text/html" || mime === "application/xhtml+xml";
}

function isTextLikeMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime === "text/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  );
}

// Decode &amp; last to prevent double-unescaping (e.g. &amp;lt; → &lt; not <)
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function collapseWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;!?])/g, "$1")
    .trim();
}

// Using regex-based HTML conversion to avoid adding an HTML parser dependency.
// Handles common tags; approximate conversion is acceptable for this tool's use case.
function removeNonContentTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, " ")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, " ")
    .replace(/<embed\b[^>]*>[\s\S]*?<\/embed\s*>/gi, " ");
}

function extractTextFromHtml(html: string): string {
  const sanitized = removeNonContentTags(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|header|footer|aside|main|h[1-6]|li|ul|ol|tr|table|blockquote)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ");

  return collapseWhitespace(decodeHtmlEntities(sanitized));
}

function convertHtmlToMarkdown(html: string): string {
  let markdown = removeNonContentTags(html);

  markdown = markdown
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n")
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n")
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      "[$2]($1)",
    )
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|header|footer|aside|main|ul|ol|tr|table|blockquote)>/gi,
      "\n\n",
    )
    .replace(/<[^>]+>/g, " ");

  return collapseWhitespace(decodeHtmlEntities(markdown));
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  const remaining = output.length - MAX_OUTPUT_CHARS;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated ${remaining} characters]`;
}

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  // No isEnabled guard: unlike web_search/web_crawl which use the paid engine API,
  // web_fetch uses native fetch and does not require Dyad Pro.
  defaultConsent: "ask",

  getConsentPreview: (args) => {
    const timeoutText = args.timeout ? ` (timeout ${args.timeout}s)` : "";
    return `Fetch URL: "${args.url}" as ${args.format}${timeoutText}`;
  },

  execute: async (args, _ctx: AgentContext) => {
    const normalizedUrl = validateHttpUrl(args.url);
    const timeoutSeconds = Math.min(
      args.timeout ?? DEFAULT_TIMEOUT_SECONDS,
      MAX_TIMEOUT_SECONDS,
    );

    // Validate that the hostname does not resolve to a private IP
    const parsedUrl = new URL(normalizedUrl);
    await resolveAndValidateHost(parsedUrl.hostname);

    const safeUrl = redactUrl(normalizedUrl);
    logger.log(`Fetching URL: ${safeUrl} (format=${args.format})`);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort(
        new Error(`Request timed out after ${timeoutSeconds}s`),
      );
    }, timeoutSeconds * 1000);

    let response: Response;
    let arrayBuffer: ArrayBuffer;
    try {
      // Follow redirects manually to validate each target against SSRF rules
      let currentUrl = normalizedUrl;
      let redirectCount = 0;
      while (true) {
        response = await fetch(currentUrl, {
          signal: abortController.signal,
          redirect: "manual",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: buildAcceptHeader(args.format),
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            throw new Error("Redirect response missing Location header");
          }
          if (redirectCount >= MAX_REDIRECTS) {
            throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`);
          }
          const redirectUrl = new URL(location, currentUrl).toString();
          validateHttpUrl(redirectUrl);
          const redirectParsed = new URL(redirectUrl);
          await resolveAndValidateHost(redirectParsed.hostname);
          currentUrl = redirectUrl;
          redirectCount++;
          continue;
        }
        break;
      }

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE_BYTES) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }

      // Stream the body to enforce the size limit without buffering the entire
      // response. The abort signal from the timeout propagates to reader.read(),
      // so slow-drip responses are also terminated by the overall timeout.
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_SIZE_BYTES) {
            reader.cancel();
            throw new Error("Response too large (exceeds 5MB limit)");
          }
          chunks.push(value);
        }
        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        arrayBuffer = combined.buffer;
      } else {
        arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large (exceeds 5MB limit)");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutSeconds}s`);
      }
      if (error instanceof Error) throw error;
      throw new Error(`Failed to fetch URL: ${String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

    if (mime.startsWith("image/") && mime !== "image/svg+xml") {
      return `Fetched binary image content (${mime}, ${arrayBuffer.byteLength} bytes). Use a URL-accessible image endpoint instead of inline image analysis.`;
    }

    if (mime && !isTextLikeMime(mime)) {
      return `Fetched binary content (${mime}, ${arrayBuffer.byteLength} bytes). This tool only returns text-like content.`;
    }

    const charsetMatch = contentType.match(/charset=([\w-]+)/i);
    const charset = charsetMatch?.[1] ?? "utf-8";
    let content: string;
    try {
      content = new TextDecoder(charset).decode(arrayBuffer);
    } catch {
      content = new TextDecoder().decode(arrayBuffer);
    }

    let output: string;
    if (args.format === "html") {
      output = content;
    } else if (isHtmlMime(mime)) {
      output =
        args.format === "markdown"
          ? convertHtmlToMarkdown(content)
          : extractTextFromHtml(content);
    } else {
      output = content;
    }

    const truncated = truncateOutput(output);
    logger.log(
      `Fetched URL successfully: ${safeUrl} (${mime || "unknown mime"}, ${arrayBuffer.byteLength} bytes)`,
    );

    return truncated;
  },
};
