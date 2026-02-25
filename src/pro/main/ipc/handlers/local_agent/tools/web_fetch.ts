import { z } from "zod";
import log from "electron-log";
import { promises as dns } from "dns";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";

const logger = log.scope("web_fetch");

const webFetchSchema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .default("markdown")
    .describe(
      "The format to return the content in (text, markdown, or html). Defaults to markdown.",
    ),
  timeout: z
    .number()
    .positive()
    .max(120)
    .optional()
    .describe("Optional timeout in seconds (max 120)"),
});

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_LENGTH = 16_000; // Match web_crawl's truncation limit
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes
const MAX_REDIRECTS = 10;

/**
 * Decode HTML entities including named, decimal, and hexadecimal entities.
 * IMPORTANT: &amp; must be decoded last to prevent double-decoding (e.g., &amp;lt; → &lt; not <)
 */
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&amp;/g, "&");
}

/**
 * Check if an IP address string is in a private/reserved range.
 */
function isPrivateIP(ip: string): boolean {
  // Check IPv4
  const parts = ip.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)
  ) {
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 127) return true; // 127.0.0.0/8 (loopback)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local 169.254.0.0/16
  }

  return false;
}

/**
 * Check if a hostname (from URL parsing) is a private/internal address.
 * Covers IPv4, IPv6 (including IPv4-mapped), and special hostnames.
 */
function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Block localhost variants
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h === "[::1]"
  ) {
    return true;
  }

  // Block cloud metadata endpoints
  if (h === "169.254.169.254" || h === "metadata.google.internal") {
    return true;
  }

  // Block private IPv4 ranges
  if (isPrivateIP(h)) {
    return true;
  }

  // Block IPv6 private/reserved ranges
  // Strip brackets from IPv6 literals (URL parser may include them)
  const ipv6 = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;

  // Block IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ipv6.includes("::ffff:")) {
    const mapped = ipv6.split("::ffff:")[1];
    if (mapped) {
      // May be dotted notation (::ffff:127.0.0.1) or hex (::ffff:7f00:1)
      if (mapped.includes(".")) {
        if (isPrivateIP(mapped)) return true;
      } else {
        // Convert hex pairs to IPv4 and check
        const hexParts = mapped.split(":");
        if (hexParts.length === 2) {
          const high = parseInt(hexParts[0], 16);
          const low = parseInt(hexParts[1], 16);
          if (!isNaN(high) && !isNaN(low)) {
            const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
            if (isPrivateIP(ipv4)) return true;
          }
        }
      }
    }
  }

  // Block IPv6 unique local addresses (fc00::/7 = fc00:: through fdff::)
  if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) {
    return true;
  }

  // Block IPv6 link-local (fe80::/10)
  if (ipv6.startsWith("fe80")) {
    return true;
  }

  // Block .local and .internal domains
  if (h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }

  return false;
}

/**
 * Check if a URL targets a private/internal network address.
 * Prevents SSRF attacks via prompt injection.
 */
function isPrivateURL(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true; // Block malformed URLs
  }

  return isPrivateHostname(parsed.hostname);
}

/**
 * Resolve hostname via DNS and check if it points to a private IP.
 * Prevents DNS rebinding attacks where a public domain resolves to a private IP.
 */
async function resolveAndValidate(hostname: string): Promise<void> {
  // Skip DNS check for IP literals (already checked by isPrivateHostname)
  const isIPLiteral =
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname.startsWith("[") ||
    hostname.includes(":");
  if (isIPLiteral) return;

  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(
        "Hostname resolves to a private/internal network address",
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("private/internal")) {
      throw err;
    }
    // DNS resolution failure - let fetch handle it
  }
}

/**
 * Read response body with a streaming size limit to prevent memory exhaustion
 * from servers that don't send Content-Length headers.
 */
