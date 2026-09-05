/**
 * Runs one Dyad chat turn on the Claude Code backend and projects it into
 * Dyad's existing chat protocol: streaming patches, tool cards, in-chat
 * permission prompts, version checkpoints, preview refresh, usage reporting.
 *
 * Called from `chat_stream_handlers.ts` after turn acceptance and placeholder
 * creation, in place of the Dyad agent dispatch.
 */
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { app as electronApp } from "electron";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import type { ChatStreamParams } from "@/ipc/types";
import type { UserSettings, ModelSelection } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeSend } from "@/ipc/utils/safe_sender";
import { sendChatChunk } from "@/window_infrastructure/main/production_high_volume";
import { computeStreamingPatch } from "@/ipc/utils/stream_text_utils";
import {
  rendererMessageColumns,
  toRendererMessage,
} from "@/ipc/utils/renderer_chat_message";
import { appendCancelledResponseNotice } from "@/shared/chatCancellation";
import { escapeXmlAttr, escapeXmlContent } from "../../shared/xmlEscape";
import { readAiRules } from "@/prompts/system_prompt";
import { scheduleChatSearchIndexing } from "@/pro/main/ipc/handlers/local_agent/chat_search_indexer";
import { publishQueryInvalidations } from "@/ipc/utils/query_invalidation_delivery";
import { requireAgentToolConsent } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import type { AgentToolName } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import { commitAllChanges } from "@/pro/main/ipc/handlers/local_agent/processors/file_operations";
import type { StoredChatAttachment } from "@/ipc/utils/chat_attachment_utils";
import type {
  ChatBackendEvent,
  ChatBackendTurnMode,
  ChatBackendTurnResult,
} from "@/chat_backend/backend";
import type { ChatMode } from "@/lib/schemas";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { ClaudeCodeTurnRunner } from "./turn_runner";
import {
  assertClaudeCodeBillingReady,
  buildClaudeCodeUsageEvent,
  flushPendingClaudeCodeUsageReports,
  recordClaudeCodeUsageEvent,
  recordMissingClaudeCodeUsage,
} from "./usage_tracking";
import { locateClaudeCodeCli } from "./cli_locator";
import { CLAUDE_CODE_MCP_TOOL_PREFIX } from "./permission_policy";

const logger = log.scope("claude_code_chat_turn");

export function toBackendTurnMode(mode: ChatMode): ChatBackendTurnMode {
  if (mode === "ask") return "ask";
  if (mode === "plan") return "plan";
  return "agent";
}

export interface RunClaudeCodeChatTurnParams {
  event: IpcMainInvokeEvent;
  req: ChatStreamParams;
  abortController: AbortController;
  chat: {
    id: number;
    title: string | null;
    claudeCodeSessionId: string | null;
    app: { id: number; path: string; testingEnabled: boolean | null };
    messages: Array<Parameters<typeof toRendererMessage>[0]>;
  };
  appPath: string;
  placeholderMessageId: number;
  selectedModel: ModelSelection;
  chatMode: ChatMode;
  userPrompt: string;
  storedAttachments: StoredChatAttachment[];
  settings: UserSettings;
}

function toRelativePath(appPath: string, candidate: unknown): string {
  if (typeof candidate !== "string") return "";
  const absolute = path.isAbsolute(candidate)
    ? candidate
    : path.join(appPath, candidate);
  const relative = path.relative(appPath, absolute);
  return relative.replace(/\\/g, "/");
}

function escapeSearchReplaceMarkers(text: string): string {
  return text.replace(/^(<{7} SEARCH|={7}|>{7} REPLACE)$/gm, "\\$1");
}

/**
 * Map a Claude Code tool invocation to the Dyad chat card it should render
 * as. In-progress cards use the sidecar preview; the completed XML is
 * appended to the persisted response.
 */
