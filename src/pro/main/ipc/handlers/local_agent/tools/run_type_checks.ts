import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { generateProblemReport } from "@/ipc/processors/tsc";
import type { Problem } from "@/ipc/types";
import { safeSend } from "@/ipc/utils/safe_sender";

import { normalizePath } from "../../../../../../../shared/normalizePath";

const runTypeChecksSchema = z.object({
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Optional. An array of paths to files or directories to read type errors for. If provided, returns diagnostics for the specified files/directories only. If not provided, returns diagnostics for all files in the workspace.",
    ),
});

/**
 * Check if a problem file matches any of the specified paths.
 * Matches if the problem file equals the path (file match) or
 * starts with the path followed by a separator (directory match).
 */
function matchesPaths(problemFile: string, paths: string[]): boolean {
  // Normalize the problem file path (convert backslashes and remove leading ./)
  const normalizedProblemFile = normalizePath(problemFile).replace(/^\.\//, "");

  for (const targetPath of paths) {
    // Normalize target path (convert backslashes, remove leading ./ and trailing /)
    const normalizedTarget = normalizePath(targetPath)
      .replace(/^\.\//, "")
      .replace(/\/$/, "");

    // Exact file match
    if (normalizedProblemFile === normalizedTarget) {
      return true;
    }

    // Directory prefix match (problem file is inside the target directory)
    if (normalizedProblemFile.startsWith(normalizedTarget + "/")) {
      return true;
    }
  }

  return false;
}

/**
 * Format problems into a readable text output for the agent.
 */
function formatProblems(problems: Problem[]): string {
  if (problems.length === 0) {
    return "No type errors found.";
  }

  const lines = problems.map(
    (p) => `${p.file}:${p.line}:${p.column}: ${p.message}`,
  );

  return `Found ${problems.length} type error(s):\n\n${lines.join("\n")}`;
}

export const runTypeChecksTool: ToolDefinition<
  z.infer<typeof runTypeChecksSchema>
> = {
  name: "run_type_checks",
  description: `Run TypeScript type checks on the current workspace. You can provide paths to specific files or directories, or omit the argument to get diagnostics for all files.

- If a file path is provided, returns diagnostics for that file only
- If a directory path is provided, returns diagnostics for all files within that directory
- If no path is provided, returns diagnostics for all files in the workspace
- This tool can return type errors that were already present before your edits, so avoid calling it with a very wide scope of files
- NEVER call this tool on a file unless you've edited it or are about to edit it`,
  inputSchema: runTypeChecksSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    args.paths && args.paths.length > 0
      ? `Check types for: ${args.paths.join(", ")}`
      : "Check types for all files",

  execute: async (args, ctx: AgentContext) => {
    // Stream initial XML with in-progress state
    const title =
      args.paths && args.paths.length > 0
        ? `Type checking: ${args.paths.join(", ")}`
        : "Type checking all files";
    ctx.onXmlStream(
      `<dyad-status title="${escapeXmlAttr(title)}"></dyad-status>`,
    );

    // Run TypeScript type checking using existing infrastructure
    const problemReport = await generateProblemReport({
      fullResponse: "",
      appPath: ctx.appPath,
    });

    // Send the full problem report to update the Problems panel in the UI
    safeSend(ctx.event.sender, "agent-tool:problems-update", {
      appId: ctx.appId,
      problems: problemReport,
    });

    let problems = problemReport.problems;

    // Filter by paths if specified
    if (args.paths && args.paths.length > 0) {
      problems = problems.filter((p) => matchesPaths(p.file, args.paths!));
    }

    const result = formatProblems(problems);

    // Complete XML with result
    ctx.onXmlComplete(
      `<dyad-status title="${escapeXmlAttr(title)}">\n${escapeXmlContent(result)}\n</dyad-status>`,
    );

    return result;
  },
};
