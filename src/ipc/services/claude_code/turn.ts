import { escapeXmlAttr } from "../../../../shared/xmlEscape";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { appRunActorService } from "@/ipc/services/app_run_actor_service";
import { randomUUID } from "node:crypto";
import type { IpcMainInvokeEvent } from "electron";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { readAiRules } from "@/prompts/system_prompt";
import { getLogs } from "@/lib/log_store";
import { runTypeScriptCheck } from "@/ipc/processors/tsc";
import { executeAddDependency } from "@/ipc/processors/executeAddDependency";
import {
  getCurrentCommitHash,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";
import { gitService } from "@/ipc/services/git_service";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";
import { toRendererMessage } from "@/ipc/utils/renderer_chat_message";
import { safeSend } from "@/ipc/utils/safe_sender";
import { userInputRegistry } from "@/user_input/main";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { ChatStreamParams } from "@/ipc/types/chat";
import { createClaudeBridge } from "./bridge";
import { runClaudeTurn, READ_TOOLS, WRITE_TOOLS } from "./runtime";
import { reportClaudeUsage } from "./accounting";
import { startExternalModelUsage } from "../external_model_usage";
import type { ExternalModelAdmission } from "../external_model_admission";
import { scheduleChatSearchIndexing } from "@/pro/main/ipc/handlers/local_agent/chat_search_indexer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { choosePackageManagerForApp } from "@/ipc/utils/package_manager_selection";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
} from "@/ipc/utils/socket_firewall";
import { claudeEnvironment } from "./runtime";

