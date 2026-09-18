import { runningApps } from "@/ipc/utils/process_manager";
import { z } from "zod";
import { readSettings } from "@/main/settings";
import { isDyadProEnabled } from "@/lib/schemas";
import {
  isShellExperimentAvailable,
  shellExecutionGuidance,
} from "@/shared/shell_capability";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import { reviewShellCommand } from "../shell_review";
import { runShellProcess } from "./shell_process";
import { trackWorkspaceMutation } from "./tool_invocation";
import {
  tryGetGitStateFingerprint,
  tryCollectSupabaseFunctionEntryPoints,
  scheduleHookGeneratedFileSideEffects,
} from "./run_pre_commit";
import { escapeXmlAttr, escapeXmlContent, type ToolDefinition } from "./types";

const schema = z.object({
  command: z.string().min(1).max(16_000),
  description: z.string().min(1).max(1000),
  timeout_ms: z.number().int().min(1).max(300_000).optional(),
});

export const runShellTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "run_shell",
  description: "Run an independently reviewed app command on the host.",
  getDescription: (ctx) =>
    shellExecutionGuidance(
      process.platform,
      ctx.appPath ?? "current app directory",
    ),
  inputSchema: schema,
  modifiesState: true,
  usesEngineEndpoint: true,
  defaultConsent: "always",
  isEnabled: (ctx) =>
    isShellExperimentAvailable({
      settings: ctx.inferenceSettings ?? readSettings(),
      isDyadPro: ctx.isDyadPro,
      freeModelMode: ctx.freeModelMode,
      isChild: !!ctx.mutationActivityOwner?.persona,
    }),
  execute: async (input, ctx) => {
    const args = schema.parse(input);
    const shell = process.platform === "win32" ? "PowerShell" : "Bash";
    const present = (status: string, body: string, final = false) => {
      const state = !final
        ? "in-progress"
        : status === "completed"
          ? "finished"
          : status === "cancelled"
            ? "aborted"
            : "warning";
      const xml = `<dyad-status state="${state}" title="${escapeXmlAttr(`${shell}: ${status}`)}">${escapeXmlContent(`${args.command}\n\n${body}`)}</dyad-status>`;
      if (final) ctx.onXmlComplete(xml);
      else ctx.onXmlStream(xml);
    };
    const blocked = (reason: string) => {
      present("blocked", reason, true);
      return JSON.stringify({ status: "blocked", reason });
    };
    if (!ctx.shellReviewContext)
      return blocked("Shell execution is unavailable in this turn.");
    const available = () => {
      const settings = readSettings();
      const mode = runningApps.get(ctx.appId)?.mode;
      if (mode === "cloud" || mode === "docker") return false;
      return isShellExperimentAvailable({
        settings,
        isDyadPro: ctx.isDyadPro && isDyadProEnabled(settings),
        freeModelMode: ctx.freeModelMode,
        isChild: !!ctx.mutationActivityOwner?.persona,
      });
    };
    if (!available())
      return blocked("The shell experiment or Pro Host access is disabled.");
    return appOperationCoordinator.run(
      {
        appId: ctx.appId,
        operation: "run-agent-shell",
        resources: [
          "app-path",
          "repository",
          "provider",
          "runtime-config",
          "runtime",
        ],
        refuseWhenRecording: "run shell commands",
      },
      async () => {
        if (ctx.abortSignal?.aborted)
          return JSON.stringify({ status: "cancelled" });
        present("reviewing", "Checking command safety…");
        const decision = await reviewShellCommand(
          args.command,
          args.description,
          ctx,
        );
        if (ctx.abortSignal?.aborted) {
          present("cancelled", "Cancelled before execution.", true);
          return JSON.stringify({ status: "cancelled" });
        }
        if (decision.decision !== "allow") return blocked(decision.reason);
        if (!available())
          return blocked("Shell access was disabled while reviewing.");
        const before = await tryGetGitStateFingerprint(
          ctx.appPath,
          "before",
          ctx.abortSignal,
        );
        const entries = ctx.supabaseProjectId
          ? await tryCollectSupabaseFunctionEntryPoints(ctx.appPath, "before")
          : undefined;
        if (!available())
          return blocked("Shell access was disabled before execution.");
        if (ctx.abortSignal?.aborted) {
          present("cancelled", "Cancelled before execution.", true);
          return JSON.stringify({ status: "cancelled" });
        }
        let output = "";
        let lastUpdate = 0;
        present("running", decision.reason);
        const result = await runShellProcess({
          command: args.command,
          cwd: ctx.appPath,
          timeoutMs: args.timeout_ms ?? 60_000,
          signal: ctx.abortSignal,
          onOutput: (chunk) => {
            output = (output + chunk).slice(-64_000);
            if (Date.now() - lastUpdate >= 150) {
              lastUpdate = Date.now();
              present("running", `${decision.reason}\n\n${output}`);
            }
          },
        });
        // Even failed/cancelled commands can leave edits. Never label them rolled back.
        const after = await tryGetGitStateFingerprint(ctx.appPath, "after");
        const changed =
          before === undefined || after === undefined || before !== after;
        if (changed)
          trackWorkspaceMutation(ctx, ctx.preCommitHookAvailable === true);
        let note: string | undefined;
        if (
          changed &&
          result.status !== "timed_out" &&
          result.status !== "cancelled" &&
          !ctx.abortSignal?.aborted
        ) {
          note = await scheduleHookGeneratedFileSideEffects(
            ctx,
            entries,
            "Shell command",
          );
        }
        if (
          changed &&
          (result.status === "timed_out" ||
            result.status === "cancelled" ||
            ctx.abortSignal?.aborted)
        ) {
          note =
            "Automatic provider reconciliation was skipped because the command did not finish. Inspect partial edits before making provider changes.";
        }
        if (result.status !== "completed")
          note = [
            note,
            "Partial changes may remain; inspect the workspace before continuing.",
          ]
            .filter(Boolean)
            .join("\n");
        const body = `${decision.reason}\nExit code: ${result.code ?? "none"}\n${result.stdout}\n${result.stderr}${result.truncated ? "\n[Output truncated]" : ""}${note ? `\n${note}` : ""}`;
        present(result.status, body, true);
        return JSON.stringify({ ...result, reason: decision.reason, note });
      },
    );
  },
};
