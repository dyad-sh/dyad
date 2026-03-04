import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";
import { engineFetch } from "./engine_fetch";

const logger = log.scope("web_crawl");

export const MAX_WEB_CRAWL_SCREENSHOT_DIMENSION = 8000;
const BASE64_PAYLOAD_RE = /^[A-Za-z0-9+/=]+$/;

const webCrawlSchema = z.object({
  url: z.string().describe("URL to crawl"),
});

export const webCrawlResponseSchema = z.object({
  rootUrl: z.string(),
  html: z.string().optional(),
  markdown: z.string().optional(),
  screenshot: z.string().optional(),
});

const DESCRIPTION = `
You can crawl a website so you can clone it.

### When You MUST Trigger a Crawl
Trigger a crawl ONLY if BOTH conditions are true:

1. The user's message shows intent to CLONE / COPY / REPLICATE / RECREATE / DUPLICATE / MIMIC a website.
   - Keywords include: clone, copy, replicate, recreate, duplicate, mimic, build the same, make the same.

2. The user's message contains a URL or something that appears to be a domain name.
   - e.g. "example.com", "https://example.com"
   - Do not require 'http://' or 'https://'.
`;

const CLONE_INSTRUCTIONS = `

Replicate the website from the provided screenshot image and markdown.

**Use the screenshot as your primary visual reference** to understand the layout, colors, typography, and overall design of the website. The screenshot shows exactly how the page should look.

**IMPORTANT: Image Handling**
- Do NOT use or reference real external image URLs.
- Instead, create a file named "placeholder.svg" at "/public/assets/placeholder.svg".
- The file must be included in the output as its own code block.
- The SVG should be a simple neutral gray rectangle, like:
  \`\`\`svg
  <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#e2e2e2"/>
  </svg>
  \`\`\`

**When generating code:**
- Replace all \`<img src="...">\` with: \`<img src="/assets/placeholder.svg" alt="placeholder" />\`
- If using Next.js Image component: \`<Image src="/assets/placeholder.svg" alt="placeholder" width={400} height={300} />\`

Always include the placeholder.svg file in your output file tree.
`;

type ImageDimensions = {
  width: number;
  height: number;
};

