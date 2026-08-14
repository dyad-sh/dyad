import { createHash } from "node:crypto";
import fs, { promises as fsPromises } from "node:fs";
import log from "electron-log";
import { z } from "zod";
import { execGit, getGitProcessEnvironment } from "@/ipc/utils/git_utils";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";
import {
  runBufferedProcess,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import {
  AgentContext,
  ToolDefinition,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";

export const MAX_PRE_COMMIT_RUNS_PER_TURN = 4;
export const PRE_COMMIT_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_OUTPUT_CHARS = 12_000;
const FINGERPRINT_TIMEOUT_MS = 60_000;
const logger = log.scope("run_pre_commit");

const runPreCommitSchema = z.object({});

async function resolvePreCommitHookPath(
  appPath: string,
): Promise<string | null> {
  try {
    const result = await execGit(
      ["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit"],
      appPath,
      { maxBuffer: 64_000 },
    );
    if (result.exitCode !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isPreCommitHookAvailable(
  appPath: string,
): Promise<boolean> {
  const hookPath = await resolvePreCommitHookPath(appPath);
  if (!hookPath) return false;

  try {
    const stat = await fsPromises.stat(hookPath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    await fsPromises.access(hookPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function hashGitOutput(
  appPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  const { env, gitLocation } = getGitProcessEnvironment();
  const result = await runBufferedProcess({
    command: gitLocation,
    args,
    cwd: appPath,
    env,
    signal,
    timeoutMs: FINGERPRINT_TIMEOUT_MS,
    maxOutputBytes: 1_024,
    captureOutputOnSuccess: false,
    onStdout: (chunk) => hash.update(chunk),
  });
  if (result.code !== 0 || result.aborted || result.timedOut) {
    throw new Error(`Git fingerprint command failed: git ${args.join(" ")}`);
  }
  return hash.digest("hex");
}

/** Fingerprint staged, tracked-worktree, and untracked-path state. */
async function getGitStateFingerprint(
  appPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const staged = await hashGitOutput(
    appPath,
    [
      "-c",
      "core.fsmonitor=false",
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--",
    ],
    signal,
  );
  const unstaged = await hashGitOutput(
    appPath,
    ["-c", "core.fsmonitor=false", "diff", "--binary", "--no-ext-diff", "--"],
    signal,
  );
  const status = await hashGitOutput(
    appPath,
    [
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ],
    signal,
  );
  return `${staged}\0${unstaged}\0${status}`;
}

async function tryGetGitStateFingerprint(
  appPath: string,
  phase: "before" | "after",
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    return await getGitStateFingerprint(appPath, signal);
  } catch (error) {
    logger.warn(`Failed to fingerprint Git state ${phase} pre-commit:`, error);
    return undefined;
  }
}

function tail(value: string): string {
  return value.length > MAX_RESULT_OUTPUT_CHARS
    ? `[Earlier output truncated]\n${value.slice(-MAX_RESULT_OUTPUT_CHARS)}`
    : value;
}

function formatProcessOutput(stdout: string, stderr: string): string {
  const parts = [stdout.trim(), stderr.trim()].filter(Boolean);
  return tail(parts.join("\n")) || "The hook produced no output.";
}

function complete(
  ctx: AgentContext,
  title: string,
  body: string,
  state: "finished" | "warning" = "finished",
): string {
  ctx.onXmlComplete(
    `<dyad-status title="${escapeXmlAttr(title)}" state="${state}">\n${escapeXmlContent(body)}\n</dyad-status>`,
  );
  return body;
}

export const runPreCommitTool: ToolDefinition<
  z.infer<typeof runPreCommitSchema>
> = {
  name: "run_pre_commit",
  description: `Stage all current workspace changes and run the repository's configured pre-commit hook.

- Call this after finishing file edits, before ending the turn.
- If it fails, use the returned output to fix the files, then call it again.
- A retry is allowed only after files changed. Hook-generated changes count.
- Stop after ${MAX_PRE_COMMIT_RUNS_PER_TURN} runs in one turn and summarize any remaining failure.
- A passing run verifies the currently staged snapshot. If files change afterward, run it again.`,
  inputSchema: runPreCommitSchema,
  defaultConsent: "ask",
  modifiesState: true,
  isEnabled: (ctx) => ctx.preCommitHookAvailable === true,
  getConsentPreview: () => "Stage all changes and run the pre-commit hook",

  execute: async (_args, ctx) =>
    appOperationCoordinator.run(
      {
        appId: ctx.appId,
        operation: "run-local-agent-pre-commit",
        resources: ["repository"],
        refuseWhenRecording: "run pre-commit checks",
      },
      async () => {
        const fileMutationCount = ctx.fileMutationCount ?? 0;
        if (fileMutationCount === 0) {
          return complete(
            ctx,
            "Pre-commit not run",
            "No files have been successfully modified this turn. Finish the file edits before running pre-commit.",
            "warning",
          );
        }

        if ((ctx.preCommitRunCount ?? 0) >= MAX_PRE_COMMIT_RUNS_PER_TURN) {
          return complete(
            ctx,
            "Pre-commit run limit reached",
            `The pre-commit hook has already run ${MAX_PRE_COMMIT_RUNS_PER_TURN} times this turn. Do not run it again. Stop editing and summarize what still fails and what you tried.`,
            "warning",
          );
        }

        if (ctx.preCommitFileMutationCountAtLastRun === fileMutationCount) {
          const previous = ctx.preCommitLastRunPassed ? "passed" : "failed";
          return complete(
            ctx,
            "Files unchanged since pre-commit",
            `The last pre-commit run ${previous}, and no files have changed since then. Do not rerun it until you make a targeted file change.`,
            "warning",
          );
        }

        if (!(await isPreCommitHookAvailable(ctx.appPath))) {
          ctx.preCommitHookAvailable = false;
          return complete(
            ctx,
            "Pre-commit hook unavailable",
            "The configured pre-commit hook is missing or is not executable, so it was not run.",
            "warning",
          );
        }

        const { env, gitLocation } = getGitProcessEnvironment(
          getPackageManagerCommandEnv(),
        );
        let stageResult: BufferedProcessResult;
        try {
          stageResult = await runBufferedProcess({
            command: gitLocation,
            args: ["add", "-A"],
            cwd: ctx.appPath,
            env,
            signal: ctx.abortSignal,
            timeoutMs: PRE_COMMIT_TIMEOUT_MS,
            maxOutputBytes: 256_000,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return complete(
            ctx,
            "Pre-commit staging could not start",
            `Git could not stage the workspace before pre-commit. The hook was not run.\n\n${message}`,
            "warning",
          );
        }
        if (stageResult.aborted) {
          return complete(
            ctx,
            "Pre-commit cancelled",
            "Pre-commit was cancelled while staging the workspace. The hook was not run.",
            "warning",
          );
        }
        if (stageResult.timedOut) {
          return complete(
            ctx,
            "Pre-commit staging timed out",
            `Staging the workspace exceeded ${Math.round(PRE_COMMIT_TIMEOUT_MS / 60_000)} minutes and was stopped. The hook was not run.\n\n${formatProcessOutput(stageResult.stdout, stageResult.stderr)}`,
            "warning",
          );
        }
        if (stageResult.code !== 0) {
          return complete(
            ctx,
            "Pre-commit staging failed",
            `Git could not stage the workspace before pre-commit (exit code ${stageResult.code ?? "unknown"}). The hook was not run.\n\n${formatProcessOutput(stageResult.stdout, stageResult.stderr)}`,
            "warning",
          );
        }
        const beforeFingerprint = await tryGetGitStateFingerprint(
          ctx.appPath,
          "before",
          ctx.abortSignal,
        );
        if (ctx.abortSignal?.aborted) {
          return complete(
            ctx,
            "Pre-commit cancelled",
            "The pre-commit hook was cancelled before it started.",
            "warning",
          );
        }

        const previousRunCount = ctx.preCommitRunCount ?? 0;
        const previousMutationCountAtLastRun =
          ctx.preCommitFileMutationCountAtLastRun;
        ctx.preCommitRunCount = previousRunCount + 1;
        ctx.preCommitFileMutationCountAtLastRun = fileMutationCount;
        ctx.onXmlStream(
          `<dyad-status title="${escapeXmlAttr(`Running pre-commit (${ctx.preCommitRunCount}/${MAX_PRE_COMMIT_RUNS_PER_TURN})`)}"></dyad-status>`,
        );

        let result: BufferedProcessResult;
        try {
          result = await runBufferedProcess({
            command: gitLocation,
            args: ["hook", "run", "pre-commit"],
            cwd: ctx.appPath,
            env,
            signal: ctx.abortSignal,
            timeoutMs: PRE_COMMIT_TIMEOUT_MS,
            maxOutputBytes: 256_000,
          });
        } catch (error) {
          // A process that never spawned is not an actual hook run and should not
          // consume the retry budget or require a file edit before retrying.
          ctx.preCommitRunCount = previousRunCount;
          ctx.preCommitFileMutationCountAtLastRun =
            previousMutationCountAtLastRun;
          const message =
            error instanceof Error ? error.message : String(error);
          return complete(
            ctx,
            "Pre-commit could not start",
            `The pre-commit hook process could not be started. This did not consume a run.\n\n${message}`,
            "warning",
          );
        }

        const afterFingerprint = result.aborted
          ? undefined
          : await tryGetGitStateFingerprint(
              ctx.appPath,
              "after",
              ctx.abortSignal,
            );
        const fingerprintUnknown =
          beforeFingerprint === undefined || afterFingerprint === undefined;
        const hookChangedFiles =
          !fingerprintUnknown && beforeFingerprint !== afterFingerprint;
        if (!result.aborted && (hookChangedFiles || fingerprintUnknown)) {
          ctx.fileMutationCount = (ctx.fileMutationCount ?? 0) + 1;
        }

        if (result.aborted) {
          ctx.preCommitLastRunPassed = false;
          return complete(
            ctx,
            "Pre-commit cancelled",
            "The pre-commit hook was cancelled before it completed.",
            "warning",
          );
        }
        if (result.timedOut) {
          ctx.preCommitLastRunPassed = false;
          const fingerprintNote = fingerprintUnknown
            ? "\n\nDyad could not determine whether the hook changed files. A follow-up run is allowed to verify any hook-generated changes."
            : "";
          return complete(
            ctx,
            "Pre-commit timed out",
            `The pre-commit hook exceeded ${Math.round(PRE_COMMIT_TIMEOUT_MS / 60_000)} minutes and was stopped.\n\n${formatProcessOutput(result.stdout, result.stderr)}${fingerprintNote}`,
            "warning",
          );
        }

        const output = formatProcessOutput(result.stdout, result.stderr);
        if (result.code !== 0) {
          ctx.preCommitLastRunPassed = false;
          const remaining =
            MAX_PRE_COMMIT_RUNS_PER_TURN - (ctx.preCommitRunCount ?? 0);
          const fingerprintNote = fingerprintUnknown
            ? "\n\nDyad could not determine whether the hook changed files. A follow-up run is allowed to verify any hook-generated changes."
            : "";
          return complete(
            ctx,
            "Pre-commit failed",
            `Pre-commit failed with exit code ${result.code ?? "unknown"}. Fix the reported errors before retrying. ${remaining} run(s) remain this turn.\n\n${output}${fingerprintNote}`,
            "warning",
          );
        }

        ctx.preCommitLastRunPassed = true;
        if (hookChangedFiles) {
          return complete(
            ctx,
            "Pre-commit passed and changed files",
            `Pre-commit passed, but the hook changed files. Run pre-commit again to verify the resulting files.\n\n${output}`,
            "warning",
          );
        }
        if (fingerprintUnknown) {
          return complete(
            ctx,
            "Pre-commit passed; file changes unknown",
            `Pre-commit passed, but Dyad could not determine whether the hook changed files. Run pre-commit once more to verify any hook-generated changes.\n\n${output}`,
            "warning",
          );
        }
        return complete(
          ctx,
          "Pre-commit passed",
          `Pre-commit passed. Do not run it again unless files change.\n\n${output}`,
        );
      },
    ),
};
