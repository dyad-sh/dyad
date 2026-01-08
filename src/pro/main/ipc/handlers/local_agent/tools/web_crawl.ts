import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent } from "./types";
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

Replicate the website from the provided HTML, markdown, and screenshot.

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

  execute: async (args, ctx) => {
    logger.log(`Executing web crawl: ${args.url}`);

    const result = await callWebCrawl(args.url);

    if (!result) {
      throw new Error("Web crawl returned no results");
    }

    if (!result.markdown) {
      throw new Error("No content available from web crawl");
    }

    if (!result.html) {
      throw new Error("No HTML available from web crawl");
    }
    if (!result.screenshot) {
      throw new Error("No screenshot available from web crawl");
    }
    logger.log(`Web crawl completed for URL: ${args.url}`);

    ctx.appendUserMessage([
      { type: "text", text: CLONE_INSTRUCTIONS },
      { type: "image-url", url: result.screenshot },
      {
        type: "text",
        text: formatSnippet("Markdown snapshot:", result.markdown, "markdown"),
      },
      {
        type: "text",
        text: formatSnippet("HTML snapshot:", result.html, "html"),
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
