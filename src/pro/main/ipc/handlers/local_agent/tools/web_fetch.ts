import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";

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
    .optional()
    .describe("Optional timeout in seconds (max 120)"),
});

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

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

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  ) {
    return true;
  }

  // Block cloud metadata endpoints
  if (
    hostname === "169.254.169.254" ||
    hostname === "metadata.google.internal"
  ) {
    return true;
  }

  // Block private IP ranges
  const parts = hostname.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)
  ) {
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local 169.254.0.0/16
  }

  // Block .local and .internal domains
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return true;
  }

  return false;
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
        await reader.cancel();
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
 * Extract text from HTML by removing script/style tags and extracting text content
 */
function extractTextFromHTML(html: string): string {
  // Decode HTML entities FIRST to prevent XSS bypass via encoded tags
  // (e.g., &lt;script&gt; surviving tag stripping then being decoded)
  let text = decodeHTMLEntities(html);

  // Remove script and style tags and their content
  text = text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "");

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Collapse whitespace and trim
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Convert HTML to markdown
 * This is a basic implementation - for production use consider a library like turndown
 */
function convertHTMLToMarkdown(html: string): string {
  // Decode HTML entities FIRST to prevent XSS bypass via encoded tags
  let markdown = decodeHTMLEntities(html);

  // Remove script, style, meta, link tags
  markdown = markdown
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "");

  // Convert headings
  markdown = markdown.replace(
    /<h1[^>]*>(.*?)<\/h1>/gi,
    (_, content) => `\n# ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h2[^>]*>(.*?)<\/h2>/gi,
    (_, content) => `\n## ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h3[^>]*>(.*?)<\/h3>/gi,
    (_, content) => `\n### ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h4[^>]*>(.*?)<\/h4>/gi,
    (_, content) => `\n#### ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h5[^>]*>(.*?)<\/h5>/gi,
    (_, content) => `\n##### ${content.trim()}\n`,
  );
  markdown = markdown.replace(
    /<h6[^>]*>(.*?)<\/h6>/gi,
    (_, content) => `\n###### ${content.trim()}\n`,
  );

  // Convert bold and italic
  markdown = markdown.replace(
    /<(strong|b)[^>]*>(.*?)<\/\1>/gi,
    (_, __, content) => `**${content}**`,
  );
  markdown = markdown.replace(
    /<(em|i)[^>]*>(.*?)<\/\1>/gi,
    (_, __, content) => `*${content}*`,
  );

  // Convert code
  markdown = markdown.replace(
    /<code[^>]*>(.*?)<\/code>/gi,
    (_, content) => `\`${content}\``,
  );
  markdown = markdown.replace(
    /<pre[^>]*>(.*?)<\/pre>/gis,
    (_, content) => `\n\`\`\`\n${content.trim()}\n\`\`\`\n`,
  );

  // Convert links
  markdown = markdown.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi,
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

  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/ul>/gi, "\n");
  markdown = markdown.replace(/<ol[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/ol>/gi, "\n");
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, content) => {
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

  // Clean up excessive newlines
  markdown = markdown.replace(/\n{3,}/g, "\n\n");

  return markdown.trim();
}

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  defaultConsent: "ask",

  getConsentPreview: (args) => `Fetch URL: "${args.url}" as ${args.format}`,

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
      const initial = await fetch(args.url, { signal, headers });

      // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
      response =
        initial.status === 403 &&
        initial.headers.get("cf-mitigated") === "challenge"
          ? await fetch(args.url, {
              signal,
              headers: { ...headers, "User-Agent": "dyad-agent" },
            })
          : initial;

      if (!response.ok) {
        clearTimeout();
        throw new Error(
          `Request failed with status code: ${response.status} ${response.statusText}`,
        );
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

    logger.log(`Web fetch completed: ${args.url}`);
    return result;
  },
};
