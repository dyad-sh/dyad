import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  runTypeScriptCheck,
  getTypeCheckPreconditionGuidance,
  getTypeCheckPreconditionKind,
} from "@/ipc/processors/tsc";
import type { Problem, ProblemReport } from "@/ipc/types";
import { safeSend } from "@/ipc/utils/safe_sender";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";

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
function formatProblemLines(problems: Problem[]): string {
  return problems
    .map((p) => `${p.file}:${p.line}:${p.column}: ${p.message}`)
    .join("\n");
}

function pluralizeErrors(count: number): string {
  return `${count} type error${count === 1 ? "" : "s"}`;
}

function formatProblems({
  allProblems,
  matchingProblems,
  paths,
}: {
  allProblems: Problem[];
  matchingProblems: Problem[];
  paths?: string[];
}): string {
  if (!paths || paths.length === 0) {
    if (allProblems.length === 0) {
      return "No type errors found.";
    }

    return `Found ${pluralizeErrors(allProblems.length)}:\n\n${formatProblemLines(allProblems)}`;
  }

  const scope = paths.length === 1 ? `\`${paths[0]}\`` : "the requested paths";
  const outsideCount = allProblems.length - matchingProblems.length;

  if (matchingProblems.length === 0) {
    if (outsideCount === 0) {
      return `No type errors found in ${scope}.`;
    }

    return `No type errors found in ${scope}, but the project has ${pluralizeErrors(outsideCount)} outside this scope.`;
  }

  const matchingResult = `Found ${pluralizeErrors(matchingProblems.length)} in ${scope}:\n\n${formatProblemLines(matchingProblems)}`;
  if (outsideCount === 0) {
    return matchingResult;
  }

  return `${matchingResult}\n\nThe project also has ${pluralizeErrors(outsideCount)} outside this scope.`;
}

function formatIncompleteTypeCheck(problems: Problem[]): string {
  const details = formatProblemLines(problems);

  return `Type checking could not complete because TypeScript rejected the project configuration:\n\n${details}\n\nFix the configuration error, then rerun \`run_type_checks\`. Do not report type checking as successful until it passes.`;
}

function getOutcome(problemReport: ProblemReport) {
  return (
    problemReport.outcome ??
    (problemReport.problems.length === 0 ? "passed" : "errors")
  );
}

function getCompletedTitle(
  outcome: "passed" | "errors" | "incomplete",
): string {
  if (outcome === "incomplete") {
    return "Type check incomplete";
  }

  if (outcome === "errors") {
    return "Type errors found";
  }

  return "Type check passed";
}

export const runTypeChecksTool: ToolDefinition<
  z.infer<typeof runTypeChecksSchema>
> = {
  name: "run_type_checks",
  description: `Run TypeScript type checks on the current workspace. You can provide paths to specific files or directories, or omit the argument to get diagnostics for all files.

- If a file path is provided, returns diagnostics for that file and discloses whether the project has errors elsewhere
- If a directory path is provided, returns diagnostics for that directory and discloses whether the project has errors elsewhere
- If no path is provided, returns diagnostics for all files in the workspace
- Project configuration errors are always returned because they can prevent the requested files from being checked
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

    let problemReport: ProblemReport;
    try {
      problemReport = await runTypeScriptCheck({ appPath: ctx.appPath });
    } catch (error) {
      if (!isDyadError(error) || error.kind !== DyadErrorKind.Precondition) {
        throw error;
      }

      const preconditionKind = getTypeCheckPreconditionKind(error);
      if (!preconditionKind) {
        throw error;
      }

      const result = await getTypeCheckPreconditionGuidance({
        kind: preconditionKind,
        appPath: ctx.appPath,
        includeAgentInstructions: true,
      });

      safeSend(ctx.event.sender, "agent-tool:problems-update", {
        appId: ctx.appId,
        problems: { problems: [] },
      });

      ctx.onXmlComplete(
        `<dyad-output type="warning" message="${escapeXmlAttr("Type checking unavailable")}">\n${escapeXmlContent(result)}\n</dyad-output>`,
      );

      return result;
    }

    // Send the full problem report to update the Problems panel in the UI
    safeSend(ctx.event.sender, "agent-tool:problems-update", {
      appId: ctx.appId,
      problems: problemReport,
    });

    const outcome = getOutcome(problemReport);
    const allProblems = problemReport.problems;
    let matchingProblems = allProblems;

    // Filter by paths if specified
    if (args.paths && args.paths.length > 0) {
      matchingProblems = allProblems.filter((p) =>
        matchesPaths(p.file, args.paths!),
      );
    }

    const result =
      outcome === "incomplete"
        ? formatIncompleteTypeCheck(allProblems)
        : formatProblems({
            allProblems,
            matchingProblems,
            paths: args.paths,
          });
    const completedTitle = getCompletedTitle(outcome);
    const completedState = outcome === "incomplete" ? "warning" : "finished";

    // Complete XML with result
    ctx.onXmlComplete(
      `<dyad-status title="${escapeXmlAttr(completedTitle)}" state="${completedState}">\n${escapeXmlContent(result)}\n</dyad-status>`,
    );

    return result;
  },
};
