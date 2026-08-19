import fs, { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { z } from "zod";
import {
  ensureGitLineEndingPolicy,
  execGit,
  getGitStateFingerprint,
  getGitProcessEnvironment,
} from "@/ipc/utils/git_utils";
import {
  runBufferedProcess,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";
import { deleteSupabaseFunction } from "@/supabase_admin/supabase_management_client";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
} from "@/supabase_admin/supabase_utils";
import {
  AgentContext,
  ToolDefinition,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { trackWorkspaceMutation } from "./tool_invocation";

export const MAX_PRE_COMMIT_RUNS_PER_TURN = 3;
export const PRE_COMMIT_TIMEOUT_MS = 10 * 60_000;
export const PRE_COMMIT_STAGING_TIMEOUT_MS = 60_000;
const MAX_RESULT_OUTPUT_CHARS = 12_000;
const FINGERPRINT_TIMEOUT_MS = 30_000;
const MAX_HOOK_CHANGED_PATHS = 10_000;
const logger = log.scope("run_pre_commit");

const runPreCommitSchema = z.object({});

async function waitForAll<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  return results.map((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });
}

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

async function collectSupabaseFunctionEntryPoints(
  appPath: string,
): Promise<Set<string>> {
  const functionsPath = path.join(appPath, "supabase", "functions");
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(functionsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }

  const functionNames = new Set<string>();
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map(async (entry) => {
        try {
          await fsPromises.access(
            path.join(functionsPath, entry.name, "index.ts"),
          );
          functionNames.add(entry.name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }),
  );
  return functionNames;
}

async function tryCollectSupabaseFunctionEntryPoints(
  appPath: string,
  phase: "before" | "after",
): Promise<Set<string> | undefined> {
  try {
    return await collectSupabaseFunctionEntryPoints(appPath);
  } catch (error) {
    logger.warn(
      `Failed to inspect Supabase function entry points ${phase} pre-commit:`,
      error,
    );
    return undefined;
  }
}

async function collectCurrentChangedPaths(
  appPath: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const paths = new Set<string>();
  let exceededPathLimit = false;
  const commands = [
    ["diff", "--cached", "--name-only", "-z", "--no-ext-diff", "--"],
    ["diff", "--name-only", "-z", "--no-ext-diff", "--"],
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
  ];

  await waitForAll(
    commands.map(async (command) => {
      let pending = "";
      const consume = (chunk: string, final = false) => {
        const parts = `${pending}${chunk}`.split("\0");
        pending = final ? "" : (parts.pop() ?? "");
        for (const filePath of parts) {
          if (!filePath || paths.has(filePath)) {
            continue;
          }
          if (paths.size >= MAX_HOOK_CHANGED_PATHS) {
            exceededPathLimit = true;
          } else {
            paths.add(filePath);
          }
        }
      };
      const { env, gitLocation } = getGitProcessEnvironment();
      const args = ["-c", "core.fsmonitor=false", ...command];
      const result = await runBufferedProcess({
        command: gitLocation,
        args,
        cwd: appPath,
        env,
        signal,
        timeoutMs: FINGERPRINT_TIMEOUT_MS,
        maxOutputBytes: 1_024,
        captureOutputOnSuccess: false,
        waitForCloseAfterForceKill: true,
        onStdout: (chunk) => consume(chunk),
      });
      consume("", true);
      if (result.code !== 0 || result.aborted || result.timedOut) {
        throw new Error(
          `Git changed-path command failed: git ${args.join(" ")}`,
        );
      }
    }),
  );

  if (exceededPathLimit) {
    throw new Error(
      `Git changed-path scan exceeded ${MAX_HOOK_CHANGED_PATHS} paths`,
    );
  }

  return paths;
}

async function scheduleHookGeneratedFileSideEffects(
  ctx: AgentContext,
  beforeFunctionEntries: Set<string> | undefined,
): Promise<string | undefined> {
  queueCloudSandboxSnapshotSync({ appId: ctx.appId, fullSync: true });
  if (!ctx.supabaseProjectId) {
    return;
  }

  // Use the current dirty-path set as a conservative superset: a function that
  // was already dirty before the hook may have been rewritten again by it.
  let changedPaths: Set<string>;
  try {
    changedPaths = await collectCurrentChangedPaths(
      ctx.appPath,
      ctx.abortSignal,
    );
  } catch (error) {
    logger.warn(
      "Failed to identify Supabase paths changed by pre-commit; skipping Supabase reconciliation:",
      error,
    );
    return "Dyad could not determine which Supabase files the hook changed, so it skipped automatic function reconciliation.";
  }

  const afterFunctionEntries = await tryCollectSupabaseFunctionEntryPoints(
    ctx.appPath,
    "after",
  );

  const changedFunctionNames = new Set<string>();
  for (const filePath of changedPaths) {
    if (isSharedServerModule(filePath)) {
      ctx.isSharedModulesChanged = true;
      if (!ctx.sharedServerModulePaths.includes(filePath)) {
        ctx.sharedServerModulePaths.push(filePath);
      }
      continue;
    }
    if (!isServerFunction(filePath)) {
      continue;
    }
    try {
      changedFunctionNames.add(extractFunctionNameFromPath(filePath));
    } catch {
      // Ignore malformed/special function paths; valid paths are queued above.
    }
  }

  if (afterFunctionEntries) {
    for (const functionName of changedFunctionNames) {
      if (
        afterFunctionEntries.has(functionName) &&
        !ctx.pendingFunctionDeploys.includes(functionName)
      ) {
        ctx.pendingFunctionDeploys.push(functionName);
      }
    }
  }

  const notes: string[] = [];
  if (beforeFunctionEntries && afterFunctionEntries) {
    const removedFunctionNames = [...beforeFunctionEntries].filter(
      (functionName) => !afterFunctionEntries.has(functionName),
    );
    if (ctx.skipPruneEdgeFunctions && removedFunctionNames.length > 0) {
      notes.push(
        `Pre-commit removed local Supabase function(s) ${removedFunctionNames.join(", ")}, but Dyad kept their remote deployments because "Keep extra Supabase edge functions" is enabled.`,
      );
    } else {
      const deletedFunctionNames: string[] = [];
      for (const functionName of removedFunctionNames) {
        try {
          await deleteSupabaseFunction({
            supabaseProjectId: ctx.supabaseProjectId,
            functionName,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
          });
          ctx.pendingFunctionDeploys = ctx.pendingFunctionDeploys.filter(
            (pendingName) => pendingName !== functionName,
          );
          deletedFunctionNames.push(functionName);
        } catch (deleteError) {
          logger.warn(
            `Failed to delete Supabase function ${functionName} removed by pre-commit:`,
            deleteError,
          );
          ctx.onWarningMessage?.(
            `Pre-commit removed Supabase function ${functionName}, but Dyad could not delete its remote deployment: ${deleteError}`,
          );
        }
      }
      if (deletedFunctionNames.length > 0) {
        notes.push(
          `Dyad removed the corresponding remote Supabase function deployment(s): ${deletedFunctionNames.join(", ")}.`,
        );
      }
    }
  }

  if (!beforeFunctionEntries || !afterFunctionEntries) {
    notes.push(
      "Dyad could not compare Supabase function entry points before and after the hook, so it skipped automatic deletion reconciliation.",
    );
  }
  return notes.join("\n\n") || undefined;
}

function appendNote(body: string, note?: string): string {
  return note ? `${body}\n\n${note}` : body;
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
  defaultConsent: "always",
  modifiesState: true,
  isEnabled: (ctx) => ctx.preCommitHookAvailable === true,
  getConsentPreview: () => "Stage all changes and run the pre-commit hook",

  execute: async (_args, ctx) => {
    return appOperationCoordinator.run(
      {
        appId: ctx.appId,
        operation: "run-local-agent-pre-commit",
        resources: ctx.supabaseProjectId
          ? ["provider", "repository"]
          : ["repository"],
        refuseWhenRecording: "run pre-commit checks",
      },
      async () => {
        const fileMutationCount = ctx.fileMutationCount ?? 0;

        if ((ctx.preCommitRunCount ?? 0) >= MAX_PRE_COMMIT_RUNS_PER_TURN) {
          return complete(
            ctx,
            "Pre-commit run limit reached",
            `The pre-commit hook has already run ${MAX_PRE_COMMIT_RUNS_PER_TURN} times this turn. Do not run it again. Stop editing and summarize what still fails and what you tried.`,
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

        const { env: gitEnv, gitLocation } = getGitProcessEnvironment();
        const env = getPackageManagerCommandEnv(gitEnv);
        let stageResult: BufferedProcessResult;
        try {
          await ensureGitLineEndingPolicy({ path: ctx.appPath });
          stageResult = await runBufferedProcess({
            command: gitLocation,
            args: ["add", "--", "."],
            cwd: ctx.appPath,
            env,
            signal: ctx.abortSignal,
            timeoutMs: PRE_COMMIT_STAGING_TIMEOUT_MS,
            maxOutputBytes: 256_000,
            waitForCloseAfterForceKill: true,
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
            `Staging the workspace exceeded ${Math.round(PRE_COMMIT_STAGING_TIMEOUT_MS / 60_000)} minute and was stopped. The hook was not run.\n\n${formatProcessOutput(stageResult.stdout, stageResult.stderr)}`,
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

        let stagedChangesResult: BufferedProcessResult;
        try {
          stagedChangesResult = await runBufferedProcess({
            command: gitLocation,
            args: [
              "-c",
              "core.fsmonitor=false",
              "diff",
              "--cached",
              "--quiet",
              "--no-ext-diff",
              "--no-textconv",
              "--",
            ],
            cwd: ctx.appPath,
            env,
            signal: ctx.abortSignal,
            timeoutMs: PRE_COMMIT_STAGING_TIMEOUT_MS,
            maxOutputBytes: 64_000,
            waitForCloseAfterForceKill: true,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return complete(
            ctx,
            "Pre-commit snapshot check failed",
            `Dyad could not determine whether the staged Git snapshot has changes, so the hook was not run.\n\n${message}`,
            "warning",
          );
        }
        if (
          stagedChangesResult.aborted ||
          stagedChangesResult.timedOut ||
          (stagedChangesResult.code !== 0 && stagedChangesResult.code !== 1)
        ) {
          return complete(
            ctx,
            "Pre-commit snapshot check failed",
            "Dyad could not determine whether the staged Git snapshot has changes, so the hook was not run.",
            "warning",
          );
        }
        if (stagedChangesResult.code === 0) {
          return complete(
            ctx,
            "Pre-commit not run",
            "The staged Git snapshot has no changes to verify.",
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

        if (
          ctx.preCommitFileMutationCountAtLastRun === fileMutationCount &&
          beforeFingerprint !== undefined &&
          beforeFingerprint === ctx.preCommitGitStateFingerprintAtLastRun
        ) {
          const previous = ctx.preCommitLastRunPassed ? "passed" : "failed";
          return complete(
            ctx,
            "Files unchanged since pre-commit",
            `The last pre-commit run ${previous}, and the staged Git snapshot has not changed since then. Do not rerun it until you make a targeted file change.`,
            "warning",
          );
        }

        const beforeFunctionEntries = ctx.supabaseProjectId
          ? await tryCollectSupabaseFunctionEntryPoints(ctx.appPath, "before")
          : undefined;

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
            waitForCloseAfterForceKill: true,
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
        if (afterFingerprint !== undefined) {
          ctx.preCommitGitStateFingerprintAtLastRun = afterFingerprint;
        }
        let reconciliationNote: string | undefined;
        if (hookChangedFiles) {
          trackWorkspaceMutation(ctx);
        } else if (fingerprintUnknown && !result.aborted) {
          // Preserve the bounded retry opportunity without claiming that an
          // unmeasurable hook definitely changed the workspace.
          ctx.fileMutationCount = (ctx.fileMutationCount ?? 0) + 1;
        }
        if (
          !result.aborted &&
          !result.timedOut &&
          (hookChangedFiles || fingerprintUnknown)
        ) {
          reconciliationNote = await scheduleHookGeneratedFileSideEffects(
            ctx,
            beforeFunctionEntries,
          );
        } else if (result.timedOut && ctx.supabaseProjectId) {
          reconciliationNote =
            "The hook did not complete, so Dyad skipped automatic Supabase function reconciliation.";
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
            appendNote(
              `The pre-commit hook exceeded ${Math.round(PRE_COMMIT_TIMEOUT_MS / 60_000)} minutes and was stopped.\n\n${formatProcessOutput(result.stdout, result.stderr)}${fingerprintNote}`,
              reconciliationNote,
            ),
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
            appendNote(
              `Pre-commit failed with exit code ${result.code ?? "unknown"}. Fix the reported errors before retrying. ${remaining} run(s) remain this turn.\n\n${output}${fingerprintNote}`,
              reconciliationNote,
            ),
            "warning",
          );
        }

        ctx.preCommitLastRunPassed = true;
        if (hookChangedFiles) {
          return complete(
            ctx,
            "Pre-commit passed and changed files",
            appendNote(
              `Pre-commit passed, but the hook changed files. Run pre-commit again to verify the resulting files.\n\n${output}`,
              reconciliationNote,
            ),
            "warning",
          );
        }
        if (fingerprintUnknown) {
          return complete(
            ctx,
            "Pre-commit passed; file changes unknown",
            appendNote(
              `Pre-commit passed, but Dyad could not determine whether the hook changed files. Run pre-commit once more to verify any hook-generated changes.\n\n${output}`,
              reconciliationNote,
            ),
            "warning",
          );
        }
        return complete(
          ctx,
          "Pre-commit passed",
          `Pre-commit passed. Do not run it again unless files change.\n\n${output}`,
        );
      },
    );
  },
};
