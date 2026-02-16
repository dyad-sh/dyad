/**
 * Local Agent v2 Handler
 * Main orchestrator for tool-based agent mode with parallel execution
 */

import { IpcMainInvokeEvent } from "electron";
import {
  streamText,
  ToolSet,
  stepCountIs,
  hasToolCall,
  ModelMessage,
  type ToolExecutionOptions,
} from "ai";
import log from "electron-log";

import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq } from "drizzle-orm";

import { isDyadProEnabled, isBasicAgentMode } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { safeSend } from "@/ipc/utils/safe_sender";
import { getMaxTokens, getTemperature } from "@/ipc/utils/token_utils";
import { getProviderOptions, getAiHeaders } from "@/ipc/utils/provider_options";

import {
  AgentToolName,
  buildAgentToolSet,
  requireAgentToolConsent,
  clearPendingConsentsForChat,
  clearPendingQuestionnairesForChat,
} from "./tool_definitions";
import {
  deployAllFunctionsIfNeeded,
  commitAllChanges,
} from "./processors/file_operations";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { mcpServers } from "@/db/schema";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { getAiMessagesJsonIfWithinLimit } from "@/ipc/utils/ai_messages_utils";

import type { ChatStreamParams, ChatResponseEnd } from "@/ipc/types";
import {
  AgentContext,
  parsePartialJson,
  escapeXmlAttr,
  escapeXmlContent,
  UserMessageContentPart,
  FileEditTracker,
} from "./tools/types";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import {
  prepareStepMessages,
  buildTodoReminderMessage,
  hasIncompleteTodos,
  formatTodoSummary,
  type InjectedMessage,
} from "./prepare_step_utils";
import { loadTodos } from "./todo_persistence";
import { ensureDyadGitignored } from "@/ipc/handlers/planUtils";
import { TOOL_DEFINITIONS } from "./tool_definitions";
import {
  parseAiMessagesJson,
  type DbMessageForParsing,
} from "@/ipc/utils/ai_messages_utils";
import { parseMcpToolKey, sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { addIntegrationTool } from "./tools/add_integration";
import { writePlanTool } from "./tools/write_plan";
import { exitPlanTool } from "./tools/exit_plan";
import {
  isChatPendingCompaction,
  performCompaction,
  checkAndMarkForCompaction,
} from "@/ipc/handlers/compaction/compaction_handler";
import { getPostCompactionMessages } from "@/ipc/handlers/compaction/compaction_utils";

const logger = log.scope("local_agent_handler");
const PLANNING_QUESTIONNAIRE_TOOL_NAME = "planning_questionnaire";

// ============================================================================
// Tool Streaming State Management
// ============================================================================

/**
 * Track streaming state per tool call ID
 */
interface ToolStreamingEntry {
  toolName: string;
  argsAccumulated: string;
}
const toolStreamingEntries = new Map<string, ToolStreamingEntry>();

function getOrCreateStreamingEntry(
  id: string,
  toolName?: string,
): ToolStreamingEntry | undefined {
  let entry = toolStreamingEntries.get(id);
  if (!entry && toolName) {
    entry = {
      toolName,
      argsAccumulated: "",
    };
    toolStreamingEntries.set(id, entry);
  }
  return entry;
}

function cleanupStreamingEntry(id: string): void {
  toolStreamingEntries.delete(id);
}

function findToolDefinition(toolName: string) {
  return TOOL_DEFINITIONS.find((t) => t.name === toolName);
}

function buildChatMessageHistory(
  chatMessages: Array<
    DbMessageForParsing & {
      isCompactionSummary: boolean | null;
      createdAt: Date;
    }
  >,
  options?: { excludeMessageIds?: Set<number> },
): ModelMessage[] {
  const excludedIds = options?.excludeMessageIds;
  const relevantMessages = getPostCompactionMessages(chatMessages);
  const reorderedMessages = [...relevantMessages];

  // For mid-turn compaction, keep the summary immediately after the triggering
  // user message so subsequent turns reflect that compaction happened before
  // post-compaction tool-loop steps.
  for (const summary of [...reorderedMessages].filter(
    (message) => message.isCompactionSummary,
  )) {
    const summaryIndex = reorderedMessages.findIndex(
      (m) => m.id === summary.id,
    );
    if (summaryIndex < 0) {
      continue;
    }

    const triggeringUser = [...reorderedMessages]
      .filter((m) => m.role === "user" && m.id < summary.id)
      .sort((a, b) => b.id - a.id)[0];
    if (!triggeringUser) {
      continue;
    }

    const triggeringUserIndex = reorderedMessages.findIndex(
      (m) => m.id === triggeringUser.id,
    );
    if (triggeringUserIndex < 0) {
      continue;
    }

    const isMidTurnSummary =
      summary.createdAt.getTime() >= triggeringUser.createdAt.getTime();
    if (!isMidTurnSummary || summaryIndex === triggeringUserIndex + 1) {
      continue;
    }

    reorderedMessages.splice(summaryIndex, 1);
    const targetIndex = Math.min(
      triggeringUserIndex + 1,
      reorderedMessages.length,
    );
    reorderedMessages.splice(targetIndex, 0, summary);
  }

  return reorderedMessages
    .filter((msg) => !excludedIds?.has(msg.id))
    .filter((msg) => msg.content || msg.aiMessagesJson)
    .flatMap((msg) => parseAiMessagesJson(msg));
}

function getMidTurnCompactionSummaryIds(
  chatMessages: Array<{
    id: number;
    role: string;
    createdAt: Date;
    isCompactionSummary: boolean | null;
  }>,
): Set<number> {
  const hiddenIds = new Set<number>();

  for (const summary of chatMessages.filter((m) => m.isCompactionSummary)) {
    const triggeringUserMessage = [...chatMessages]
      .filter((m) => m.role === "user" && m.id < summary.id)
      .sort((a, b) => b.id - a.id)[0];

    if (!triggeringUserMessage) {
      continue;
    }

    if (
      summary.createdAt.getTime() >= triggeringUserMessage.createdAt.getTime()
    ) {
      hiddenIds.add(summary.id);
    }
  }

  return hiddenIds;
}

/**
 * Handle a chat stream in local-agent mode
 */
export async function handleLocalAgentStream(
  event: IpcMainInvokeEvent,
  req: ChatStreamParams,
  abortController: AbortController,
  {
    placeholderMessageId,
    systemPrompt,
    dyadRequestId,
    readOnly = false,
    planModeOnly = false,
    messageOverride,
  }: {
    placeholderMessageId: number;
    systemPrompt: string;
    dyadRequestId: string;
    /**
     * If true, the agent operates in read-only mode (e.g., ask mode).
     * State-modifying tools are disabled, and no commits/deploys are made.
     */
    readOnly?: boolean;
    /**
     * If true, only include tools allowed in plan mode.
     * This includes read-only exploration tools and planning-specific tools.
     */
    planModeOnly?: boolean;
    /**
     * If provided, use these messages instead of fetching from the database.
     * Used for summarization where messages need to be transformed.
     */
    messageOverride?: ModelMessage[];
  },
): Promise<boolean> {
  const settings = readSettings();
  let fullResponse = "";
  let streamingPreview = ""; // Temporary preview for current tool, not persisted
  // Mid-turn compaction inserts a DB summary row for LLM history, but we render
  // the user-facing compaction indicator inline in the active assistant turn.
  const hiddenMessageIdsForStreaming = new Set<number>();
  let postMidTurnCompactionStartStep: number | null = null;

  const appendInlineCompactionToTurn = async (
    summary?: string,
    backupPath?: string,
  ) => {
    const summaryText =
      summary && summary.trim().length > 0
        ? summary
        : "Conversation compacted.";
    const inlineCompaction = `<dyad-compaction title="Conversation compacted" state="finished">\n${escapeXmlContent(summaryText)}\n</dyad-compaction>`;
    const backupPathNote = backupPath
      ? `\nIf you need to retrieve earlier parts of the conversation history, you can read the backup file at: ${backupPath}\nNote: This file may be large. Read only the sections you need or use grep to search for specific content rather than reading the entire file.`
      : "";
    const separator =
      fullResponse.length > 0 && !fullResponse.endsWith("\n") ? "\n" : "";
    fullResponse = `${fullResponse}${separator}${inlineCompaction}${backupPathNote}\n`;
    await updateResponseInDb(placeholderMessageId, fullResponse);
  };

  // Check Pro status or Basic Agent mode
  // Basic Agent mode allows non-Pro users with quota (quota check is done in chat_stream_handlers)
  // Read-only mode (ask mode) is allowed for all users without Pro
  if (
    !readOnly &&
    !planModeOnly &&
    !isDyadProEnabled(settings) &&
    !isBasicAgentMode(settings)
  ) {
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error:
        "Agent v2 requires Dyad Pro. Please enable Dyad Pro in Settings → Pro.",
    });
    return false;
  }

  const loadChat = async () =>
    db.query.chats.findFirst({
      where: eq(chats.id, req.chatId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
        app: true,
      },
    });

  // Get the chat and app — may be re-queried after compaction
  const initialChat = await loadChat();

  if (!initialChat || !initialChat.app) {
    throw new Error(`Chat not found: ${req.chatId}`);
  }

  let chat = initialChat;

  for (const id of getMidTurnCompactionSummaryIds(chat.messages)) {
    hiddenMessageIdsForStreaming.add(id);
  }

  const appPath = getDyadAppPath(chat.app.path);

  const maybePerformPendingCompaction = async (options?: {
    showOnTopOfCurrentResponse?: boolean;
    force?: boolean;
  }) => {
    if (
      settings.enableContextCompaction === false ||
      (!options?.force && !(await isChatPendingCompaction(req.chatId)))
    ) {
      return false;
    }

    logger.info(`Performing pending compaction for chat ${req.chatId}`);
    const existingCompactionSummaryIds = new Set(
      chat.messages
        .filter((message) => message.isCompactionSummary)
        .map((message) => message.id),
    );
    const compactionResult = await performCompaction(
      event,
      req.chatId,
      appPath,
      dyadRequestId,
      (accumulatedSummary: string) => {
        // Stream compaction summary to the frontend in real-time.
        // During mid-turn compaction, keep already streamed content visible.
        const compactionPreview = `<dyad-compaction title="Compacting conversation">\n${escapeXmlContent(accumulatedSummary)}\n</dyad-compaction>`;
        const previewContent = options?.showOnTopOfCurrentResponse
          ? `${fullResponse}${streamingPreview ? streamingPreview : ""}\n${compactionPreview}`
          : compactionPreview;
        sendResponseChunk(
          event,
          req.chatId,
          chat,
          previewContent,
          placeholderMessageId,
          hiddenMessageIdsForStreaming,
        );
      },
      {
        // Mid-turn compaction should not render as a separate message above the
        // current turn on subsequent streams, so keep its DB timestamp in turn order.
        createdAtStrategy: options?.showOnTopOfCurrentResponse
          ? "now"
          : "before-latest-user",
      },
    );
    if (!compactionResult.success) {
      logger.warn(
        `Compaction failed for chat ${req.chatId}: ${compactionResult.error}`,
      );
      // Continue anyway - compaction failure shouldn't block the conversation
    }

    // Re-query to pick up the newly inserted compaction summary message.
    // Only update if compaction succeeded — a failed compaction may have left
    // partial state that would corrupt subsequent message history.
    if (compactionResult.success) {
      const refreshedChat = await loadChat();
      if (refreshedChat?.app) {
        chat = refreshedChat;
      }

      if (options?.showOnTopOfCurrentResponse) {
        for (const message of chat.messages) {
          if (
            message.isCompactionSummary &&
            !existingCompactionSummaryIds.has(message.id)
          ) {
            hiddenMessageIdsForStreaming.add(message.id);
          }
        }
        await appendInlineCompactionToTurn(
          compactionResult.summary,
          compactionResult.backupPath,
        );
      }
    }

    if (options?.showOnTopOfCurrentResponse) {
      sendResponseChunk(
        event,
        req.chatId,
        chat,
        fullResponse + streamingPreview,
        placeholderMessageId,
        hiddenMessageIdsForStreaming,
      );
    }

    return compactionResult.success;
  };

  // Check if compaction is pending and enabled before processing the message
  await maybePerformPendingCompaction();

  // Send initial message update
  safeSend(event.sender, "chat:response:chunk", {
    chatId: req.chatId,
    messages: chat.messages.filter(
      (message) => !hiddenMessageIdsForStreaming.has(message.id),
    ),
  });

  // Track pending user messages to inject after tool results
  const pendingUserMessages: UserMessageContentPart[][] = [];
  // Store injected messages with their insertion index to re-inject at the same spot each step
  const allInjectedMessages: InjectedMessage[] = [];

  try {
    // Get model client
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Load persisted todos from a previous turn (if any)
    const persistedTodos = await loadTodos(appPath, chat.id);
    // Ensure .dyad/ is gitignored (idempotent; also done by compaction/plans)
    // Skip in read-only/plan-only mode to avoid modifying the workspace
    if (!readOnly && !planModeOnly) {
      await ensureDyadGitignored(appPath).catch((err) =>
        logger.warn("Failed to ensure .dyad gitignored:", err),
      );
    }
    if (persistedTodos.length > 0) {
      // Emit loaded todos to the renderer so the UI shows them immediately
      safeSend(event.sender, "agent-tool:todos-update", {
        chatId: chat.id,
        todos: persistedTodos,
      });
    }

    // Build tool execute context
    const fileEditTracker: FileEditTracker = Object.create(null);
    const ctx: AgentContext = {
      event,
      appId: chat.app.id,
      appPath,
      chatId: chat.id,
      supabaseProjectId: chat.app.supabaseProjectId,
      supabaseOrganizationSlug: chat.app.supabaseOrganizationSlug,
      messageId: placeholderMessageId,
      isSharedModulesChanged: false,
      todos: persistedTodos,
      dyadRequestId,
      fileEditTracker,
      isDyadPro: isDyadProEnabled(settings),
      onXmlStream: (accumulatedXml: string) => {
        // Stream accumulated XML to UI without persisting
        streamingPreview = accumulatedXml;
        sendResponseChunk(
          event,
          req.chatId,
          chat,
          fullResponse + streamingPreview,
          placeholderMessageId,
          hiddenMessageIdsForStreaming,
        );
      },
      onXmlComplete: (finalXml: string) => {
        // Write final XML to DB and UI
        fullResponse += finalXml + "\n";
        streamingPreview = ""; // Clear preview
        updateResponseInDb(placeholderMessageId, fullResponse);
        sendResponseChunk(
          event,
          req.chatId,
          chat,
          fullResponse,
          placeholderMessageId,
          hiddenMessageIdsForStreaming,
        );
      },
      requireConsent: async (params: {
        toolName: string;
        toolDescription?: string | null;
        inputPreview?: string | null;
      }) => {
        return requireAgentToolConsent(event, {
          chatId: chat.id,
          toolName: params.toolName as AgentToolName,
          toolDescription: params.toolDescription,
          inputPreview: params.inputPreview,
        });
      },
      appendUserMessage: (content: UserMessageContentPart[]) => {
        pendingUserMessages.push(content);
      },
      onUpdateTodos: (todos) => {
        safeSend(event.sender, "agent-tool:todos-update", {
          chatId: chat.id,
          todos,
        });
      },
    };

    // Build tool set (agent tools + MCP tools)
    // In read-only mode, only include read-only tools and skip MCP tools
    // (since we can't determine if MCP tools modify state)
    // In plan mode, only include planning tools (read + questionnaire/plan tools)
    const agentTools = buildAgentToolSet(ctx, {
      readOnly,
      planModeOnly,
      basicAgentMode: !readOnly && !planModeOnly && isBasicAgentMode(settings),
    });
    const mcpTools =
      readOnly || planModeOnly ? {} : await getMcpTools(event, ctx);
    const allTools: ToolSet = { ...agentTools, ...mcpTools };

    // Prepare message history with graceful fallback
    // Use messageOverride if provided (e.g., for summarization)
    // If a compaction summary exists, only include messages from that point onward
    // (pre-compaction messages are preserved in DB for the user but not sent to LLM)
    const messageHistory: ModelMessage[] = messageOverride
      ? messageOverride
      : buildChatMessageHistory(chat.messages);

    // Used to swap out pre-compaction history while preserving in-flight turn steps.
    let baseMessageHistoryCount = messageHistory.length;
    let compactBeforeNextStep = false;
    let compactedMidTurn = false;
    let compactionFailedMidTurn = false;

    const maxOutputTokens = await getMaxTokens(settings.selectedModel);
    const temperature = await getTemperature(settings.selectedModel);

    // Run one or more generation passes. If the model emits a chat message while
    // there are still incomplete todos, we append a reminder and do another pass.
    const maxTodoFollowUpLoops = 1;
    let todoFollowUpLoops = 0;
    let hasInjectedPlanningQuestionnaireReflection = false;
    let currentMessageHistory = messageHistory;
    const accumulatedAiMessages: ModelMessage[] = [];

    // If there are persisted todos from a previous turn, inject a synthetic
    // user message so the LLM is aware of them. Inserted BEFORE the user's
    // current message so the user's actual request is the last thing the LLM
    // reads, giving it natural priority over stale todos.
    if (
      !messageOverride &&
      persistedTodos.length > 0 &&
      hasIncompleteTodos(persistedTodos)
    ) {
      const todoSummary = formatTodoSummary(persistedTodos);
      const syntheticMessage: ModelMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: `[System] You have unfinished todos from your previous turn:\n${todoSummary}\n\nThe user's next message is their current request. If their request relates to these todos, continue working on them. If their request is about something different, discard these old todos by calling update_todos with merge=false and an empty list, then focus entirely on the user's new request.`,
          },
        ],
      };
      // Insert before the last message (the user's current message) so the
      // user's intent is the final thing the LLM sees.
      const insertIndex = Math.max(0, currentMessageHistory.length - 1);
      currentMessageHistory = [
        ...currentMessageHistory.slice(0, insertIndex),
        syntheticMessage,
        ...currentMessageHistory.slice(insertIndex),
      ];
    }

    while (!abortController.signal.aborted) {
      // Reset mid-turn compaction state at the start of each pass.
      // These flags track compaction within a single pass and must not persist
      // across passes (e.g., todo follow-up passes).
      compactedMidTurn = false;
      compactionFailedMidTurn = false;
      compactBeforeNextStep = false;
      postMidTurnCompactionStartStep = null;
      baseMessageHistoryCount = currentMessageHistory.length;

      // Stream the response
      const streamResult = streamText({
        model: modelClient.model,
        headers: getAiHeaders({
          builtinProviderId: modelClient.builtinProviderId,
        }),
        providerOptions: getProviderOptions({
          dyadAppId: chat.app.id,
          dyadRequestId,
          dyadDisableFiles: true, // Local agent uses tools, not file injection
          files: [],
          mentionedAppsCodebases: [],
          builtinProviderId: modelClient.builtinProviderId,
          settings,
        }),
        maxOutputTokens,
        temperature,
        maxRetries: 2,
        system: systemPrompt,
        messages: currentMessageHistory,
        tools: allTools,
        stopWhen: [
          stepCountIs(25),
          hasToolCall(addIntegrationTool.name),
          // In plan mode, also stop after writing a plan or exiting plan mode.
          ...(planModeOnly
            ? [hasToolCall(writePlanTool.name), hasToolCall(exitPlanTool.name)]
            : []),
        ],
        abortSignal: abortController.signal,
        // Inject pending user messages (e.g., images from web_crawl) between steps
        // We must re-inject all accumulated messages each step because the AI SDK
        // doesn't persist dynamically injected messages in its internal state.
        // We track the insertion index so messages appear at the same position each step.
        prepareStep: async (options) => {
          let stepOptions = options;

          if (
            !messageOverride &&
            compactBeforeNextStep &&
            !compactedMidTurn &&
            settings.enableContextCompaction !== false
          ) {
            compactBeforeNextStep = false;
            const inFlightTailMessages = options.messages.slice(
              baseMessageHistoryCount,
            );
            const compacted = await maybePerformPendingCompaction({
              showOnTopOfCurrentResponse: true,
              force: true,
            });

            if (compacted) {
              compactedMidTurn = true;
              // Preserve only messages generated after this compaction boundary.
              postMidTurnCompactionStartStep = options.stepNumber;
              // Clear stale injected messages — their insertAtIndex values are
              // based on the pre-compaction message array which has been rebuilt
              // with a different (typically smaller) count. Keeping them would
              // cause injectMessagesAtPositions to splice at wrong positions.
              allInjectedMessages.length = 0;
              const compactedMessageHistory = buildChatMessageHistory(
                chat.messages,
                {
                  // Keep the structured in-flight assistant/tool messages from
                  // the current stream instead of the placeholder DB content.
                  excludeMessageIds: new Set([placeholderMessageId]),
                },
              );
              baseMessageHistoryCount = compactedMessageHistory.length;
              stepOptions = {
                ...options,
                // Preserve in-flight turn messages so same-turn tool loops can
                // continue, while later turns are compacted via persisted history.
                messages: [...compactedMessageHistory, ...inFlightTailMessages],
              };
            } else {
              // Prevent repeated compaction attempts if the first one fails.
              compactionFailedMidTurn = true;
            }
          }

          const preparedStep = prepareStepMessages(
            stepOptions,
            pendingUserMessages,
            allInjectedMessages,
          );

          // prepareStepMessages returns undefined when it has no additional
          // injections/cleanups to apply. If we already replaced the base
          // message history (e.g., after mid-turn compaction), we still need
          // to return the updated options.
          let result =
            preparedStep ?? (stepOptions === options ? undefined : stepOptions);

          return result;
        },
        onStepFinish: async (step) => {
          if (!hasInjectedPlanningQuestionnaireReflection) {
            const questionnaireError =
              getPlanningQuestionnaireErrorFromStep(step);
            if (questionnaireError) {
              pendingUserMessages.push([
                {
                  type: "text",
                  text: buildPlanningQuestionnaireReflectionMessage(
                    questionnaireError,
                    planModeOnly,
                  ),
                },
              ]);
              hasInjectedPlanningQuestionnaireReflection = true;
              logger.info(
                `Injected synthetic planning_questionnaire reflection message for chat ${req.chatId}`,
              );
            }
          }

          if (
            settings.enableContextCompaction === false ||
            compactedMidTurn ||
            typeof step.usage.totalTokens !== "number"
          ) {
            return;
          }

          const shouldCompact = await checkAndMarkForCompaction(
            req.chatId,
            step.usage.totalTokens,
          );

          // If this step triggered tool calls, compact before the next step
          // in this same user turn instead of waiting for the next message.
          // Only attempt mid-turn compaction once per turn.
          if (
            shouldCompact &&
            step.toolCalls.length > 0 &&
            !compactionFailedMidTurn
          ) {
            compactBeforeNextStep = true;
          }
        },
        onFinish: async (response) => {
          const totalTokens = response.usage?.totalTokens;
          const inputTokens = response.usage?.inputTokens;
          const cachedInputTokens = response.usage?.cachedInputTokens;
          logger.log(
            "Total tokens used:",
            totalTokens,
            "Input tokens:",
            inputTokens,
            "Cached input tokens:",
            cachedInputTokens,
            "Cache hit ratio:",
            cachedInputTokens
              ? (cachedInputTokens ?? 0) / (inputTokens ?? 0)
              : 0,
          );
          if (typeof totalTokens === "number") {
            await db
              .update(messages)
              .set({ maxTokensUsed: totalTokens })
              .where(eq(messages.id, placeholderMessageId))
              .catch((err) => logger.error("Failed to save token count", err));
          }
        },
        onError: (error: any) => {
          const errorMessage = error?.error?.message || JSON.stringify(error);
          logger.error("Local agent stream error:", errorMessage);
          safeSend(event.sender, "chat:response:error", {
            chatId: req.chatId,
            error: `AI error: ${errorMessage}`,
          });
        },
      });

      // Process the stream
      let inThinkingBlock = false;
      let passProducedChatText = false;

      try {
        for await (const part of streamResult.fullStream) {
          if (abortController.signal.aborted) {
            logger.log(`Stream aborted for chat ${req.chatId}`);
            // Clean up pending consent/questionnaire requests to prevent stale UI banners
            clearPendingConsentsForChat(req.chatId);
            clearPendingQuestionnairesForChat(req.chatId);
            break;
          }

          let chunk = "";

          // Handle thinking block transitions
          if (
            inThinkingBlock &&
            !["reasoning-delta", "reasoning-end", "reasoning-start"].includes(
              part.type,
            )
          ) {
            chunk = "</think>\n";
            inThinkingBlock = false;
          }

          switch (part.type) {
            case "text-delta":
              passProducedChatText = true;
              chunk += part.text;
              break;

            case "reasoning-start":
              if (!inThinkingBlock) {
                chunk = "<think>";
                inThinkingBlock = true;
              }
              break;

            case "reasoning-delta":
              if (!inThinkingBlock) {
                chunk = "<think>";
                inThinkingBlock = true;
              }
              chunk += part.text;
              break;

            case "reasoning-end":
              if (inThinkingBlock) {
                chunk = "</think>\n";
                inThinkingBlock = false;
              }
              break;

            case "tool-input-start": {
              // Initialize streaming state for this tool call
              getOrCreateStreamingEntry(part.id, part.toolName);
              break;
            }

            case "tool-input-delta": {
              // Accumulate args and stream XML preview
              const entry = getOrCreateStreamingEntry(part.id);
              if (entry) {
                entry.argsAccumulated += part.delta;
                const toolDef = findToolDefinition(entry.toolName);
                if (toolDef?.buildXml) {
                  const argsPartial = parsePartialJson(entry.argsAccumulated);
                  const xml = toolDef.buildXml(argsPartial, false);
                  if (xml) {
                    ctx.onXmlStream(xml);
                  }
                }
              }
              break;
            }

            case "tool-input-end": {
              // Build final XML and persist
              const entry = getOrCreateStreamingEntry(part.id);
              if (entry) {
                const toolDef = findToolDefinition(entry.toolName);
                if (toolDef?.buildXml) {
                  const argsPartial = parsePartialJson(entry.argsAccumulated);
                  const xml = toolDef.buildXml(argsPartial, true);
                  if (xml) {
                    ctx.onXmlComplete(xml);
                  }
                }
              }
              cleanupStreamingEntry(part.id);
              break;
            }

            case "tool-call":
              // Tool execution happens via execute callbacks
              break;

            case "tool-result":
              // Tool results are already handled by the execute callback
              break;
          }

          if (chunk) {
            fullResponse += chunk;
            await updateResponseInDb(placeholderMessageId, fullResponse);
            sendResponseChunk(
              event,
              req.chatId,
              chat,
              fullResponse,
              placeholderMessageId,
              hiddenMessageIdsForStreaming,
            );
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          throw error;
        }
        logger.log(`Stream interrupted after abort for chat ${req.chatId}`);
      }

      // Close thinking block if still open
      if (inThinkingBlock) {
        fullResponse += "</think>\n";
        await updateResponseInDb(placeholderMessageId, fullResponse);
      }

      // Get response messages for this pass
      let responseMessages: ModelMessage[] = [];
      let steps: Awaited<typeof streamResult.steps> = [];
      try {
        const response = await streamResult.response;
        steps = await streamResult.steps;
        responseMessages = response.messages;
      } catch (err) {
        logger.warn("Failed to retrieve stream response messages:", err);
      }

      if (responseMessages.length > 0) {
        // For mid-turn compaction, slice off pre-compaction messages
        const messagesToAccumulate =
          compactedMidTurn && postMidTurnCompactionStartStep !== null
            ? (() => {
                // stepNumber is 0-indexed (from AI SDK: stepNumber = steps.length).
                // We want the step just before compaction to determine how many
                // response messages to skip (they belong to pre-compaction context).
                const prevStepMessages =
                  steps[postMidTurnCompactionStartStep - 1]?.response.messages;
                if (!prevStepMessages) {
                  logger.warn(
                    `No step data found at index ${postMidTurnCompactionStartStep - 1} for mid-turn compaction slicing; persisting all messages`,
                  );
                }
                return responseMessages.slice(prevStepMessages?.length ?? 0);
              })()
            : responseMessages;
        accumulatedAiMessages.push(...messagesToAccumulate);
        currentMessageHistory = [
          ...currentMessageHistory,
          ...messagesToAccumulate,
        ];
      }

      // Check if the model ended with text only (no tool calls in the final step).
      // This is more reliable than passProducedChatText which is set on any text-delta
      // during the stream (including preambles before tool calls).
      const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
      const passEndedWithText =
        passProducedChatText && (!lastStep || lastStep.toolCalls.length === 0);

      if (
        !shouldRunTodoFollowUpPass({
          readOnly,
          planModeOnly,
          passEndedWithText,
          todos: ctx.todos,
          todoFollowUpLoops,
          maxTodoFollowUpLoops,
        })
      ) {
        break;
      }

      todoFollowUpLoops += 1;
      const reminderText = buildTodoReminderMessage(ctx.todos);
      const reminderMessage: ModelMessage = {
        role: "user",
        content: [{ type: "text", text: reminderText }],
      };
      currentMessageHistory = [...currentMessageHistory, reminderMessage];
      // Note: Do NOT push reminderMessage to accumulatedAiMessages.
      // It is a synthetic message that should not be persisted to aiMessagesJson,
      // as it would pollute future conversation history with stale todo state.
      logger.info(
        `Starting todo follow-up pass ${todoFollowUpLoops}/${maxTodoFollowUpLoops} for chat ${req.chatId}`,
      );
    }

    // Handle cancellation paths where stream processing exits cleanly after abort.
    if (abortController.signal.aborted) {
      if (fullResponse) {
        await db
          .update(messages)
          .set({ content: `${fullResponse}\n\n[Response cancelled by user]` })
          .where(eq(messages.id, placeholderMessageId));
      }
      return false; // Cancelled - don't consume quota
    }

    // Save the AI SDK messages for multi-turn tool call preservation
    try {
      const aiMessagesJson = getAiMessagesJsonIfWithinLimit(
        accumulatedAiMessages,
      );
      if (aiMessagesJson) {
        await db
          .update(messages)
          .set({ aiMessagesJson })
          .where(eq(messages.id, placeholderMessageId));
      }
    } catch (err) {
      logger.warn("Failed to save AI messages JSON:", err);
    }

    // In read-only and plan mode, skip deploys and commits
    if (!readOnly && !planModeOnly) {
      // Deploy all Supabase functions if shared modules changed
      await deployAllFunctionsIfNeeded(ctx);

      // Commit all changes
      const commitResult = await commitAllChanges(ctx, ctx.chatSummary);

      if (commitResult.commitHash) {
        await db
          .update(messages)
          .set({ commitHash: commitResult.commitHash })
          .where(eq(messages.id, placeholderMessageId));
      }
    }

    // Mark as approved (auto-approve for local-agent)
    await db
      .update(messages)
      .set({ approvalState: "approved" })
      .where(eq(messages.id, placeholderMessageId));

    // Send telemetry for files with multiple edit tool types
    for (const [filePath, counts] of Object.entries(fileEditTracker)) {
      const toolsUsed = Object.entries(counts).filter(([, count]) => count > 0);
      if (toolsUsed.length >= 2) {
        sendTelemetryEvent("local_agent:file_edit_retry", {
          filePath,
          ...counts,
        });
      }
    }

    // Send completion
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      updatedFiles: !readOnly,
      chatSummary: ctx.chatSummary,
    } satisfies ChatResponseEnd);

    return true; // Success
  } catch (error) {
    // Clean up any pending consent/questionnaire requests for this chat to prevent
    // stale UI banners and orphaned promises
    clearPendingConsentsForChat(req.chatId);
    clearPendingQuestionnairesForChat(req.chatId);

    if (abortController.signal.aborted) {
      // Handle cancellation
      if (fullResponse) {
        await db
          .update(messages)
          .set({ content: `${fullResponse}\n\n[Response cancelled by user]` })
          .where(eq(messages.id, placeholderMessageId));
      }
      return false; // Cancelled - don't consume quota
    }

    logger.error("Local agent error:", error);
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error: `Error: ${error}`,
    });
    return false; // Error - don't consume quota
  }
}