export function buildToolCardXml({
  toolName,
  input,
  appPath,
  result,
}: {
  toolName: string;
  input: unknown;
  appPath: string;
  result: { output: string; isError: boolean } | null;
}): string | null {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const state = result ? (result.isError ? "warning" : "finished") : undefined;
  const stateAttr = state ? ` state="${state}"` : "";
  switch (toolName) {
    case "Read": {
      const path = toRelativePath(appPath, record.file_path);
      return `<dyad-read path="${escapeXmlAttr(path)}"></dyad-read>`;
    }
    case "Glob": {
      const pattern = typeof record.pattern === "string" ? record.pattern : "";
      return `<dyad-status title="${escapeXmlAttr(`Finding files: ${pattern}`)}"${stateAttr}></dyad-status>`;
    }
    case "Grep": {
      const pattern = typeof record.pattern === "string" ? record.pattern : "";
      return `<dyad-status title="${escapeXmlAttr(`Searching: ${pattern}`)}"${stateAttr}></dyad-status>`;
    }
    case "Write": {
      const path = toRelativePath(appPath, record.file_path);
      const content = typeof record.content === "string" ? record.content : "";
      return `<dyad-write path="${escapeXmlAttr(path)}" description="">\n${content}\n</dyad-write>`;
    }
    case "Edit": {
      const path = toRelativePath(appPath, record.file_path);
      const oldString =
        typeof record.old_string === "string" ? record.old_string : "";
      const newString =
        typeof record.new_string === "string" ? record.new_string : "";
      return `<dyad-search-replace path="${escapeXmlAttr(path)}" description="">\n<<<<<<< SEARCH\n${escapeXmlContent(escapeSearchReplaceMarkers(oldString))}\n=======\n${escapeXmlContent(escapeSearchReplaceMarkers(newString))}\n>>>>>>> REPLACE\n</dyad-search-replace>`;
    }
    default: {
      if (toolName.startsWith(CLAUDE_CODE_MCP_TOOL_PREFIX)) {
        // Bridge tools render their own completed cards.
        return result
          ? null
          : `<dyad-status title="${escapeXmlAttr(`Running ${toolName.slice(CLAUDE_CODE_MCP_TOOL_PREFIX.length)}`)}"></dyad-status>`;
      }
      return `<dyad-status title="${escapeXmlAttr(`Tool: ${toolName}`)}"${stateAttr}></dyad-status>`;
    }
  }
}

function failureKindToDyadErrorKind(
  kind: NonNullable<ChatBackendTurnResult["error"]>["kind"],
): DyadErrorKind {
  switch (kind) {
    case "not-installed":
    case "unsupported-version":
    case "unauthenticated":
    case "api-key-billing":
    case "session-not-found":
      return DyadErrorKind.Precondition;
    case "usage-limit":
      return DyadErrorKind.RateLimited;
    case "cancelled":
      return DyadErrorKind.UserCancelled;
    case "spawn-failed":
    case "crashed":
    case "protocol":
    case "unknown":
    default:
      return DyadErrorKind.External;
  }
}

function deriveChatTitle(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("<"));
  const base = (firstLine ?? "Claude Code chat").replace(/\s+/g, " ");
  return base.length > 60 ? `${base.slice(0, 57)}...` : base;
}

/**
 * Execute the turn. Resolves `true` when it completed naturally (so the
 * caller arms follow-ups), `false` when it was cancelled. Throws a
 * classified DyadError on failure after persisting partial output and usage.
 */
