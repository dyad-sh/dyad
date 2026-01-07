import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  escapeXmlContent,
  ToolResultContentPart,
} from "./types";
import { readSettings } from "@/main/settings";

const logger = log.scope("web_crawl");

const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

const webCrawlSchema = z.object({
  url: z.string().describe("URL to crawl"),
});

const webCrawlResponseSchema = z.object({
  rootUrl: z.string(),
  html: z.string().optional(),
  markdown: z.string().optional(),
  screenshot: z.string().optional(),
  pages: z.array(
    z.object({
      url: z.string(),
      markdown: z.string().optional(),
      html: z.string().optional(),
      screenshot: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
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

const IMAGE_PLACEHOLDER_INSTRUCTIONS = `

---

## Instructions for Replicating the Website

You are replicating the website from the provided HTML, markdown, and screenshot.

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

async function callWebCrawl(
  url: string,
): Promise<z.infer<typeof webCrawlResponseSchema>> {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new Error("Dyad Pro API key is required for web_crawl tool");
  }

  const response = await fetch(`${DYAD_ENGINE_URL}/tools/web-crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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

  getConsentPreview: (args) => `Crawl URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;

    let xml = `<dyad-web-crawl>${escapeXmlContent(args.url)}`;
    if (isComplete) {
      xml += "</dyad-web-crawl>";
    }
    return xml;
  },

  execute: async (args) => {
    logger.log(`Executing web crawl: ${args.url}`);

    const result = await callWebCrawl(args.url);

    if (!result) {
      throw new Error("Web crawl returned no results");
    }

    // Build markdown content from the crawl result
    let content = "";

    // Add root page content if available
    if (result.markdown) {
      content += result.markdown;
    }

    // Add content from additional pages
    if (result.pages && result.pages.length > 0) {
      for (const page of result.pages) {
        if (page.markdown) {
          content += `\n\n---\n\n## ${page.url}\n\n${page.markdown}`;
        }
      }
    }

    if (!content) {
      content = "No content extracted from the URL.";
    }

    logger.log(`Web crawl completed for URL: ${args.url}`);

    // Build multi-part result with text and screenshot
    const contentParts: ToolResultContentPart[] = [];

    // Add text content with instructions
    contentParts.push({
      type: "text",
      text: content + IMAGE_PLACEHOLDER_INSTRUCTIONS,
    });

    // Include screenshot as a proper image content part if available
    if (result.screenshot) {
      try {
        // Fetch the screenshot URL and convert to base64
        const imageResponse = await fetch(result.screenshot);
        if (imageResponse.ok) {
          const arrayBuffer = await imageResponse.arrayBuffer();
          const base64Data = Buffer.from(arrayBuffer).toString("base64");
          const contentType =
            imageResponse.headers.get("content-type") || "image/png";
          contentParts.push({
            type: "media",
            data: base64Data,
            mediaType: contentType,
          });
        } else {
          logger.warn(
            `Failed to fetch screenshot: ${imageResponse.status} ${imageResponse.statusText}`,
          );
        }
      } catch (error) {
        logger.warn(`Error fetching screenshot: ${error}`);
      }
    }

    return { content: contentParts };
  },
};
