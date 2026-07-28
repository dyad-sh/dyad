import type { IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import log from "electron-log";
import { eq } from "drizzle-orm";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { db } from "@/db";
import { messages } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { deleteAppBlueprintForChat } from "@/ipc/handlers/app_blueprint_handlers";
import { checkAndMarkForCompaction } from "@/ipc/handlers/compaction/compaction_handler";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import { storeDbTimestampAtCurrentVersion } from "@/ipc/utils/neon_timestamp_utils";
import { safeSend } from "@/ipc/utils/safe_sender";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { detectFrameworkType } from "@/ipc/utils/framework_utils";
import {
  WEB_SEARCH_BRAVE_PROVIDER_ID,
  WEB_SEARCH_EXA_PROVIDER_ID,
  type ChatMode,
  type UserSettings,
} from "@/lib/schemas";
import { appendCancelledResponseNotice } from "@/shared/chatCancellation";
import type { SqlConsentMetadata } from "@/shared/sqlConsentMetadata";
import type { ChatResponseChunk } from "@/ipc/types";
import { getDyadAppPath } from "@/paths/paths";
import { scheduleChatSearchIndexing } from "../tools/dyad/chat_search_indexer";
import {
  deleteTodos,
  loadTodos,
  saveTodos,
} from "../tools/dyad/todo_persistence";
import type { AgentContext, FileEditTracker, Todo } from "../tools/dyad/types";
import { buildPiToolSet } from "../tools/tool_set";
import { requestPiToolConsent } from "../tools/consent";
import { createInvocationContext } from "../tools/invocation_context";
import { resolveAgentToolConsents } from "../tools/dyad/tool_registry";
import {
  rebuildAgentMessages,
  serializePiTranscript,
  type DyadMessageRow,
} from "../session_bridge";
import {
  commitPiTurnChanges,
  deployPiSupabaseFunctions,
} from "./file_operations";
import { runTurn, type TurnOutcome } from "./run_turn";

const logger = log.scope("pi-chat-turn");

export interface PiChatAppRecord {
  id: number;
  path: string;
  supabaseProjectId: string | null;
  supabaseOrganizationSlug: string | null;
  neonProjectId: string | null;
  neonActiveBranchId: string | null;
  neonDevelopmentBranchId: string | null;
  needsAppBlueprint: boolean;
  testingEnabled: boolean;
}

export interface ExecutePiChatTurnInput {
  event: IpcMainInvokeEvent;
  chatId: number;
  app: PiChatAppRecord;
  historyRows: readonly DyadMessageRow[];
  userMessageId: number;
  placeholderMessageId: number;
  settings: UserSettings;
  chatMode: ChatMode;
  systemPrompt: string;
  prompt: string;
  attachmentPaths: readonly string[];
  referencedApps: readonly { appName: string; appPath: string }[];
  dyadRequestId: string;
  abortController: AbortController;
  onChunk: (chunk: ChatResponseChunk) => void | Promise<void>;
}

export interface PiChatTurnResult {
  outcome: TurnOutcome;
  updatedFiles: boolean;
  chatSummary?: string;
  warningMessages?: string[];
}

async function loadPiImages(
  attachmentPaths: readonly string[],
): Promise<ImageContent[]> {
  const images: ImageContent[] = [];
  for (const filePath of attachmentPaths) {
    const extension = filePath.toLowerCase().split(".").pop();
    const mimeType =
      extension === "png"
        ? "image/png"
        : extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : extension === "gif"
            ? "image/gif"
            : extension === "webp"
              ? "image/webp"
              : null;
    if (!mimeType) continue;
    images.push({
      type: "image",
      data: (await fs.readFile(filePath)).toString("base64"),
      mimeType,
    });
  }
  return images;
}

async function restoreTodosAfterCancellation(
  event: IpcMainInvokeEvent,
  appPath: string,
  chatId: number,
  priorTodos: Todo[],
): Promise<void> {
  if (priorTodos.length > 0) {
    await saveTodos(appPath, chatId, priorTodos);
  } else {
    await deleteTodos(appPath, chatId);
  }
  safeSend(event.sender, "agent-tool:todos-update", {
    chatId,
    todos: priorTodos,
  });
}

function getIncompleteTodos(todos: Todo[]): Todo[] {
  return todos.filter(
    (todo) => todo.status === "pending" || todo.status === "in_progress",
  );
}

function formatTodoList(todos: Todo[]): string {
  return todos.map((todo) => `- [${todo.status}] ${todo.content}`).join("\n");
}

function buildTodoFollowUpPrompt(todos: Todo[]): string | undefined {
  const incompleteTodos = getIncompleteTodos(todos);
  if (incompleteTodos.length === 0) return undefined;

  return `You have ${incompleteTodos.length} incomplete todo(s). Please continue and complete them:\n\n${formatTodoList(incompleteTodos)}`;
}

function buildPersistedTodosMessage(todos: Todo[]): AgentMessage | undefined {
  const incompleteTodos = getIncompleteTodos(todos);
  if (incompleteTodos.length === 0) return undefined;

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `[System] You have unfinished todos from your previous turn:\n${formatTodoList(incompleteTodos)}\n\nThe user's next message is their current request. If their request relates to these todos, continue working on them. If their request is about something different, discard these old todos by calling update_todos with merge=false and an empty list, then focus entirely on the user's new request.`,
      },
    ],
    timestamp: Date.now(),
  };
}

