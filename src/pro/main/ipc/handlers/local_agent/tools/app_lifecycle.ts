import { z } from "zod";
import { randomUUID } from "node:crypto";

import { restartApp, waitForAppReady } from "@/ipc/services/restart_app";
import { safeSend } from "@/ipc/utils/safe_sender";
import type { AgentContext, ToolDefinition } from "./types";

const appLifecycleSchema = z.object({});

function buildLifecycleXml(title: string, state?: "finished"): string {
  const stateAttr = state ? ` state="${state}"` : "";
  return `<dyad-status title="${title}"${stateAttr}></dyad-status>`;
}

async function executeLifecycle({
  ctx,
  operation,
}: {
  ctx: AgentContext;
  operation: "restart" | "rebuild";
}): Promise<void> {
  const lifecycleRequestId = randomUUID();
  const startedAt = Date.now();
  safeSend(ctx.event.sender, "app:output", {
    type: "agent-lifecycle-started",
    message: `${operation === "rebuild" ? "Rebuilding" : "Restarting"} app`,
    appId: ctx.appId,
    timestamp: startedAt,
    lifecycleRequestId,
    lifecycleOperation: operation,
  });

  try {
    await restartApp(ctx.event, {
      appId: ctx.appId,
      removeNodeModules: operation === "rebuild",
      clearRuntimeLogs: true,
    });
    await waitForAppReady(ctx.appId, ctx.abortSignal);
    safeSend(ctx.event.sender, "app:output", {
      type: "agent-lifecycle-succeeded",
      message: `App ${operation} succeeded`,
      appId: ctx.appId,
      lifecycleRequestId,
      lifecycleOperation: operation,
    });
  } catch (error) {
    safeSend(ctx.event.sender, "app:output", {
      type: "agent-lifecycle-failed",
      message: error instanceof Error ? error.message : String(error),
      appId: ctx.appId,
      lifecycleRequestId,
      lifecycleOperation: operation,
    });
    throw error;
  }
}

export const restartAppTool: ToolDefinition<
  z.infer<typeof appLifecycleSchema>
> = {
  name: "restart_app",
  description:
    "Restart the current app's development server without reinstalling dependencies. Use only when the user explicitly asks, the server is stopped/unresponsive/stale, a process-boundary change requires it (such as dev-server config, startup scripts, environment variables, or server initialization), or diagnostics explicitly require it. Do not use after ordinary source/style/asset edits or as routine verification. Finish related edits first and do not repeat it for the same unchanged cause.",
  inputSchema: appLifecycleSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: () => "Restart the current app",

  buildXml: (_args, isComplete) =>
    isComplete ? undefined : buildLifecycleXml("Restarting app"),

  execute: async (_args, ctx: AgentContext) => {
    ctx.onXmlStream(buildLifecycleXml("Restarting app"));
    await executeLifecycle({ ctx, operation: "restart" });
    ctx.onXmlComplete(buildLifecycleXml("App restarted", "finished"));
    return "The app restarted successfully.";
  },
};

export const rebuildAppTool: ToolDefinition<
  z.infer<typeof appLifecycleSchema>
> = {
  name: "rebuild_app",
  description:
    "Rebuild the current app by deleting node_modules, reinstalling dependencies, and restarting the development server. Use only when the user explicitly asks, node_modules is missing/incomplete, dependency installation or package/lockfile/native-module state is demonstrably broken or stale, or diagnostics explicitly recommend reinstalling dependencies. Never use for ordinary code errors, UI changes, or configuration changes that only require a restart. A rebuild includes a restart: never call both for the same reason, and do not repeat it for the same unchanged cause.",
  inputSchema: appLifecycleSchema,
  defaultConsent: "ask",
  modifiesState: true,

  getConsentPreview: () =>
    "Delete node_modules, reinstall dependencies, and restart the current app",

  buildXml: (_args, isComplete) =>
    isComplete ? undefined : buildLifecycleXml("Rebuilding app"),

  execute: async (_args, ctx: AgentContext) => {
    ctx.onXmlStream(buildLifecycleXml("Rebuilding app"));
    await executeLifecycle({ ctx, operation: "rebuild" });
    ctx.onXmlComplete(buildLifecycleXml("App rebuilt", "finished"));
    return "The app rebuilt and restarted successfully.";
  },
};