export async function handleClaudeCodeTurn(
  event: IpcMainInvokeEvent,
  req: ChatStreamParams,
  controller: AbortController,
  input: {
    messageId: number;
    prompt: string;
    readOnly: boolean;
    apiKey?: string | null;
    admission?: ExternalModelAdmission;
    references?: { appName: string; appPath: string }[];
  },
): Promise<boolean> {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, req.chatId),
    with: { app: true },
  });
  if (!chat || chat.executionBackend !== "claude-code" || !chat.modelSelection)
    throw new DyadError(
      "Subscription chat configuration is missing",
      DyadErrorKind.Precondition,
    );
  if (
    chat.claudeSessionState === "running" ||
    chat.claudeSessionState === "interrupted"
  )
    throw new DyadError(
      "This Claude Code session was interrupted. Start a new chat to avoid silently replaying edits; existing changes remain available for review and undo.",
      DyadErrorKind.Precondition,
    );
  const selectedModel = chat.modelSelection.name;
  const appPath = getDyadAppPath(chat.app.path);
  const sessionId = chat.claudeSessionId ?? randomUUID();
  let content = "";
  const pendingToolCards = new Map<string, string>();
  let actualModel: string | null = null;
  let result: Record<string, any> | undefined;
  let failure: unknown;
  let updatedFiles = false;
  let restartRequested = false;
  let lastPublishedAt = 0;
  const publish = async (force = false) => {
    if (!force && Date.now() - lastPublishedAt < 100) return;
    lastPublishedAt = Date.now();
    await db
      .update(messages)
      .set({ content, model: actualModel, executionBackend: "claude-code" })
      .where(eq(messages.id, input.messageId));
    const rows = await db.query.messages.findMany({
      where: eq(messages.chatId, req.chatId),
      orderBy: (m, { asc }) => [asc(m.id)],
    });
    safeSend(event.sender, "chat:response:chunk", {
      chatId: req.chatId,
      invocationRef: req.invocationRef,
      streamId: req.streamId,
      messages: rows.map(toRendererMessage),
    });
  };
  const approve = async (tool: string, args: unknown) => {
    if (input.readOnly || controller.signal.aborted) return false;
    const id = userInputRegistry.request({
      kind: "agent-consent",
      chatId: req.chatId,
      toolName: `Claude Code: ${tool}`,
      toolDescription:
        "Approve this operation for the current app and turn only. Checks, dependencies and preview can execute project code; this is not an OS sandbox.",
      inputPreview: JSON.stringify(args).slice(0, 2000),
      classifier: "none",
    });
    const decision = await userInputRegistry.park(id, controller.signal);
    return (
      !controller.signal.aborted &&
      decision?.kind === "agent-consent" &&
      decision.decision !== "decline"
    );
  };
  const usageId = await startExternalModelUsage(
    selectedModel,
    controller.signal,
    { connection: "subscription", modelProvider: "anthropic" },
    input.apiKey,
    input.admission,
  );
  try {
    await appOperationCoordinator.run(
      {
        appId: chat.appId,
        operation: "Claude Code turn",
        resources: [
          readAppResource("app-path"),
          input.readOnly ? readAppResource("repository") : "repository",
        ],
        refuseWhenRecording: "run Claude Code",
      },
      async () => {
        controller.signal.throwIfAborted();
        // Preserve pre-turn dirty state as a separate checkpoint so undo targets
        // only this turn, not edits the user made before it started.
        if (
          !input.readOnly &&
          (await getGitUncommittedFiles({ path: appPath })).length
        )
          await gitService.stageAllAndCommit({
            path: appPath,
            message: "Checkpoint before Claude Code",
          });
        const sourceCommitHash = await getCurrentCommitHash({ path: appPath });
        await db
          .update(messages)
          .set({ sourceCommitHash })
          .where(eq(messages.id, input.messageId));
        await db
          .update(chats)
          .set({ claudeSessionId: sessionId, claudeSessionState: "running" })
          .where(eq(chats.id, req.chatId));
        const bridge = await createClaudeBridge({
          appPath,
          readOnlyPaths: input.references?.map(
            (reference) => reference.appPath,
          ),
          readOnly: input.readOnly,
          signal: controller.signal,
          approve,
          diagnostics: async () => getLogs(chat.appId).slice(-50),
          checks: () => runTypeScriptCheck({ appPath }),
          tests: async () => {
            const manifest = JSON.parse(
              await readFile(path.join(appPath, "package.json"), "utf8"),
            );
            if (typeof manifest.scripts?.test !== "string")
              return { error: "This app has no test script configured." };
            const support = await getPnpmMinimumReleaseAgeSupport();
            const result = await spawnStreaming({
              command: choosePackageManagerForApp(appPath, support.available),
              args: ["test"],
              cwd: appPath,
              env: {
                ...getPackageManagerCommandEnv(claudeEnvironment()),
                CI: "true",
              },
              signal: controller.signal,
              timeoutMs: 120_000,
            });
            return {
              code: result.code,
              output: result.stdout.slice(-20_000),
              aborted: result.aborted,
              timedOut: result.timedOut,
            };
          },
          dependencies: async (packages) => {
            const message = await db.query.messages.findFirst({
              where: eq(messages.id, input.messageId),
            });
            if (!message) throw new Error("Message missing");
            // Outer turn owns the repository; the existing processor is unlocked.
            return executeAddDependency({
              packages,
              message: toRendererMessage(message),
              appPath,
            });
          },
          restart: async () => {
            restartRequested = true;
            return "Preview restart queued until this turn releases its repository claim.";
          },
          onTool: async (name, complete) => {
            content += `\n\n*Dyad ${name}: ${complete ? "completed" : "running"}*\n\n`;
            await publish();
          },
        });
        try {
          const rules = await readAiRules(appPath);
          await runClaudeTurn({
            cwd: appPath,
            prompt: `${input.readOnly ? "READ ONLY: answer or plan without modifying files." : "Work on this Dyad app. Use file tools for edits and the Dyad MCP tools for controlled operations. Do not start shell commands."}\nReferenced apps (read-only; do not modify):\n${JSON.stringify(input.references ?? [])}\nApp instructions:\n${rules}\nUser request:\n${input.prompt}`,
            model: selectedModel,
            sessionId,
            resume: Boolean(chat.claudeSessionId),
            readOnly: input.readOnly,
            signal: controller.signal,
            mcpConfigPath: bridge.configPath,
            async onEvent(value) {
              if (value.session_id && value.session_id !== sessionId)
                throw new Error("CLI session identity mismatch");
              if (value.type === "system" && value.subtype === "init") {
                const allowed = [
                  ...READ_TOOLS,
                  ...(input.readOnly ? [] : WRITE_TOOLS),
                  "EndConversation",
                ];
                if (
                  !Array.isArray(value.tools) ||
                  value.tools.some(
                    (tool: string) =>
                      !allowed.includes(tool) &&
                      ![
                        "mcp__dyad__permission",
                        "mcp__dyad__diagnostics",
                        ...(!input.readOnly
                          ? [
                              "mcp__dyad__type_check",
                              "mcp__dyad__run_tests",
                              "mcp__dyad__install_dependencies",
                              "mcp__dyad__restart_preview",
                            ]
                          : []),
                      ].includes(tool),
                  ) ||
                  value.plugins?.length ||
                  value.mcp_servers?.some(
                    (s: { name: string; status: string }) =>
                      s.name !== "dyad" || s.status !== "connected",
                  )
                )
                  throw new Error(
                    "CLI exposed unexpected tools, plugins or MCP configuration",
                  );
              }
              if (
                value.type === "stream_event" &&
                value.event?.type === "content_block_delta" &&
                value.event.delta?.type === "text_delta"
              ) {
                content += value.event.delta.text;
                await publish();
              }
              if (value.type === "assistant" && !value.parent_tool_use_id) {
                actualModel =
                  typeof value.message?.model === "string"
                    ? value.message.model
                    : actualModel;
                for (const block of value.message?.content ?? [])
                  if (block.type === "tool_use") {
                    const card = `<dyad-status tool-use-id="${escapeXmlAttr(String(block.id))}" title="Claude Code: ${escapeXmlAttr(String(block.name))}" state="in-progress"></dyad-status>`;
                    pendingToolCards.set(block.id, card);
                    content += `\n\n${card}\n\n`;
                  }
                await publish();
              }
              if (value.type === "user") {
                for (const block of value.message?.content ?? []) {
                  if (block.type !== "tool_result") continue;
                  const card = pendingToolCards.get(block.tool_use_id);
                  if (card) {
                    content = content.replace(
                      card,
                      card.replace(
                        'state="in-progress"',
                        `state="${block.is_error ? "error" : "finished"}"`,
                      ),
                    );
                    pendingToolCards.delete(block.tool_use_id);
                  }
                }
                await publish();
              }
              if (value.type === "result") {
                result = value;
                if (!content && typeof value.result === "string")
                  content = value.result;
                await publish();
              }
            },
          });
          if (!result || result.is_error)
            throw new Error(
              "Claude Code did not complete successfully. Check CLI authentication and subscription limits.",
            );
        } catch (error) {
          failure = error;
        } finally {
          await bridge.close();
          if (!input.readOnly) {
            updatedFiles =
              (await getGitUncommittedFiles({ path: appPath })).length > 0;
            if (updatedFiles) {
              const commitHash = await gitService.stageAllAndCommit({
                path: appPath,
                message: controller.signal.aborted
                  ? "Interrupted Claude Code changes"
                  : "Claude Code changes",
              });
              await db
                .update(messages)
                .set({ commitHash })
                .where(eq(messages.id, input.messageId));
            }
          }
          await db
            .update(chats)
            .set({
              claudeSessionState:
                failure || controller.signal.aborted ? "interrupted" : "ready",
            })
            .where(eq(chats.id, req.chatId));
        }
      },
    );
  } catch (error) {
    failure = error;
  }
  if (restartRequested && !controller.signal.aborted) {
    try {
      await appRunActorService.executeExternalLifecycle({
        appId: chat.appId,
        operation: "restart",
        abortSignal: controller.signal,
      });
    } catch {
      content += "\n\n**Preview restart failed. Inspect preview diagnostics.**";
    }
  }
  const usage = await reportClaudeUsage(usageId, result);
  await db
    .update(messages)
    .set({ executionUsage: JSON.stringify(usage) })
    .where(eq(messages.id, input.messageId));
  for (const card of pendingToolCards.values())
    content = content.replace(
      card,
      card.replace('state="in-progress"', 'state="aborted"'),
    );
  if (failure || controller.signal.aborted)
    content +=
      "\n\n**Claude Code was interrupted or failed. Changes may remain; review or undo them. Start a new chat to avoid replaying unfinished edits.**";
  await publish(true);
  if (!chat.title) {
    await db
      .update(chats)
      .set({
        title:
          req.prompt.trim().replace(/\s+/g, " ").slice(0, 80) ||
          "Claude Code chat",
      })
      .where(eq(chats.id, req.chatId));
  }
  scheduleChatSearchIndexing();
  if (!controller.signal.aborted)
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      invocationRef: req.invocationRef,
      streamId: req.streamId,
      updatedFiles,
    });
  return !failure && !controller.signal.aborted;
}