export async function runClaudeCodeChatTurn(
  params: RunClaudeCodeChatTurnParams,
): Promise<boolean> {
  const {
    event,
    req,
    abortController,
    chat,
    appPath,
    placeholderMessageId,
    selectedModel,
    chatMode,
    userPrompt,
    storedAttachments,
    settings,
  } = params;

  if (!settings.claudeCodeChargeAcknowledged) {
    throw new DyadError(
      "Before using your Claude Code subscription in Dyad, acknowledge that your Claude subscription usage and a separate Dyad charge both apply (open the model picker and choose Subscription).",
      DyadErrorKind.Precondition,
    );
  }
  assertClaudeCodeBillingReady();

  const mode = toBackendTurnMode(chatMode);
  const startedAt = new Date();
  const usageEventId = uuidv4();
  const newSessionId = uuidv4();
  let fullResponse = "";
  let streamingPreviewToolCallId: string | null = null;
  const lastSentRef = { value: "" };
  const warningMessages: string[] = [];
  const toolInputsByCallId = new Map<
    string,
    { toolName: string; input: unknown }
  >();
  let sessionPersisted = chat.claudeCodeSessionId !== null;
  let workspaceMutated = false;

  await db
    .update(messages)
    .set({ executionBackend: "claude-code", model: null })
    .where(eq(messages.id, placeholderMessageId));

  const sendFullMessages = async () => {
    const rows = await db.query.messages.findMany({
      where: eq(messages.chatId, chat.id),
      columns: rendererMessageColumns,
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    const rendererMessages = rows.map(toRendererMessage);
    const placeholder = rendererMessages.find(
      (message) => message.id === placeholderMessageId,
    );
    if (placeholder) {
      placeholder.content = fullResponse;
    }
    sendChatChunk(event.sender, {
      chatId: chat.id,
      invocationRef: req.invocationRef,
      streamId: req.streamId,
      messages: rendererMessages,
    });
    lastSentRef.value = fullResponse;
  };

  const sendPatch = () => {
    const patch = computeStreamingPatch(fullResponse, lastSentRef.value);
    if (!patch) return;
    if (patch.offset < lastSentRef.value.length) {
      void sendFullMessages();
      return;
    }
    lastSentRef.value = fullResponse;
    sendChatChunk(event.sender, {
      chatId: chat.id,
      invocationRef: req.invocationRef,
      streamId: req.streamId,
      streamingMessageId: placeholderMessageId,
      streamingPatch: patch,
    });
  };

  const sendPreview = (content: string) => {
    sendChatChunk(event.sender, {
      chatId: chat.id,
      invocationRef: req.invocationRef,
      streamId: req.streamId,
      streamingPreview: { content },
    });
  };

  let persistChain: Promise<void> = Promise.resolve();
  const persistResponse = () => {
    const snapshot = fullResponse;
    persistChain = persistChain
      .then(() =>
        db
          .update(messages)
          .set({ content: snapshot })
          .where(eq(messages.id, placeholderMessageId)),
      )
      .then(
        () => undefined,
        (error) =>
          logger.error("Failed to persist Claude Code response", error),
      );
  };

  const appendXml = (xml: string) => {
    if (fullResponse.length > 0 && !fullResponse.endsWith("\n")) {
      fullResponse += "\n";
    }
    fullResponse += `${xml}\n`;
    persistResponse();
    sendPatch();
  };

  const handleEvent = (backendEvent: ChatBackendEvent) => {
    switch (backendEvent.type) {
      case "session-started": {
        if (!sessionPersisted) {
          sessionPersisted = true;
          void db
            .update(chats)
            .set({ claudeCodeSessionId: backendEvent.sessionId })
            .where(eq(chats.id, chat.id))
            .catch((error) =>
              logger.error("Failed to persist Claude Code session id", error),
            );
        }
        return;
      }
      case "model-resolved": {
        void db
          .update(messages)
          .set({ model: backendEvent.model })
          .where(eq(messages.id, placeholderMessageId))
          .catch((error) =>
            logger.error("Failed to persist resolved model", error),
          );
        return;
      }
      case "text-delta": {
        fullResponse += backendEvent.text;
        persistResponse();
        sendPatch();
        return;
      }
      case "tool-start": {
        toolInputsByCallId.set(backendEvent.toolCallId, {
          toolName: backendEvent.toolName,
          input: backendEvent.input,
        });
        const preview = buildToolCardXml({
          toolName: backendEvent.toolName,
          input: backendEvent.input,
          appPath,
          result: null,
        });
        if (preview) {
          streamingPreviewToolCallId = backendEvent.toolCallId;
          sendPreview(preview);
        }
        return;
      }
      case "tool-result": {
        const call = toolInputsByCallId.get(backendEvent.toolCallId);
        const xml = buildToolCardXml({
          toolName: call?.toolName ?? backendEvent.toolName,
          input: call?.input,
          appPath,
          result: {
            output: backendEvent.output,
            isError: backendEvent.isError,
          },
        });
        if (
          (call?.toolName === "Write" || call?.toolName === "Edit") &&
          !backendEvent.isError
        ) {
          workspaceMutated = true;
        }
        if (streamingPreviewToolCallId === backendEvent.toolCallId) {
          streamingPreviewToolCallId = null;
          sendPreview("");
        }
        if (xml) {
          appendXml(xml);
        }
        if (backendEvent.isError && backendEvent.output.trim()) {
          appendXml(
            `<dyad-output type="warning" message="${escapeXmlAttr(`${call?.toolName ?? backendEvent.toolName} failed`)}">${escapeXmlContent(backendEvent.output.slice(0, 2_000))}</dyad-output>`,
          );
        }
        return;
      }
      case "tool-denied": {
        appendXml(
          `<dyad-output type="warning" message="${escapeXmlAttr(`Dyad blocked ${backendEvent.toolName}`)}">${escapeXmlContent(backendEvent.reason)}</dyad-output>`,
        );
        return;
      }
      case "warning": {
        warningMessages.push(backendEvent.message);
        return;
      }
      case "rate-limit": {
        warningMessages.push(backendEvent.message);
        return;
      }
      default:
        return;
    }
  };

  const runner = new ClaudeCodeTurnRunner({
    consents: settings.agentToolConsents,
    createBridgeContext: () => ({
      event,
      appId: chat.app.id,
      appPath,
      chatId: chat.id,
      testingEnabled: Boolean(chat.app.testingEnabled),
      onToolCard: (xml) => {
        workspaceMutated =
          workspaceMutated || xml.startsWith("<dyad-add-dependency");
        if (streamingPreviewToolCallId) {
          streamingPreviewToolCallId = null;
          sendPreview("");
        }
        appendXml(xml);
      },
      onWarning: (message) => {
        warningMessages.push(message);
      },
    }),
  });

  const appInstructions = await readAiRules(appPath);
  const cliVersion = (await locateClaudeCodeCli())?.version ?? null;

  const result = await runner.runTurn(
    {
      chatId: chat.id,
      appId: chat.app.id,
      appPath,
      mode,
      requestedModel: selectedModel.name,
      effortLevel: selectedModel.effortLevel,
      prompt: userPrompt,
      attachments: storedAttachments.map((attachment) => ({
        filePath: attachment.filePath,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        attachmentType: attachment.attachmentType,
      })),
      appInstructions,
      sessionId: chat.claudeCodeSessionId,
      newSessionId,
      usageEventId,
    },
    {
      signal: abortController.signal,
      emit: handleEvent,
      requestApproval: async (request) => {
        const approved = await requireAgentToolConsent(event, {
          chatId: chat.id,
          toolName: request.consentToolName as AgentToolName,
          toolDescription: request.description,
          inputPreview: request.inputPreview,
          abortSignal: abortController.signal,
        });
        return approved
          ? { behavior: "allow" }
          : {
              behavior: "deny",
              message: `The user declined ${request.toolName}.`,
            };
      },
    },
  );

  if (streamingPreviewToolCallId) {
    sendPreview("");
  }
  await persistChain;

  // Usage is recorded for every outcome the CLI reported on, including
  // cancelled and failed turns; a missing report is recorded explicitly.
  const completedAt = new Date();
  const turnStatus =
    result.status === "completed"
      ? "completed"
      : result.status === "cancelled"
        ? "cancelled"
        : "error";
  try {
    if (result.usage) {
      const usageEvent = buildClaudeCodeUsageEvent({
        eventId: usageEventId,
        chatId: chat.id,
        messageId: placeholderMessageId,
        appId: chat.app.id,
        sessionId: result.sessionId,
        turnStatus,
        startedAt,
        completedAt,
        requestedModel: selectedModel.name,
        resolvedModel: result.resolvedModel,
        usage: result.usage,
        clientVersion: electronApp?.getVersion?.() ?? "dev",
        cliVersion,
      });
      await recordClaudeCodeUsageEvent(usageEvent);
      void flushPendingClaudeCodeUsageReports().catch((error) =>
        logger.error("Failed to report Claude Code usage", error),
      );
    } else {
      await recordMissingClaudeCodeUsage({
        eventId: usageEventId,
        chatId: chat.id,
        messageId: placeholderMessageId,
        appId: chat.app.id,
        reason: `Claude Code reported no usage for this ${turnStatus} turn (${result.error?.kind ?? "no result event"}); nothing was billed.`,
      });
    }
  } catch (error) {
    logger.error("Failed to record Claude Code usage", error);
  }

  sendTelemetryEvent("claude_code:turn", {
    status: result.status,
    mode,
    errorKind: result.error?.kind ?? null,
    resolvedModel: result.resolvedModel,
  });

  // Version checkpoint for everything the CLI changed, on every outcome that
  // may have touched files. Cancelled turns are checkpointed too so the
  // user can review and undo; nothing is ever replayed.
  let commitHash: string | undefined;
  if (mode === "agent") {
    try {
      const commitResult = await commitAllChanges(
        {
          appId: chat.app.id,
          appPath,
          fileMutationCount: workspaceMutated ? 1 : 0,
          supabaseProjectId: null,
        },
        chat.title ?? deriveChatTitle(userPrompt),
      );
      commitHash = commitResult.commitHash;
    } catch (error) {
      logger.error("Failed to checkpoint Claude Code changes", error);
      warningMessages.push(
        `Dyad could not create a version checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (result.status === "cancelled") {
    await db
      .update(messages)
      .set({
        content: appendCancelledResponseNotice(fullResponse),
        model: result.resolvedModel,
        ...(commitHash ? { commitHash } : {}),
      })
      .where(eq(messages.id, placeholderMessageId));
    scheduleChatSearchIndexing();
    return false;
  }

  if (result.status === "error" && result.error) {
    const errorXml = `<dyad-output type="error" message="${escapeXmlAttr("Claude Code turn failed")}">${escapeXmlContent(result.error.message)}</dyad-output>`;
    fullResponse += `${fullResponse.endsWith("\n") || fullResponse === "" ? "" : "\n"}${errorXml}\n`;
    await db
      .update(messages)
      .set({
        content: fullResponse,
        model: result.resolvedModel,
        ...(commitHash ? { commitHash } : {}),
      })
      .where(eq(messages.id, placeholderMessageId));
    scheduleChatSearchIndexing();
    await sendFullMessages();
    throw new DyadError(
      result.error.message,
      failureKindToDyadErrorKind(result.error.kind),
    );
  }

  await db
    .update(messages)
    .set({
      content: fullResponse,
      model: result.resolvedModel,
      approvalState: "approved",
      ...(commitHash ? { commitHash } : {}),
    })
    .where(eq(messages.id, placeholderMessageId));

  let chatSummary: string | undefined;
  if (!chat.title) {
    chatSummary = deriveChatTitle(userPrompt);
    await db
      .update(chats)
      .set({ title: chatSummary })
      .where(eq(chats.id, chat.id));
  }

  scheduleChatSearchIndexing();
  await sendFullMessages();
  publishQueryInvalidations(
    [{ family: "chats" }, { family: "chat", chatId: chat.id }],
    event.sender,
  );
  safeSend(event.sender, "chat:response:end", {
    chatId: chat.id,
    invocationRef: req.invocationRef,
    streamId: req.streamId,
    updatedFiles: mode === "agent" && (workspaceMutated || Boolean(commitHash)),
    chatSummary,
    warningMessages:
      warningMessages.length > 0 ? [...new Set(warningMessages)] : undefined,
    suppressAutoReview: true,
  });
  return true;
}