async function readResponseBodyWithLimit(
  response: Response,
  maxSize: number,
): Promise<ArrayBuffer> {
  // Check content-length header first for early rejection
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > maxSize) {
    throw new Error("Response too large (exceeds 5MB limit)");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // Fallback if body stream is unavailable
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxSize) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.byteLength;
      if (totalSize > maxSize) {
        try {
          await reader.cancel();
        } catch {
          /* ignore cancel errors */
        }
        throw new Error("Response too large (exceeds 5MB limit)");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

/**
 * Follow redirects manually, validating each target against SSRF blocklist.
 */
async function fetchWithRedirectValidation(
  url: string,
  options: RequestInit,
): Promise<Response> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await fetch(currentUrl, {
      ...options,
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    const redirectUrl = new URL(location, currentUrl).href;
    if (isPrivateURL(redirectUrl)) {
      throw new Error(
        "Redirect to private/internal network address is not allowed",
      );
    }

    // Validate DNS of redirect target
    const redirectParsed = new URL(redirectUrl);
    await resolveAndValidate(redirectParsed.hostname);

    currentUrl = redirectUrl;
    redirectCount++;
  }

  throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`);
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  return `${text.slice(0, MAX_OUTPUT_LENGTH)}\n<!-- content truncated at ${MAX_OUTPUT_LENGTH} characters -->`;
}

const DESCRIPTION = `
Fetches content from a URL and returns it in the requested format.

**When to use:**
- Fetch documentation, blog posts, or web content
- Retrieve API responses or JSON data
- Download HTML pages for parsing

**Format options:**
- markdown: Converts HTML to markdown (default)
- text: Extracts plain text from HTML
- html: Returns raw HTML

**Important:**
- URLs must start with http:// or https://
- Maximum response size: 5MB
- Default timeout: 30 seconds (max: 120 seconds)
- Images are returned as base64-encoded data URLs

**Examples:**

<example>
Fetch documentation as markdown:
{ "url": "https://example.com/docs", "format": "markdown" }
</example>

<example>
Fetch API response:
{ "url": "https://api.example.com/data", "format": "text" }
</example>
`;

/**
 * Abort helper to handle timeout and manual abort
 */
function createAbortSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; clearTimeout: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Forward external abort signal if provided
  externalSignal?.addEventListener("abort", () => controller.abort());

  return {
    signal: controller.signal,
    clearTimeout: () => clearTimeout(timeout),
  };
}

/**
 * Remove script, style, and other non-content tags from HTML.
 */
function stripDangerousTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "");
}

/**
 * Extract text from HTML by removing script/style tags and extracting text content.
 * Order: strip tags first, then decode entities (output is text for AI agent, not browser).
 */
function extractTextFromHTML(html: string): string {
  let text = stripDangerousTags(html);

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode HTML entities AFTER tag stripping
  text = decodeHTMLEntities(text);

  // Collapse whitespace and trim
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Convert HTML to markdown.
 * Order: strip dangerous tags, convert structural tags, decode entities last.
 * The output is text for an AI agent, not rendered in a browser, so XSS is not a concern.
 */
function convertHTMLToMarkdown(html: string): string {
  let markdown = html;

  // Remove script, style, meta, link tags
  markdown = stripDangerousTags(markdown);
  markdown = markdown.replace(/<meta[^>]*>/gi, "").replace(/<link[^>]*>/gi, "");

  // Convert headings (with dotall flag for multiline content)
  markdown = markdown.replace(
    /<h1[^>]*>(.*?)<\/h1>/gis,
    (_, content) => `\n# ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h2[^>]*>(.*?)<\/h2>/gis,
    (_, content) => `\n## ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h3[^>]*>(.*?)<\/h3>/gis,
    (_, content) => `\n### ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h4[^>]*>(.*?)<\/h4>/gis,
    (_, content) => `\n#### ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h5[^>]*>(.*?)<\/h5>/gis,
    (_, content) => `\n##### ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h6[^>]*>(.*?)<\/h6>/gis,
    (_, content) => `\n###### ${content.trim()}\n`,
  );

  // Convert bold and italic (with dotall flag)
  markdown = markdown.replace(
    /<(strong|b)[^>]*>(.*?)<\/\1>/gis,
    (_, __, content) => `**${content}**`,
  );
  markdown = markdown.replace(
    /<(em|i)[^>]*>(.*?)<\/\1>/gis,
    (_, __, content) => `*${content}*`,
  );

  // Convert code: handle <pre><code>...</code></pre> first to avoid double-escaping
  markdown = markdown.replace(
    /<pre[^>]*>\s*<code[^>]*>(.*?)<\/code>\s*<\/pre>/gis,
    (_, content) => `\n\`\`\`\n${content.trim()}\n\`\`\`\n`,
  );
  markdown = markdown.replace(
    /<pre[^>]*>(.*?)<\/pre>/gis,
    (_, content) => `\n\`\`\`\n${content.trim()}\n\`\`\`\n`,
  );
  markdown = markdown.replace(
    /<code[^>]*>(.*?)<\/code>/gis,
    (_, content) => `\`${content}\``,
  );

  // Convert links (with dotall flag)
  markdown = markdown.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gis,
    (_, href, text) => `[${text}](${href})`,
  );

  // Convert images
  markdown = markdown.replace(
    /<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi,
    (_, src, alt) => `![${alt}](${src})`,
  );
  markdown = markdown.replace(
    /<img[^>]*src=["']([^"']*)["'][^>]*>/gi,
    (_, src) => `![](${src})`,
  );

  // Convert lists (with dotall flag for li)
  markdown = markdown.replace(/<ul[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/ul>/gi, "\n");
  markdown = markdown.replace(/<ol[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/ol>/gi, "\n");
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gis, (_, content) => {
    return `- ${content.trim()}\n`;
  });

  // Convert paragraphs and line breaks
  markdown = markdown.replace(/<p[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/p>/gi, "\n");
  markdown = markdown.replace(/<br[^>]*>/gi, "\n");

  // Convert horizontal rules
  markdown = markdown.replace(/<hr[^>]*>/gi, "\n---\n");

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, "");

  // Decode HTML entities AFTER tag conversion
  markdown = decodeHTMLEntities(markdown);

  // Clean up excessive newlines
  markdown = markdown.replace(/\n{3,}/g, "\n\n");

  return markdown.trim();
}

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  defaultConsent: "ask",

  // web_fetch runs locally (no engine API) so it does not require Dyad Pro
  getConsentPreview: (args) => `Fetch URL: "${args.url}" as ${args.format}`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;

    let xml = `<dyad-web-fetch>${escapeXmlContent(args.url)}`;
    if (isComplete) {
      xml += "</dyad-web-fetch>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing web fetch: ${args.url} (format: ${args.format})`);

    // Validate URL
    if (!args.url.startsWith("http://") && !args.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://");
    }

    // Block private/internal network addresses to prevent SSRF
    if (isPrivateURL(args.url)) {
      throw new Error(
        "Access to private/internal network addresses is not allowed",
      );
    }

    // Resolve DNS and validate against private IP ranges to prevent DNS rebinding
    const parsed = new URL(args.url);
    await resolveAndValidate(parsed.hostname);

    const timeout = Math.min(
      (args.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000,
      MAX_TIMEOUT,
    );

    const { signal, clearTimeout } = createAbortSignal(timeout);

    // Build Accept header based on requested format
    let acceptHeader = "*/*";
    switch (args.format) {
      case "markdown":
        acceptHeader =
          "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
        break;
      case "text":
        acceptHeader =
          "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
        break;
      case "html":
        acceptHeader =
          "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
        break;
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
    };

    let response: Response;
    let arrayBuffer: ArrayBuffer;
    try {
      // Use manual redirect following with SSRF validation on each hop
      const initial = await fetchWithRedirectValidation(args.url, {
        signal,
        headers,
      });

      // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
      response =
        initial.status === 403 &&
        initial.headers.get("cf-mitigated") === "challenge"
          ? await fetchWithRedirectValidation(args.url, {
              signal,
              headers: { ...headers, "User-Agent": "dyad-agent" },
            })
          : initial;

      if (!response.ok) {
        clearTimeout();
        throw new Error(formatHttpError(response.status, response.statusText));
      }

      // Read response body with streaming size limit.
      // Keep timeout active during body consumption to catch slow-trickle attacks.
      arrayBuffer = await readResponseBodyWithLimit(
        response,
        MAX_RESPONSE_SIZE,
      );

      clearTimeout();
    } catch (error) {
      clearTimeout();
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeout / 1000} seconds`);
      }
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    const mime = contentType.split(";")[0]?.trim().toLowerCase() || "";

    // Check if response is an image
    const isImage =
      mime.startsWith("image/") &&
      mime !== "image/svg+xml" &&
      mime !== "image/vnd.fastbidsheet";

    if (isImage) {
      const base64Content = Buffer.from(arrayBuffer).toString("base64");
      const dataUrl = `data:${mime};base64,${base64Content}`;

      // Add image to user message so model can see it
      ctx.appendUserMessage([
        { type: "text", text: `Image fetched from ${args.url}:` },
        { type: "image-url", url: dataUrl },
      ]);

      logger.log(`Web fetch completed (image): ${args.url}`);
      return "Image fetched successfully and displayed above.";
    }

    const content = new TextDecoder().decode(arrayBuffer);

    // Handle content based on requested format and actual content type
    let result: string;
    switch (args.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          result = convertHTMLToMarkdown(content);
        } else {
          result = content;
        }
        break;

      case "text":
        if (contentType.includes("text/html")) {
          result = extractTextFromHTML(content);
        } else {
          result = content;
        }
        break;

      case "html":
        result = content;
        break;

      default:
        result = content;
    }

    // Truncate output to prevent flooding the conversation
    result = truncateOutput(result);

    logger.log(`Web fetch completed: ${args.url}`);
    return result;
  },
};

/**
 * Map common HTTP status codes to user-friendly error messages.
 */
function formatHttpError(status: number, statusText: string): string {
  switch (status) {
    case 401:
      return `Access denied (401 Unauthorized). The page requires authentication.`;
    case 403:
      return `Access forbidden (403 Forbidden). The site may require authentication or block automated access.`;
    case 404:
      return `Page not found (404). Check that the URL is correct.`;
    case 429:
      return `Too many requests (429). Try again in a moment.`;
    default:
      if (status >= 500) {
        return `Server error (${status} ${statusText}). The website may be experiencing issues.`;
      }
      return `Request failed with status code: ${status} ${statusText}`;
  }
}