async function updateResponseInDb(messageId: number, content: string) {
  await db
    .update(messages)
    .set({ content })
    .where(eq(messages.id, messageId))
    .catch((err) => logger.error("Failed to update message", err));
}

function sendResponseChunk(
  event: IpcMainInvokeEvent,
  chatId: number,
  chat: any,
  fullResponse: string,
  placeholderMessageId: number,
  hiddenMessageIds?: Set<number>,
) {
  const currentMessages = [...chat.messages].filter(
    (message) => !hiddenMessageIds?.has(message.id),
  );
  // Find the placeholder message by ID rather than assuming it's the last
  // assistant message. After compaction, a compaction summary message may
  // exist after the placeholder and we must not overwrite it.
  const placeholderMsg = currentMessages.find(
    (m) => m.id === placeholderMessageId,
  );
  if (placeholderMsg) {
    placeholderMsg.content = fullResponse;
  }
  safeSend(event.sender, "chat:response:chunk", {
    chatId,
    messages: currentMessages,
  });
}

function getPlanningQuestionnaireErrorFromStep(step: {
  content?: unknown;
}): string | null {
  if (!Array.isArray(step.content)) {
    return null;
  }

  for (const part of step.content) {
    if (!isRecord(part) || part.toolName !== PLANNING_QUESTIONNAIRE_TOOL_NAME) {
      continue;
    }

    if (part.type === "tool-error") {
      return typeof part.error === "string" ? part.error : "Unknown tool error";
    }

    if (
      part.type === "tool-result" &&
      typeof part.output === "string" &&
      part.output.startsWith("Error:")
    ) {
      return part.output;
    }
  }

  return null;
}