async function persistPiTurnCheckpoint(params: {
  userMessageId: number;
  assistantMessageId: number;
  turnMessages: readonly AgentMessage[];
}): Promise<void> {
  const firstMessage = params.turnMessages[0];
  if (firstMessage?.role === "user") {
    await db
      .update(messages)
      .set({ aiMessagesJson: serializePiTranscript([firstMessage]) })
      .where(eq(messages.id, params.userMessageId));
  }

  const assistantMessages =
    firstMessage?.role === "user"
      ? params.turnMessages.slice(1)
      : params.turnMessages;
  await db
    .update(messages)
    .set({ aiMessagesJson: serializePiTranscript(assistantMessages) })
    .where(eq(messages.id, params.assistantMessageId));
}

export async function executePiChatTurn(
  input: ExecutePiChatTurnInput,
): Promise<PiChatTurnResult> {
  const appPath = getDyadAppPath(input.app.path);
  const readOnly = input.chatMode === "ask";
  const planModeOnly = input.chatMode === "plan";
  const persistedTodos = await loadTodos(appPath, input.chatId);
  const warnings: string[] = [];
  const fileEditTracker: FileEditTracker = Object.create(null);
  const toolErrorXmlByCallId = new Map<string, string>();
  const toolConsents = resolveAgentToolConsents(input.settings);

  if (!readOnly && !planModeOnly) {
    await ensureDyadGitignored(appPath).catch((error: unknown) =>
      logger.warn("Failed to ensure .dyad is gitignored", error),
    );
  }
  if (persistedTodos.length > 0) {
    safeSend(input.event.sender, "agent-tool:todos-update", {
      chatId: input.chatId,
      todos: persistedTodos,
    });
  }

  const context: AgentContext = {
    event: input.event,
    appId: input.app.id,
    appPath,
    referencedApps: new Map(
      input.referencedApps.map((app) => [
        app.appName.toLowerCase(),
        app.appPath,
      ]),
    ),
    chatId: input.chatId,
    supabaseProjectId: input.app.supabaseProjectId,
    supabaseOrganizationSlug: input.app.supabaseOrganizationSlug,
    neonProjectId: input.app.neonProjectId,
    neonActiveBranchId:
      input.app.neonActiveBranchId ?? input.app.neonDevelopmentBranchId,
    frameworkType: detectFrameworkType(appPath),
    messageId: input.placeholderMessageId,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    todos: persistedTodos,
    dyadRequestId: input.dyadRequestId,
    toolConsents,
    autoApproveNonSchemaSql: input.settings.autoApproveNonSchemaSql === true,
    webAccessEnabled: input.settings.enableWebAccess === true,
    webSearchConfig:
      input.settings.enableWebAccess === true
        ? {
            provider: input.settings.webSearchProvider ?? "auto",
            exaApiKey:
              input.settings.providerSettings[WEB_SEARCH_EXA_PROVIDER_ID]
                ?.apiKey?.value,
            braveApiKey:
              input.settings.providerSettings[WEB_SEARCH_BRAVE_PROVIDER_ID]
                ?.apiKey?.value,
          }
        : undefined,
    fileEditTracker,
    testingEnabled: input.app.testingEnabled,
    testRunAttempts: new Map(),
    onXmlStream: () => {},
    onXmlComplete: () => {},
    requireConsent: (params: {
      toolName: string;
      toolDescription?: string | null;
      inputPreview?: string | null;
      metadata?: SqlConsentMetadata | null;
    }) =>
      requestPiToolConsent(input.event, {
        chatId: input.chatId,
        ...params,
        consent: toolConsents[params.toolName] ?? "ask",
        autoApproveNonSchemaSql:
          input.settings.autoApproveNonSchemaSql === true,
        abortSignal: input.abortController.signal,
      }),
    appendUserMessage: () => {},
    onUpdateTodos: (todos) => {
      safeSend(input.event.sender, "agent-tool:todos-update", {
        chatId: input.chatId,
        todos,
      });
    },
    onWarningMessage: (message) => warnings.push(message),
    abortSignal: input.abortController.signal,
    enableAppBlueprint:
      input.settings.enableAppBlueprint && input.app.needsAppBlueprint,
    rebuildAppToolAvailable:
      !readOnly &&
      !planModeOnly &&
      input.settings.agentToolConsents?.rebuild_app !== "never",
  };

  const contextFactory = ({
    signal,
    onXml,
    onAppendUserMessage,
  }: {
    toolCallId: string;
    toolName: string;
    signal?: AbortSignal;
    onXml: (xml: string) => void;
    onAppendUserMessage: (content: unknown) => void;
  }): AgentContext => {
    return createInvocationContext(context, {
      signal: signal ?? input.abortController.signal,
      onXml,
      onAppendUserMessage,
    });
  };

  const tools = buildPiToolSet({
    chatMode: input.chatMode,
    gatingContext: context,
    contextFactory,
    onToolErrorXml: (toolCallId, xml) => {
      toolErrorXmlByCallId.set(toolCallId, xml);
    },
    optionOverrides: {
      enableAppBlueprint: context.enableAppBlueprint,
    },
  });
  const priorMessages = rebuildAgentMessages(input.historyRows);
  if (!readOnly && !planModeOnly) {
    const persistedTodosMessage = buildPersistedTodosMessage(persistedTodos);
    if (persistedTodosMessage) priorMessages.push(persistedTodosMessage);
  }
  const images = await loadPiImages(input.attachmentPaths);

  const outcome = await runTurn({
    chatId: input.chatId,
    streamingMessageId: input.placeholderMessageId,
    model: input.settings.selectedModel,
    settings: input.settings,
    chatMode: input.chatMode,
    systemPrompt: input.systemPrompt,
    prompt: input.prompt,
    images,
    tools,
    messages: priorMessages,
    sessionId: String(input.chatId),
    dyadRequestId: input.dyadRequestId,
    abortSignal: input.abortController.signal,
    onChunk: input.onChunk,
    getFollowUpPrompt:
      readOnly || planModeOnly
        ? undefined
        : () => buildTodoFollowUpPrompt(context.todos),
    takeToolErrorXml: (toolCallId) => {
      const xml = toolErrorXmlByCallId.get(toolCallId);
      toolErrorXmlByCallId.delete(toolCallId);
      return xml;
    },
    onCheckpoint: (turnMessages) =>
      persistPiTurnCheckpoint({
        userMessageId: input.userMessageId,
        assistantMessageId: input.placeholderMessageId,
        turnMessages,
      }),
  });

  if (
    !input.abortController.signal.aborted &&
    !outcome.errorMessage &&
    !readOnly &&
    !planModeOnly
  ) {
    const deployResult = await deployPiSupabaseFunctions(context);
    warnings.push(...deployResult.warningMessages);
    if (deployResult.xmlParts.length > 0) {
      const postTurnXml = deployResult.xmlParts.join("\n");
      const separator = outcome.content ? "\n" : "";
      const previousAssistant = [...outcome.turnMessages]
        .reverse()
        .find(
          (message): message is AssistantMessage =>
            message.role === "assistant",
        );
      const statusMessage: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: postTurnXml }],
        api: previousAssistant?.api ?? "openai-completions",
        provider:
          previousAssistant?.provider ?? input.settings.selectedModel.provider,
        model: previousAssistant?.model ?? input.settings.selectedModel.name,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const offset = outcome.content.length;
      const appendedContent = separator + postTurnXml;
      outcome.content += appendedContent;
      outcome.transcript.push(statusMessage);
      outcome.turnMessages.push(statusMessage);
      await input.onChunk({
        chatId: input.chatId,
        streamingMessageId: input.placeholderMessageId,
        streamingPatch: { offset, content: appendedContent },
      });
    }
  }

  const firstTurnMessage = outcome.turnMessages[0];
  await persistPiTurnCheckpoint({
    userMessageId: input.userMessageId,
    assistantMessageId: input.placeholderMessageId,
    turnMessages: outcome.turnMessages,
  });

  const assistantTurnMessages =
    firstTurnMessage?.role === "user"
      ? outcome.turnMessages.slice(1)
      : outcome.turnMessages;
  const maxTokensUsed = assistantTurnMessages.reduce<number | undefined>(
    (maximum, message) => {
      if (message.role !== "assistant") return maximum;
      return Math.max(maximum ?? 0, message.usage.totalTokens);
    },
    undefined,
  );
  if (
    maxTokensUsed !== undefined &&
    !input.abortController.signal.aborted &&
    !outcome.errorMessage
  ) {
    await checkAndMarkForCompaction(input.chatId, maxTokensUsed);
  }
  const persistedContent = input.abortController.signal.aborted
    ? appendCancelledResponseNotice(outcome.content)
    : outcome.content;
  await db
    .update(messages)
    .set({
      content: persistedContent,
      aiMessagesJson: serializePiTranscript(assistantTurnMessages),
      maxTokensUsed,
    })
    .where(eq(messages.id, input.placeholderMessageId));

  if (input.abortController.signal.aborted) {
    deleteAppBlueprintForChat(input.chatId);
    await restoreTodosAfterCancellation(
      input.event,
      appPath,
      input.chatId,
      persistedTodos,
    );
    scheduleChatSearchIndexing();
    return { outcome, updatedFiles: false };
  }

  if (outcome.errorMessage) {
    scheduleChatSearchIndexing();
    throw new DyadError(
      outcome.errorMessage,
      outcome.errorKind ?? DyadErrorKind.External,
    );
  }

  const updatedFiles =
    !readOnly &&
    !planModeOnly &&
    ((context.mutationCount ?? 0) > 0 || context.workspaceMutated === true);
  let commitHash: string | undefined;
  if (updatedFiles) {
    commitHash = await commitPiTurnChanges(appPath, context.chatSummary);
    if (commitHash) {
      await db
        .update(messages)
        .set({ commitHash })
        .where(eq(messages.id, input.placeholderMessageId));
    }
    if (context.neonProjectId && context.neonActiveBranchId) {
      await storeDbTimestampAtCurrentVersion({ appId: context.appId }).catch(
        (error) =>
          logger.error("Failed to store Neon version timestamp", error),
      );
    }
  }

  await db
    .update(messages)
    .set({ approvalState: "approved" })
    .where(eq(messages.id, input.placeholderMessageId));
  scheduleChatSearchIndexing();

  for (const [filePath, counts] of Object.entries(fileEditTracker)) {
    if (Object.values(counts).filter((count) => count > 0).length >= 2) {
      sendTelemetryEvent("local_agent:file_edit_retry", {
        filePath,
        ...counts,
      });
    }
  }

  return {
    outcome,
    updatedFiles,
    chatSummary: context.chatSummary,
    warningMessages: warnings.length > 0 ? [...new Set(warnings)] : undefined,
  };
}
