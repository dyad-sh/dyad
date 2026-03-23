import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";
import { engineFetch } from "./engine_fetch";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_fetch");

function validateHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DyadError(`Invalid URL: ${url}`, DyadErrorKind.Validation);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`,
    );
  }
}

const MAX_CONTENT_LENGTH = 80_000;

function truncateContent(value: string): string {
  if (value.length <= MAX_CONTENT_LENGTH) return value;
  return `${value.slice(0, MAX_CONTENT_LENGTH)}\n\n<!-- truncated -->`;
}

const webFetchSchema = z.object({
  url: z.string().describe("URL to fetch content from"),
});

const webFetchResponseSchema = z.object({
  rootUrl: z.string(),
  markdown: z.string().optional(),
  pages: z.array(
    z.object({
      url: z.string(),
      markdown: z.string(),
    }),
  ),
});

const DESCRIPTION = `Fetch and read the content of a web page as markdown given its URL.

### When to Use This Tool
Use this tool when the user's message contains a URL (or domain name) and they want to:
- **Read** the page's content (e.g. documentation, blog post, article)
- **Reference** information from the page (e.g. API docs, tutorials, guides)
- **Extract** data or context from a live web page to inform their code
- **Follow a link** someone shared to understand its contents

Examples:
- "Use the docs at docs.example.com/api to set up the client"
- "What does this page say? https://example.com/blog/post"
- "Follow the guide at example.com/tutorial"

### When NOT to Use This Tool
- The user wants to **visually clone or replicate** a website → use \`web_crawl\` instead
- The user needs to **search the web** for information without a specific URL → use \`web_search\` instead
`;

async function callWebFetch(
  url: string,
  ctx: Pick<AgentContext, "dyadRequestId">,
): Promise<z.infer<typeof webFetchResponseSchema>> {
  const response = await engineFetch(ctx, "/tools/web-crawl", {
    method: "POST",
    body: JSON.stringify({ url, markdownOnly: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Web fetch failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = webFetchResponseSchema.parse(await response.json());
  return data;
}

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  defaultConsent: "always",

  // Requires Dyad Pro engine API
  isEnabled: (ctx) => ctx.isDyadPro,

  getConsentPreview: (args) => `Fetch URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;
    // When complete, return undefined so execute's onXmlComplete provides the final XML
    if (isComplete) return undefined;
    return `<dyad-web-fetch>${escapeXmlContent(args.url)}`;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web fetch: ${args.url}`);

    validateHttpUrl(args.url);

    ctx.onXmlStream(`<dyad-web-fetch>${escapeXmlContent(args.url)}`);

    try {
      const result = await callWebFetch(args.url, ctx);

      if (!result) {
        throw new DyadError(
          "Web fetch returned no results",
          DyadErrorKind.NotFound,
        );
      }

      // Combine markdown from all pages
      const allContent = result.pages
        .map((page) => `## ${page.url}\n\n${page.markdown}`)
        .join("\n\n---\n\n");

      if (!allContent) {
        throw new DyadError(
          "No content available from web fetch",
          DyadErrorKind.NotFound,
        );
      }

      logger.log(
        `Web fetch completed for URL: ${args.url} (${result.pages.length} pages)`,
      );

      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );

      return truncateContent(allContent);
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );
      throw error;
    }
  },
};
