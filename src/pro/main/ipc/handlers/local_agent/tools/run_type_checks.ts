import path from "node:path";
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
import { broadcastToRegisteredWindows } from "@/ipc/utils/window_broadcast";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";

import { normalizePath } from "../../../../../../../shared/normalizePath";

const runTypeChecksSchema = z.object({
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Optional. An array of paths to files or directories to read type errors for, relative to the app root (e.g. 'src/App.tsx' or 'src/lib'). Absolute paths and '.' are resolved against the app root. If provided, returns diagnostics for the specified files/directories only. If not provided, returns diagnostics for all files in the workspace.",
    ),
});

const projectWideRunTypeChecksSchema = z.object({});

const scopedDescription = `Run TypeScript type checks on the current workspace. You can provide paths to specific files or directories, or omit the argument to get diagnostics for all files.

- If a file path is provided, returns diagnostics for that file and discloses whether the project has errors elsewhere
- If a directory path is provided, returns diagnostics for that directory and discloses whether the project has errors elsewhere
- If no path is provided, returns diagnostics for all files in the workspace
- Project configuration errors are always returned because they can prevent the requested files from being checked
- Prefer paths for small, isolated changes so the returned diagnostics stay focused
- Omit paths for final verification after multi-file or cross-cutting changes, or after changing shared types, TypeScript configuration, dependencies, generated types, or global declarations
- Project-wide results may include pre-existing errors; normally focus only on errors introduced by or related to your changes
- If the user explicitly asks to fix all type-check or build problems, omit paths and treat every reported TypeScript diagnostic as in scope. Fix them iteratively and rerun this tool until it passes; use run_build separately to verify build problems
- NEVER request a file path unless you've edited the file or are about to edit it`;

const projectWideDescription = `Run TypeScript type checks on the whole current workspace and return diagnostics for all files.

- Always returns diagnostics for all files in the workspace
- Project configuration errors are always returned because they can prevent files from being checked
- Results may include pre-existing errors; normally act only on errors introduced by or related to your changes unless the user asks for a full cleanup`;

/**
 * Check if a problem file matches any of the specified paths.
 * Matches if the problem file equals the path (file match) or
 * starts with the path followed by a separator (directory match).
 *
 * `problem.file` is always workspace-relative for in-app files (see tsc.ts,
 * which computes it via `path.relative(appPath, …)`), so agent-supplied paths
 * must be expressed in that same workspace-relative form before comparing.
 * Agents occasionally pass an absolute path (e.g. copied from build output)
 * or `.` (a whole-project alias); without resolving those against `appPath`
 * a raw string compare silently misses them and reports the requested file
 * as clean while hiding its real error in the location-less "outside this
 * scope" disclosure. We resolve each target against `appPath` first so all
 * path styles (relative, absolute POSIX/Windows, and `.`) map to the same
 * workspace-relative form as `problem.file` before the equality/prefix check.
 */
function matchesPaths(
  problemFile: string,
  paths: string[],
  appPath: string,
): boolean {
  const normalizedProblemFile = normalizePath(problemFile).replace(/^\.\//, "");

  // Pick the same path semantics tsc.ts uses for this app so resolution and
  // the existing workspace-relative `problem.file` stay consistent.
  const looksLikeWin32Path = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(appPath);
  const pathImpl = looksLikeWin32Path ? path.win32 : path.posix;
  const resolvedAppPath = pathImpl.resolve(appPath);

  for (const targetPath of paths) {
    // Normalize backslashes to forward slashes, then resolve the target
    // against the app root. `path.resolve` treats absolute targets as
    // anchored at the filesystem root and relative targets as app-relative,
    // so both produce an absolute path we can express relative to the app.
    const resolvedTarget = pathImpl.resolve(
      resolvedAppPath,
      normalizePath(targetPath),
    );
    const relative = pathImpl.relative(resolvedAppPath, resolvedTarget);

    // "." or the app root itself selects every problem file.
    if (relative === "" || relative === ".") {
      return true;
    }

    // Targets resolving outside the app root cannot match in-app files.
    // A different Windows drive makes `relative` an absolute path.
    if (
      relative === ".." ||
      relative.startsWith(`..${pathImpl.sep}`) ||
      pathImpl.isAbsolute(relative)
    ) {
      continue;
    }

    const normalizedRelative = normalizePath(relative).replace(/\/$/, "");

    // On Windows, path segments may differ only in casing; compare
    // case-insensitively so that e.g. SRC/foo.ts matches src/foo.ts.
    const cmp = looksLikeWin32Path
      ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
      : (a: string, b: string) => a === b;

    if (cmp(normalizedProblemFile, normalizedRelative)) {
      return true;
    }

    if (
      looksLikeWin32Path
        ? normalizedProblemFile
            .toLowerCase()
            .startsWith(normalizedRelative.toLowerCase() + "/")
        : normalizedProblemFile.startsWith(normalizedRelative + "/")
    ) {
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

  const scope =
    paths.length === 1
      ? `\`${normalizePath(paths[0])}\``
      : "the requested paths";
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
  description: scopedDescription,
  getDescription: (ctx) =>
    ctx.runTypeScriptForWholeProject
      ? projectWideDescription
      : scopedDescription,
  inputSchema: runTypeChecksSchema,
  getInputSchema: (ctx) =>
    ctx.runTypeScriptForWholeProject
      ? projectWideRunTypeChecksSchema
      : runTypeChecksSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    args.paths && args.paths.length > 0
      ? `Check types for: ${args.paths.join(", ")}`
      : "Check types for all files",

  execute: async (args, ctx: AgentContext) => {
    const paths = ctx.runTypeScriptForWholeProject ? undefined : args.paths;
    // Stream initial XML with in-progress state
    const title =
      paths && paths.length > 0
        ? `Type checking: ${paths.join(", ")}`
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
        agentInstructionMode: ctx.reinstallAndRestartAppToolAvailable
          ? "local-agent-tool"
          : "dyad-command",
      });

      broadcastToRegisteredWindows(
        ctx.event.sender,
        "agent-tool:problems-update",
        {
          appId: ctx.appId,
          problems: { problems: [] },
        },
      );

      ctx.onXmlComplete(
        `<dyad-output type="warning" message="${escapeXmlAttr("Type checking unavailable")}">\n${escapeXmlContent(result)}\n</dyad-output>`,
      );

      return result;
    }

    // Send the full problem report to update the Problems panel in the UI
    broadcastToRegisteredWindows(
      ctx.event.sender,
      "agent-tool:problems-update",
      {
        appId: ctx.appId,
        problems: problemReport,
      },
    );

    const outcome = getOutcome(problemReport);
    const allProblems = problemReport.problems;
    let matchingProblems = allProblems;

    // Filter by paths if specified
    if (paths && paths.length > 0) {
      matchingProblems = allProblems.filter((p) =>
        matchesPaths(p.file, paths, ctx.appPath),
      );
    }

    const result =
      outcome === "incomplete"
        ? formatIncompleteTypeCheck(allProblems)
        : formatProblems({
            allProblems,
            matchingProblems,
            paths,
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