function extractBase64Payload(screenshot: string): string | null {
  if (screenshot.startsWith("data:")) {
    const commaIndex = screenshot.indexOf(",");
    if (commaIndex < 0) {
      return null;
    }

    const metadata = screenshot.slice(5, commaIndex).toLowerCase();
    if (!metadata.includes("base64")) {
      return null;
    }

    return screenshot.slice(commaIndex + 1);
  }

  // Some crawl responses may return raw base64 data instead of a data URL.
  if (screenshot.includes("://")) {
    return null;
  }

  return screenshot.trim();
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  if (
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    return null;
  }
  if (buffer.readUInt32BE(12) !== 0x49484452 || buffer.readUInt32BE(8) !== 13) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    return null;
  }

  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }
    const marker = buffer[offset + 1];
    offset += 2;

    if (offset + 2 > buffer.length) {
      return null;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      return null;
    }
    if (marker === 0xda) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isStartOfFrame =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;
    if (isStartOfFrame) {
      if (offset + 7 > buffer.length) {
        return null;
      }
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readGifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
    return null;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1,
      height: (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1,
    };
  }
  if (chunkType === "VP8 ") {
    if (buffer.length < 30) return null;
    // VP8 lossy bitstream: frame header starts at offset 20, dimensions at 26-29
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunkType === "VP8L") {
    if (buffer.length < 25) return null;
    // VP8L lossless: signature byte at 21, then 32-bit packed dimensions
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function getWebCrawlImageDimensions(
  screenshot: string,
): ImageDimensions | null {
  const base64Payload = extractBase64Payload(screenshot);
  if (!base64Payload) {
    return null;
  }

  const normalizedPayload = base64Payload.replace(/\s/g, "");
  if (!BASE64_PAYLOAD_RE.test(normalizedPayload)) {
    return null;
  }

  try {
    const buffer = Buffer.from(normalizedPayload, "base64");
    return (
      readPngDimensions(buffer) ||
      readJpegDimensions(buffer) ||
      readGifDimensions(buffer) ||
      readWebpDimensions(buffer)
    );
  } catch (e) {
    logger.warn("Failed to decode base64 screenshot payload", e);
    return null;
  }
}

export function getWebCrawlScreenshotOmissionReason(
  screenshot: string,
): string | null {
  const dimensions = getWebCrawlImageDimensions(screenshot);
  if (!dimensions) return null;

  if (
    dimensions.width > MAX_WEB_CRAWL_SCREENSHOT_DIMENSION ||
    dimensions.height > MAX_WEB_CRAWL_SCREENSHOT_DIMENSION
  ) {
    return `The crawl screenshot (${dimensions.width}x${dimensions.height}) exceeds the supported vision input limit of ${MAX_WEB_CRAWL_SCREENSHOT_DIMENSION}px on at least one axis.`;
  }

  return null;
}

async function callWebCrawl(
  url: string,
  ctx: Pick<AgentContext, "dyadRequestId">,
): Promise<z.infer<typeof webCrawlResponseSchema>> {
  const response = await engineFetch(ctx, "/tools/web-crawl", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Web crawl failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = webCrawlResponseSchema.parse(await response.json());
  return data;
}

export const webCrawlTool: ToolDefinition<z.infer<typeof webCrawlSchema>> = {
  name: "web_crawl",
  description: DESCRIPTION,
  inputSchema: webCrawlSchema,
  defaultConsent: "ask",

  // Requires Dyad Pro engine API
  isEnabled: (ctx) => ctx.isDyadPro,

  getConsentPreview: (args) => `Crawl URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;

    let xml = `<dyad-web-crawl>${escapeXmlContent(args.url)}`;
    if (isComplete) {
      xml += "</dyad-web-crawl>";
    }
    return xml;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web crawl: ${args.url}`);

    const result = await callWebCrawl(args.url, ctx);

    if (!result) {
      throw new Error("Web crawl returned no results");
    }

    if (!result.markdown) {
      throw new Error("No content available from web crawl");
    }

    if (!result.screenshot) {
      throw new Error("No screenshot available from web crawl");
    }

    const screenshotOmissionReason = getWebCrawlScreenshotOmissionReason(
      result.screenshot,
    );
    if (screenshotOmissionReason) {
      logger.warn(
        `Omitting oversize web crawl screenshot for ${args.url}: ${screenshotOmissionReason}`,
      );
    }

    logger.log(`Web crawl completed for URL: ${args.url}`);

    type ScreenshotContentPart =
      | { type: "image-url"; url: string }
      | { type: "text"; text: string };
    const screenshotContent: ScreenshotContentPart[] = screenshotOmissionReason
      ? [
          {
            type: "text",
            text: `Screenshot omitted from crawl result: ${screenshotOmissionReason}`,
          },
        ]
      : [{ type: "image-url", url: result.screenshot }];

    ctx.appendUserMessage([
      { type: "text", text: CLONE_INSTRUCTIONS },
      ...screenshotContent,
      {
        type: "text",
        text: formatSnippet("Markdown snapshot:", result.markdown, "markdown"),
      },
    ]);

    return "Web crawl completed.";
  },
};

const MAX_TEXT_SNIPPET_LENGTH = 16_000;

// Format a code snippet with a label and language, truncating if necessary.
export function formatSnippet(
  label: string,
  value: string,
  lang: string,
): string {
  return `${label}:\n\`\`\`${lang}\n${truncateText(value)}\n\`\`\``;
}

function truncateText(value: string): string {
  if (value.length <= MAX_TEXT_SNIPPET_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_SNIPPET_LENGTH)}\n<!-- truncated -->`;
}
