import path from "node:path";
import log from "electron-log";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { trackWorkspaceMutation } from "@/pro/main/ipc/handlers/local_agent/tools/tool_invocation";
import {
  scheduleHookGeneratedFileSideEffects,
  tryCollectSupabaseFunctionEntryPoints,
  tryGetGitStateFingerprint,
} from "@/pro/main/ipc/handlers/local_agent/tools/run_pre_commit";
import { NATIVE_FILE_EDIT_TOOLS, NATIVE_SHELL_TOOLS } from "./tool_policy";

const logger = log.scope("claude_code_native");

/**
 * Tracks what native tools change so Dyad's normal turn finalization (commit,
 * Supabase deploys/deletes, shared-module redeploys, cloud sync) sees it.
 *
 * Git is the authority: hooks only say "something may have changed"; the
 * Git state fingerprint and dirty-path scan decide what actually did. Shell
 * commands are never fingerprinted individually, because a PreToolUse hook
 * blocks the command until it answers.
 */
export function createNativeMutationTracker(ctx: AgentContext) {
  const appRoot = path.resolve(ctx.appPath);
  let startFingerprint: string | undefined;
  let startFunctionEntries: Set<string> | undefined;
  /** Set when a tool may have changed files since the last flush. */
  let dirty = false;
  let editedInApp = false;
  let mutationTracked = false;
  let flushing: Promise<string | undefined> | undefined;
  const notes: string[] = [];

  const insideApp = (filePath: string) => {
    const relative = path.relative(appRoot, path.resolve(appRoot, filePath));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };

  const flushOnce = async (): Promise<string | undefined> => {
    if (!dirty) return undefined;
    dirty = false;
    const after = await tryGetGitStateFingerprint(
      ctx.appPath,
      "after",
      ctx.abortSignal,
    );
    const changed =
      editedInApp ||
      startFingerprint === undefined ||
      after === undefined ||
      after !== startFingerprint;
    if (!changed) return undefined;
    if (!mutationTracked) {
      // One mutation per turn is enough for the finalizer: it makes the turn
      // record a checkpoint even when Claude committed the changes itself.
      mutationTracked = true;
      trackWorkspaceMutation(ctx, true);
    }
    const removed: string[] = [];
    try {
      const note = await scheduleHookGeneratedFileSideEffects(
        ctx,
        startFunctionEntries,
        removed,
        "Claude Code",
      );
      if (note) notes.push(note);
      return note;
    } catch (error) {
      logger.warn("Failed to schedule native file side effects", error);
      return undefined;
    }
  };

  return {
    /** Capture the turn-start Git state before the CLI starts. */
    async start() {
      startFingerprint = await tryGetGitStateFingerprint(
        ctx.appPath,
        "before",
        ctx.abortSignal,
      );
      startFunctionEntries = ctx.supabaseProjectId
        ? await tryCollectSupabaseFunctionEntryPoints(ctx.appPath, "before")
        : undefined;
    },
    /** Called from the PostToolUse hook. Cheap: no Git work here. */
    afterTool(toolName: string, input: Record<string, unknown>) {
      if (NATIVE_FILE_EDIT_TOOLS.has(toolName)) {
        const filePath =
          typeof input.file_path === "string"
            ? input.file_path
            : typeof input.notebook_path === "string"
              ? input.notebook_path
              : undefined;
        if (filePath && insideApp(filePath)) {
          editedInApp = true;
          dirty = true;
          if (!mutationTracked) {
            mutationTracked = true;
            trackWorkspaceMutation(ctx, true);
          }
        }
        return;
      }
      if (NATIVE_SHELL_TOOLS.has(toolName)) dirty = true;
    },
    /** Mark that something outside the hooks (e.g. a subagent we could not
     * observe) may have changed files. */
    markDirty() {
      dirty = true;
    },
    /** Schedule file side effects for everything changed so far. Callers
     * share one in-flight flush. */
    flush(): Promise<string | undefined> {
      flushing ??= flushOnce().finally(() => {
        flushing = undefined;
      });
      return flushing;
    },
    notes(): readonly string[] {
      return notes;
    },
  };
}

export type NativeMutationTracker = ReturnType<
  typeof createNativeMutationTracker
>;
