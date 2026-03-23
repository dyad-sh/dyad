import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";
import { engineFetch } from "./engine_fetch";
import {
  getImageDimensionsFromDataUrl,
  isImageTooLarge,
  MAX_IMAGE_DIMENSION,
} from "./image_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_crawl");

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

const CLONE_INSTRUCTIONS_WITH_SCREENSHOT = `

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

const CLONE_INSTRUCTIONS_WITHOUT_SCREENSHOT = `

Replicate the website from the provided markdown snapshot.

**Use the markdown snapshot below as your reference** to understand the page structure, content, and layout of the website.

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
      throw new DyadError(
        "Web crawl returned no results",
        DyadErrorKind.External,
      );
    }

    if (!result.markdown) {
      throw new DyadError(
        "No content available from web crawl",
        DyadErrorKind.External,
      );
    }

    if (!result.screenshot) {
      throw new DyadError(
        "No screenshot available from web crawl",
        DyadErrorKind.External,
      );
    }
    logger.log(`Web crawl completed for URL: ${args.url}`);

    // Check image dimensions before sending to LLM
    const imageDimensions = getImageDimensionsFromDataUrl(result.screenshot);
    const imageExceedsSizeLimit =
      imageDimensions && isImageTooLarge(imageDimensions);

    if (imageExceedsSizeLimit) {
      logger.warn(
        `Screenshot dimensions (${imageDimensions.width}x${imageDimensions.height}) exceed max allowed size (${MAX_IMAGE_DIMENSION}px). Omitting image.`,
      );
    }

    const includeScreenshot = !imageExceedsSizeLimit;
    const instructions = includeScreenshot
      ? CLONE_INSTRUCTIONS_WITH_SCREENSHOT
      : CLONE_INSTRUCTIONS_WITHOUT_SCREENSHOT;

    const messageContent: Parameters<typeof ctx.appendUserMessage>[0] = [
      { type: "text", text: instructions },
    ];

    if (includeScreenshot) {
      // Add the screenshot image
      messageContent.push({ type: "image-url", url: result.screenshot });
    } else {
      // Add explanation instead of the image
      messageContent.push({
        type: "text",
        text: `[Screenshot omitted: Image dimensions (${imageDimensions!.width}x${imageDimensions!.height}px) exceed the maximum allowed size of ${MAX_IMAGE_DIMENSION}px. Please rely on the markdown snapshot below to understand the page structure and content.]`,
      });
    }

    messageContent.push({
      type: "text",
      text: formatSnippet("Markdown snapshot:", result.markdown, "markdown"),
    });

    ctx.appendUserMessage(messageContent);

    return "Web crawl completed.";
  },
};

const MAX_TEXT_SNIPPET_LENGTH = 16_000;

// Format a code snippet with a label and language, truncating if necessary.
// Sanitizes triple backticks in content to prevent code block breakout.
export function formatSnippet(
  label: string,
  value: string,
  lang: string,
): string {
  const sanitized = truncateText(value).replace(/```/g, "` ` `");
  return `${label}:\n\`\`\`${lang}\n${sanitized}\n\`\`\``;
}

function truncateText(value: string): string {
  if (value.length <= MAX_TEXT_SNIPPET_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_SNIPPET_LENGTH)}\n<!-- truncated -->`;
}
