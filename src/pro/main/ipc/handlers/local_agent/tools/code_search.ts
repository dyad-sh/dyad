import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";
import { engineFetch } from "./engine_fetch";

const logger = log.scope("code_search");

const codeSearchSchema = z.object({
  query: z.string().describe("Search query to find relevant files"),
});

const FileContextSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const codeSearchResponseSchema = z.object({
  relevantFiles: z.array(z.string()).describe("Paths of relevant files"),
});

async function callCodeSearch(
  params: {
    query: string;
    filesContext: z.infer<typeof FileContextSchema>[];
  },
  ctx: AgentContext,
): Promise<string[]> {
  // Stream initial state to UI
  ctx.onXmlStream(`<dyad-code-search query="${escapeXmlAttr(params.query)}">`);

  const response = await engineFetch(ctx, "/tools/code-search", {
    method: "POST",
    body: JSON.stringify({
      query: params.query,
      filesContext: params.filesContext,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Code search failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = codeSearchResponseSchema.parse(await response.json());
  return data.relevantFiles;
}

const DESCRIPTION = `Search the codebase semantically to find files relevant to a query. Use this tool when you need to discover which files contain code related to a specific concept, feature, or functionality. Returns a list of file paths that are most relevant to the search query.

### When to Use This Tool

- Explore unfamiliar codebases
- Ask "how / where / what" questions to understand behavior
- Find code by meaning rather than exact text

### When NOT to Use

Skip this tool for:
1. Exact text matches (use \`grep\`)
2. Reading known files (use \`read_file\`)
3. Simple symbol lookups (use \`grep\`)
`;

export const codeSearchTool: ToolDefinition<z.infer<typeof codeSearchSchema>> =
  {
    name: "code_search",
    description: DESCRIPTION,
    inputSchema: codeSearchSchema,
    defaultConsent: "always",

    // Requires Dyad Pro engine API
    isEnabled: (ctx) => ctx.isDyadPro,

    getConsentPreview: (args) => `Search for "${args.query}"`,

    buildXml: (args, isComplete) => {
      if (!args.query) return undefined;
      if (isComplete) return undefined;
      return `<dyad-code-search query="${escapeXmlAttr(args.query)}">Searching...`;
    },

    execute: async (args, ctx: AgentContext) => {
      logger.log(`Executing code search: ${args.query}`);

      // Gather all files from the project
      const { files } = await extractCodebase({
        appPath: ctx.appPath,
        chatContext: {
          contextPaths: [],
          smartContextAutoIncludes: [],
          excludePaths: [],
        },
      });

      // Map files to FileContext format
      const filesContext = files.map((file) => ({
        path: file.path,
        content: file.content,
      }));

      logger.log(
        `Searching ${filesContext.length} files for query: "${args.query}"`,
      );

      // Call the code-search endpoint
      const relevantFiles = await callCodeSearch(
        {
          query: args.query,
          filesContext,
        },
        ctx,
      );

      // Format results
      const resultText =
        relevantFiles.length === 0
          ? "No relevant files found."
          : relevantFiles.map((f) => ` - ${f}`).join("\n");

      // Write final result to UI and DB with dyad-code-search wrapper
      ctx.onXmlComplete(
        `<dyad-code-search query="${escapeXmlAttr(args.query)}">${escapeXmlContent(resultText)}</dyad-code-search>`,
      );

      logger.log(`Code search completed for query: ${args.query}`);

      if (relevantFiles.length === 0) {
        return "No relevant files found for the given query.";
      }

      return `Found ${relevantFiles.length} relevant file(s):\n${resultText}`;
    },
  };
