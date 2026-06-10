import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

import { runCodeExplorer } from "@/ipc/processors/code_explorer";
import type { CodeExplorerResult } from "../../../../../../../shared/code_explorer_types";

export const DEFAULT_MAX_FILES = 5;
export const MAX_FILES = 8;
export const DEFAULT_MAX_DEPTH = 2;
export const MAX_DEPTH = 3;

const exploreCodeBaseSchema = z.object({
  query: z.string().min(1).describe("Natural-language code exploration query"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to explore instead of the current app. Omit to explore the current app.",
    ),
  tsconfig_path: z
    .string()
    .optional()
    .describe(
      "Optional app-relative path to a TypeScript config file. Omit to use tsconfig.app.json or tsconfig.json.",
    ),
  max_files: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILES)
    .optional()
    .describe(
      `Maximum number of relevant files to return (default: ${DEFAULT_MAX_FILES}, max: ${MAX_FILES}).`,
    ),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(MAX_DEPTH)
    .optional()
    .describe(
      `Graph expansion depth from matching symbols (default: ${DEFAULT_MAX_DEPTH}, max: ${MAX_DEPTH}).`,
    ),
});

export const rawExploreCodeSchema = exploreCodeBaseSchema;

export const exploreCodeSchema = exploreCodeBaseSchema.extend({
  intent: z
    .enum(["explain", "locate", "edit", "debug"])
    .describe(
      "Required. What the result will be used for. Use explain/locate when you will answer or point at code from the map. Use edit/debug when exact ranges will be read before changing code or verifying behavior.",
    ),
});

export type ExploreCodeArgs = z.infer<typeof exploreCodeSchema>;
export type RawExploreCodeArgs = z.infer<typeof rawExploreCodeSchema> & {
  intent?: ExploreCodeArgs["intent"];
};

export function normalizeExploreCodeArgsForApp<
  TArgs extends RawExploreCodeArgs,
>({
  appPath,
  args,
  fallbackTsconfigPath,
}: {
  appPath: string;
  args: TArgs;
  fallbackTsconfigPath?: string | null;
}): TArgs {
  return {
    ...args,
    tsconfig_path:
      validAppRelativeTsconfigPath(appPath, args.tsconfig_path) ??
      validAppRelativeTsconfigPath(appPath, fallbackTsconfigPath) ??
      undefined,
  } as TArgs;
}

function validAppRelativeTsconfigPath(
  appPath: string,
  tsconfigPath?: string | null,
): string | undefined {
  if (!tsconfigPath || path.isAbsolute(tsconfigPath)) {
    return undefined;
  }
  const resolvedPath = path.resolve(appPath, tsconfigPath);
  const appRoot = path.resolve(appPath);
  if (
    resolvedPath !== appRoot &&
    !resolvedPath.startsWith(`${appRoot}${path.sep}`)
  ) {
    return undefined;
  }
  try {
    return fs.statSync(resolvedPath).isFile() ? tsconfigPath : undefined;
  } catch {
    return undefined;
  }
}

export async function runRawExploreCode({
  appPath,
  args,
}: {
  appPath: string;
  args: RawExploreCodeArgs;
}): Promise<CodeExplorerResult> {
  const effectiveArgs = normalizeExploreCodeArgsForApp({ appPath, args });
  return runCodeExplorer({
    appPath,
    query: effectiveArgs.query,
    tsconfigPath: effectiveArgs.tsconfig_path,
    maxFiles: effectiveArgs.max_files ?? DEFAULT_MAX_FILES,
    maxDepth: effectiveArgs.max_depth ?? DEFAULT_MAX_DEPTH,
  });
}

export function formatRawExploreCodeResult(result: CodeExplorerResult): string {
  const lines: string[] = [
    `## Code exploration: ${result.query}`,
    "",
    `Found ${result.totalSymbols} symbols across ${result.totalFiles} files.`,
    `Indexed ${result.indexedFileCount} files in ${result.indexMs}ms; searched in ${result.searchMs}ms.`,
  ];

  if (result.notes.length > 0) {
    lines.push("", ...result.notes.map((note) => `[${note}]`));
  }

  if (result.files.length === 0) {
    lines.push("", "No matching TypeScript symbols found.");
    return lines.join("\n");
  }

  for (const file of result.files) {
    const symbolSummary = file.symbols
      .slice(0, 6)
      .map((symbol) => `${symbol.name} (${symbol.kind}:${symbol.line})`)
      .join(", ");
    lines.push(
      "",
      `#### ${file.path}${symbolSummary ? ` - ${symbolSummary}` : ""}`,
    );

    for (const window of file.windows) {
      lines.push(
        "",
        `Lines ${window.startLine}-${window.endLine}:`,
        "```ts",
        ...window.lines,
        "```",
      );
    }
  }

  return lines.join("\n");
}
