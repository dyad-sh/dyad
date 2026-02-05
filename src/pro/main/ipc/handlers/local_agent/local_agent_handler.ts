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
  type InjectedMessage,
} from "./prepare_step_utils";
import { TOOL_DEFINITIONS } from "./tool_definitions";
import { parseAiMessagesJson } from "@/ipc/utils/ai_messages_utils";
import { parseMcpToolKey, sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { addIntegrationTool } from "./tools/add_integration";
import { planningQuestionnaireTool } from "./tools/planning_questionnaire";
import { writePlanTool } from "./tools/write_plan";
import { exitPlanTool } from "./tools/exit_plan";
import {
  isChatPendingCompaction,
  performCompaction,
  checkAndMarkForCompaction,
} from "@/ipc/handlers/compaction/compaction_handler";
import { getPostCompactionMessages } from "@/ipc/handlers/compaction/compaction_utils";

const logger = log.scope("local_agent_handler");

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

  // Check Pro status or Basic Agent mode
  // Basic Agent mode allows non-Pro users with quota (quota check is done in chat_stream_handlers)
  // Read-only mode (ask mode) is allowed for all users without Pro
  if (!readOnly && !isDyadProEnabled(settings) && !isBasicAgentMode(settings)) {
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error:
        "Agent v2 requires Dyad Pro. Please enable Dyad Pro in Settings → Pro.",
    });
    return false;
  }

  // Get the chat and app — may be re-queried after compaction
  let chat = await db.query.chats.findFirst({
    where: eq(chats.id, req.chatId),
    with: {
      messages: {
        orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      },
      app: true,
    },
  });

  if (!chat || !chat.app) {
    throw new Error(`Chat not found: ${req.chatId}`);
  }

  const appPath = getDyadAppPath(chat.app.path);

  // Check if compaction is pending and enabled before processing the message
  if (
    settings.enableContextCompaction !== false &&
    (await isChatPendingCompaction(req.chatId))
  ) {
    logger.info(`Performing pending compaction for chat ${req.chatId}`);
    const compactionResult = await performCompaction(
      event,
      req.chatId,
      appPath,
      dyadRequestId,
      (accumulatedSummary: string) => {
        // Stream compaction summary to the frontend in real-time
        // We temporarily set the placeholder content to show compaction progress;
        // after compaction, the chat is re-queried and the placeholder is reset.
        sendResponseChunk(
          event,
          req.chatId,
          chat,
          `<dyad-compaction title="Compacting conversation">\n${accumulatedSummary}\n</dyad-compaction>`,
          placeholderMessageId,
        );
      },
    );
    if (!compactionResult.success) {
      logger.warn(
        `Compaction failed for chat ${req.chatId}: ${compactionResult.error}`,
      );
      // Continue anyway - compaction failure shouldn't block the conversation
    }
    // Re-query to pick up the newly inserted compaction summary message
    chat = (await db.query.chats.findFirst({
      where: eq(chats.id, req.chatId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
        app: true,
      },
    }))!;
  }

  // Send initial message update
  safeSend(event.sender, "chat:response:chunk", {
    chatId: req.chatId,
    messages: chat.messages,
  });

  let fullResponse = "";
  let streamingPreview = ""; // Temporary preview for current tool, not persisted

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
      todos: [],
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
    const agentTools = buildAgentToolSet(ctx, { readOnly, planModeOnly });
    const mcpTools =
      readOnly || planModeOnly ? {} : await getMcpTools(event, ctx);
    const allTools: ToolSet = { ...agentTools, ...mcpTools };

    // Prepare message history with graceful fallback
    // Use messageOverride if provided (e.g., for summarization)
    // If a compaction summary exists, only include messages from that point onward
    // (pre-compaction messages are preserved in DB for the user but not sent to LLM)
    const relevantMessages = getPostCompactionMessages(chat.messages);

    const messageHistory: ModelMessage[] = messageOverride
      ? messageOverride
      : relevantMessages
          .filter((msg) => msg.content || msg.aiMessagesJson)
          .flatMap((msg) => parseAiMessagesJson(msg));

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
      maxOutputTokens: await getMaxTokens(settings.selectedModel),
      temperature: await getTemperature(settings.selectedModel),
      maxRetries: 2,
      system: systemPrompt,
      messages: messageHistory,
      tools: allTools,
      stopWhen: [
        stepCountIs(25),
        hasToolCall(addIntegrationTool.name),
        // In plan mode, stop immediately after presenting a questionnaire,
        // writing a plan, or exiting plan mode so the agent yields control
        // back to the user. Without this, some models (e.g. Gemini Pro 3)
        // ignore the prompt-level "STOP" instruction and keep calling tools
        // in a loop.
        ...(planModeOnly
          ? [
              hasToolCall(planningQuestionnaireTool.name),
              hasToolCall(writePlanTool.name),
              hasToolCall(exitPlanTool.name),
            ]
          : []),
      ],
      abortSignal: abortController.signal,
      // Inject pending user messages (e.g., images from web_crawl) between steps
      // We must re-inject all accumulated messages each step because the AI SDK
      // doesn't persist dynamically injected messages in its internal state.
      // We track the insertion index so messages appear at the same position each step.
      prepareStep: (options) =>
        prepareStepMessages(options, pendingUserMessages, allInjectedMessages),
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
          cachedInputTokens ? (cachedInputTokens ?? 0) / (inputTokens ?? 0) : 0,
        );
        if (typeof totalTokens === "number") {
          await db
            .update(messages)
            .set({ maxTokensUsed: totalTokens })
            .where(eq(messages.id, placeholderMessageId))
            .catch((err) => logger.error("Failed to save token count", err));

          // Check if compaction should be triggered for the next message
          await checkAndMarkForCompaction(req.chatId, totalTokens);
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

    for await (const part of streamResult.fullStream) {
      if (abortController.signal.aborted) {
        logger.log(`Stream aborted for chat ${req.chatId}`);
        // Clean up pending consent requests to prevent stale UI banners
        clearPendingConsentsForChat(req.chatId);
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
        );
      }
    }

    // Close thinking block if still open
    if (inThinkingBlock) {
      fullResponse += "</think>\n";
      await updateResponseInDb(placeholderMessageId, fullResponse);
    }

    // Save the AI SDK messages for multi-turn tool call preservation
    try {
      const response = await streamResult.response;
      const aiMessagesJson = getAiMessagesJsonIfWithinLimit(response.messages);
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
    // Clean up any pending consent requests for this chat to prevent
    // stale UI banners and orphaned promises
    clearPendingConsentsForChat(req.chatId);

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
) {
  const currentMessages = [...chat.messages];
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
