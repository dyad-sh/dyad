import { z } from "zod";
import log from "electron-log";
import type { AgentContext, ToolDefinition } from "./types";

const logger = log.scope("web_fetch");

const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_OUTPUT_CHARS = 60_000;

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

function isPrivateIp(hostname: string): boolean {
  // IPv6 loopback
  if (hostname === "[::1]" || hostname === "::1") return true;

  // Strip brackets for IPv6
  const ip = hostname.replace(/^\[|\]$/g, "");

  // IPv4 patterns
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
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function removeNonContentTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript[^>]*>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe[^>]*>/gi, " ")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object[^>]*>/gi, " ")
    .replace(/<embed\b[^>]*>[\s\S]*?<\/embed[^>]*>/gi, " ");
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
      try {
        response = await fetch(normalizedUrl, {
          signal: abortController.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: buildAcceptHeader(args.format),
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Request timed out after ${timeoutSeconds}s`);
        }
        throw new Error(
          `Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE_BYTES) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }

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
