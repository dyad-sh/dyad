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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  filterDyadInternalFiles,
  resolveTargetAppPath,
} from "./resolve_app_context";

const logger = log.scope("code_search");

const codeSearchSchema = z.object({
  query: z.string().describe("Search query to find relevant files"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

const FileContextSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const codeSearchResponseSchema = z.object({
  relevantFiles: z.array(z.string()).describe("Paths of relevant files"),
});

type CodeSearchArgs = z.infer<typeof codeSearchSchema>;

function buildCodeSearchAttributes(args: Partial<CodeSearchArgs>) {
  const queryAttr = args.query ? ` query="${escapeXmlAttr(args.query)}"` : "";
  const appNameAttr = args.app_name
    ? ` app_name="${escapeXmlAttr(args.app_name)}"`
    : "";
  return `${queryAttr}${appNameAttr}`;
}

async function callCodeSearch(
  params: {
    query: string;
    app_name?: string;
    filesContext: z.infer<typeof FileContextSchema>[];
  },
  ctx: AgentContext,
): Promise<string[]> {
  // Stream initial state to UI
  ctx.onXmlStream(
    `<dyad-code-search${buildCodeSearchAttributes({
      query: params.query,
      app_name: params.app_name,
    })}>`,
  );

  const response = await engineFetch(ctx, "/tools/code-search", {
    method: "POST",
    body: JSON.stringify({
      query: params.query,
      filesContext: params.filesContext,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new DyadError(
      `Code search failed: ${response.status} ${response.statusText} - ${errorText}`,
      DyadErrorKind.External,
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

export const codeSearchTool: ToolDefinition<CodeSearchArgs> = {
  name: "code_search",
  description: DESCRIPTION,
  inputSchema: codeSearchSchema,
  defaultConsent: "always",

  // Requires Dyad Pro engine API
  isEnabled: (ctx) => ctx.isDyadPro,

  getConsentPreview: (args) =>
    args.app_name
      ? `Search for "${args.query}" (app: ${args.app_name})`
      : `Search for "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-code-search${buildCodeSearchAttributes(args)}>Searching...`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing code search: ${args.query}`);
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    // Gather all files from the project
    const { files } = await extractCodebase({
      appPath: targetAppPath,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
        excludePaths: [],
      },
    });

    const filteredFiles = filterDyadInternalFiles(files, args.app_name);

    // Map files to FileContext format
    const filesContext = filteredFiles.map((file) => ({
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
        app_name: args.app_name,
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
      `<dyad-code-search${buildCodeSearchAttributes(args)}>${escapeXmlContent(resultText)}</dyad-code-search>`,
    );

    logger.log(`Code search completed for query: ${args.query}`);

    if (relevantFiles.length === 0) {
      return "No relevant files found for the given query.";
    }

    return `Found ${relevantFiles.length} relevant file(s):\n${resultText}`;
  },
};
