import { runningApps } from "@/ipc/utils/process_manager";
import { z } from "zod";
import { readSettings } from "@/main/settings";
import { isDyadProEnabled } from "@/lib/schemas";
import {
  isShellExperimentAvailable,
  shellExecutionGuidance,
} from "@/shared/shell_capability";
import { withTrackedMutation } from "../subagents/mutation_activity_tracker";
import {
  appOperationCoordinator,
  readAppResource,
  type AppOperationRequest,
} from "@/ipc/services/app_operation_coordinator";
import { reviewShellCommand } from "../shell_review";
import {
  runShellProcess,
  maxShellCommandLength,
  type ShellProcessResult,
} from "./shell_process";
import { trackWorkspaceMutation } from "./tool_invocation";
import {
  tryGetGitStateFingerprint,
  tryCollectSupabaseFunctionEntryPoints,
  scheduleHookGeneratedFileSideEffects,
  deleteHookRemovedFunctions,
} from "./run_pre_commit";
import { escapeXmlAttr, escapeXmlContent, type ToolDefinition } from "./types";

const schema = z.object({
  command: z.string().min(1).max(maxShellCommandLength()),
  description: z.string().min(1).max(1000),
  timeout_ms: z.number().int().min(1).max(300_000).optional(),
});

export const runShellTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "run_shell",
  description: "Run an independently reviewed app command on the host.",
  getDescription: (ctx) =>
    "Run an independently reviewed app command on the host. " +
    shellExecutionGuidance(
      process.platform,
      ctx.appPath ?? "current app directory",
    ),
  getConsentPreview: (args) =>
    `${process.platform === "win32" ? "PowerShell" : "Bash"}: ${args.command}\n\n${args.description}`,
  inputSchema: schema,
  modifiesState: true,
  mutationTracking: "internal",
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
        ? "pending"
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
    if (ctx.abortSignal?.aborted)
      return JSON.stringify({ status: "cancelled" });
    present("reviewing", "Checking command safety…");
    let decision = await reviewShellCommand(
      args.command,
      args.description,
      ctx,
    );
    if (ctx.abortSignal?.aborted) {
      present("cancelled", "Cancelled before execution.", true);
      return JSON.stringify({ status: "cancelled" });
    }
    // An outage has no safety verdict. Retry requires fresh review, never execution approval.
    while (decision.unavailable && !ctx.abortSignal?.aborted) {
      present("review unavailable", decision.reason);
      const retry = await ctx.requireConsent({
        toolName: "run_shell",
        confirmation: "shell-review-retry",
        toolDescription:
          decision.reason +
          " Retry runs the safety check again; it does not execute the command.",
        inputPreview: runShellTool.getConsentPreview!(args),
        abortSignal: ctx.abortSignal,
      });
      if (ctx.abortSignal?.aborted) {
        present("cancelled", "Cancelled before execution.", true);
        return JSON.stringify({ status: "cancelled" });
      }
      if (!retry) {
        present("review unavailable", decision.reason, true);
        return JSON.stringify({
          status: "review_unavailable",
          reason: decision.reason,
          retryable: true,
        });
      }
      if (!available())
        return blocked("Shell access was disabled before retrying.");
      present("reviewing", "Retrying command safety review…");
      decision = await reviewShellCommand(args.command, args.description, ctx);
    }
    if (ctx.abortSignal?.aborted) {
      present("cancelled", "Cancelled before execution.", true);
      return JSON.stringify({ status: "cancelled" });
    }
    if (decision.decision === "block") return blocked(decision.reason);
    const approved = await ctx.requireConsent({
      toolName: "run_shell",
      ...(decision.decision === "ask"
        ? { confirmation: "shell-approval" as const }
        : {}),
      toolDescription: decision.reason,
      inputPreview: runShellTool.getConsentPreview!(args),
      abortSignal: ctx.abortSignal,
    });
    if (!approved || ctx.abortSignal?.aborted) {
      present("cancelled", "Command was not approved for execution.", true);
      return JSON.stringify({
        status: "cancelled",
        reason: "Command was not approved for execution.",
      });
    }
    if (!available())
      return blocked("Shell access was disabled while reviewing.");
    const removedFunctionNames: string[] = [];
    const request: AppOperationRequest = {
      appId: ctx.appId,
      operation: "run-agent-shell",
      resources: [
        readAppResource("app-path"),
        "repository",
        "provider",
        "runtime-config",
        readAppResource("runtime"),
      ],
      signal: ctx.abortSignal,
      refuseWhenRecording: "run shell commands",
    };
    // Review and consent never hold resource claims or mutation activity.
    return withTrackedMutation(ctx, async () => {
      const outcome = await appOperationCoordinator.run(request, async () => {
        if (!available())
          return blocked("Shell access was disabled before execution.");
        if (ctx.abortSignal?.aborted)
          return JSON.stringify({ status: "cancelled" });
        if (!((await decision.revalidateInspection?.()) ?? true))
          return blocked(
            "App files inspected by the safety reviewer changed while waiting. Submit the command again for a fresh safety review.",
          );
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
        const result: ShellProcessResult = await runShellProcess({
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
        }).catch((error: unknown) => ({
          status: "failed" as const,
          executed: false,
          code: null,
          stdout: "",
          stderr: `Could not start the shell: ${error instanceof Error ? error.message : String(error)}`,
          truncated: false,
        }));
        const shutdownNotice =
          "Shell process shutdown could not be confirmed. A descendant may still be running. Stop it externally and restart Dyad before modifying this app.";
        if (result.shutdownUnconfirmed) {
          // Do not release admission to competing mutations while escaped work may remain.
          appOperationCoordinator.blockConflictingOperations(
            request,
            shutdownNotice,
          );
        }
        // Even failed/cancelled commands can leave edits. Never label them rolled back.
        const after = result.shutdownUnconfirmed
          ? undefined
          : await tryGetGitStateFingerprint(ctx.appPath, "after");
        const changed =
          before === undefined || after === undefined || before !== after;
        // Shell effects can include ignored files or external state that Git cannot observe.
        if (result.executed)
          trackWorkspaceMutation(
            ctx,
            changed && ctx.preCommitHookAvailable === true,
          );
        let note: string | undefined = result.shutdownUnconfirmed
          ? shutdownNotice
          : undefined;
        if (
          result.executed &&
          !result.shutdownUnconfirmed &&
          changed &&
          result.status === "completed" &&
          !ctx.abortSignal?.aborted
        ) {
          note = await scheduleHookGeneratedFileSideEffects(
            ctx,
            entries,
            removedFunctionNames,
            "Shell command",
          );
        }
        if (
          changed &&
          (result.status !== "completed" || ctx.abortSignal?.aborted)
        ) {
          note = [
            note,
            "Automatic provider reconciliation was skipped because the command did not complete successfully. Inspect partial edits before making provider changes.",
          ]
            .filter(Boolean)
            .join("\n");
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
      });
      await deleteHookRemovedFunctions(ctx, removedFunctionNames);
      return outcome;
    });
  },
};