function buildPlanningQuestionnaireReflectionMessage(
  errorDetail?: string,
  planModeOnly?: boolean,
): string {
  const base = "Your planning_questionnaire tool call had a format error.";
  const detail = errorDetail ? ` The error was: ${errorDetail}` : "";
  if (planModeOnly) {
    return `[System]${base}${detail} Review the tool's input schema, fix the issue, and re-call planning_questionnaire with correct arguments.`;
  }
  return `[System]${base}${detail} Skip the questionnaire step and proceed directly to the planning phase.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shouldRunTodoFollowUpPass(params: {
  readOnly: boolean;
  planModeOnly: boolean;
  passEndedWithText: boolean;
  todos: AgentContext["todos"];
  todoFollowUpLoops: number;
  maxTodoFollowUpLoops: number;
}): boolean {
  const {
    readOnly,
    planModeOnly,
    passEndedWithText,
    todos,
    todoFollowUpLoops,
    maxTodoFollowUpLoops,
  } = params;
  return (
    !readOnly &&
    !planModeOnly &&
    passEndedWithText &&
    hasIncompleteTodos(todos) &&
    todoFollowUpLoops < maxTodoFollowUpLoops
  );
}

async function getMcpTools(
  event: IpcMainInvokeEvent,
  ctx: AgentContext,
): Promise<ToolSet> {
  const mcpToolSet: ToolSet = {};

  try {
    const servers = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true as any));

    for (const s of servers) {
      const client = await mcpManager.getClient(s.id);
      const toolSet = await client.tools();

      for (const [name, mcpTool] of Object.entries(toolSet)) {
        const key = `${sanitizeMcpName(s.name || "")}__${sanitizeMcpName(name)}`;

        mcpToolSet[key] = {
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          execute: async (args: unknown, execCtx: ToolExecutionOptions) => {
            try {
              const inputPreview =
                typeof args === "string"
                  ? args
                  : Array.isArray(args)
                    ? args.join(" ")
                    : JSON.stringify(args).slice(0, 500);

              const ok = await requireMcpToolConsent(event, {
                serverId: s.id,
                serverName: s.name,
                toolName: name,
                toolDescription: mcpTool.description,
                inputPreview,
              });

              if (!ok) throw new Error(`User declined running tool ${key}`);

              // Emit XML for UI (MCP tools don't stream, so use onXmlComplete directly)
              const { serverName, toolName } = parseMcpToolKey(key);
              const content = JSON.stringify(args, null, 2);
              ctx.onXmlComplete(
                `<dyad-mcp-tool-call server="${serverName}" tool="${toolName}">\n${content}\n</dyad-mcp-tool-call>`,
              );

              const res = await mcpTool.execute(args, execCtx);
              const resultStr =
                typeof res === "string" ? res : JSON.stringify(res);

              ctx.onXmlComplete(
                `<dyad-mcp-tool-result server="${serverName}" tool="${toolName}">\n${resultStr}\n</dyad-mcp-tool-result>`,
              );

              return resultStr;
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              const errorStack =
                error instanceof Error && error.stack ? error.stack : "";
              ctx.onXmlComplete(
                `<dyad-output type="error" message="MCP tool '${key}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorStack || errorMessage)}</dyad-output>`,
              );
              throw error;
            }
          },
        };
      }
    }
  } catch (e) {
    logger.warn("Failed building MCP toolset for local-agent", e);
  }

  return mcpToolSet;
}
