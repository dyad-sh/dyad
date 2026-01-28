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
  type StepResult,
} from "ai";
import log from "electron-log";
import { SessionDataCollector } from "./session_data_collector";
import type {
  TokenUsage,
  AiCallFinishReason,
} from "@/ipc/types/session_upload";

import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq } from "drizzle-orm";

import { isDyadProEnabled } from "@/lib/schemas";
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
     * If provided, use these messages instead of fetching from the database.
     * Used for summarization where messages need to be transformed.
     */
    messageOverride?: ModelMessage[];
  },
): Promise<void> {
  const settings = readSettings();

  // Check Pro status
  if (!isDyadProEnabled(settings)) {
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error:
        "Agent v2 requires Dyad Pro. Please enable Dyad Pro in Settings → Pro.",
    });
    return;
  }

  // Get the chat and app
  const chat = await db.query.chats.findFirst({
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

  // Create session data collector for tracking AI calls, tool calls, and timing
  const sessionDataCollector = new SessionDataCollector(
    placeholderMessageId,
    settings.selectedModel.name,
    dyadRequestId,
  );
  sessionDataCollector.startMessage();

  try {
    // Get model client
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Start tracking the first AI call
    sessionDataCollector.startAiCall(settings.selectedModel.name);

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
      onXmlStream: (accumulatedXml: string) => {
        // Stream accumulated XML to UI without persisting
        streamingPreview = accumulatedXml;
        sendResponseChunk(
          event,
          req.chatId,
          chat,
          fullResponse + streamingPreview,
        );
      },
      onXmlComplete: (finalXml: string) => {
        // Write final XML to DB and UI
        fullResponse += finalXml + "\n";
        streamingPreview = ""; // Clear preview
        updateResponseInDb(placeholderMessageId, fullResponse);
        sendResponseChunk(event, req.chatId, chat, fullResponse);
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
      sessionDataCollector,
    };

    // Build tool set (agent tools + MCP tools)
    // In read-only mode, only include read-only tools and skip MCP tools
    // (since we can't determine if MCP tools modify state)
    const agentTools = buildAgentToolSet(ctx, { readOnly });
    const mcpTools = readOnly ? {} : await getMcpTools(event, ctx);
    const allTools: ToolSet = { ...agentTools, ...mcpTools };

    // Prepare message history with graceful fallback
    // Use messageOverride if provided (e.g., for summarization)
    const messageHistory: ModelMessage[] = messageOverride
      ? messageOverride
      : chat.messages
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
      stopWhen: [stepCountIs(25), hasToolCall(addIntegrationTool.name)], // Allow multiple tool call rounds, stop on add_integration
      abortSignal: abortController.signal,
      // Inject pending user messages (e.g., images from web_crawl) between steps
      // We must re-inject all accumulated messages each step because the AI SDK
      // doesn't persist dynamically injected messages in its internal state.
      // We track the insertion index so messages appear at the same position each step.
      prepareStep: (options) =>
        prepareStepMessages(options, pendingUserMessages, allInjectedMessages),
      onStepFinish: (stepResult: StepResult<any>) => {
        // Track token usage for the completed step (AI call)
        const usage = stepResult.usage;
        const tokenUsage: TokenUsage | null = usage
          ? {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? 0,
              cachedInputTokens: usage.cachedInputTokens ?? null,
              cacheHitRatio:
                usage.inputTokens && usage.cachedInputTokens
                  ? usage.cachedInputTokens / usage.inputTokens
                  : null,
            }
          : null;

        // Determine finish reason
        let finishReason: AiCallFinishReason = "unknown";
        if (stepResult.finishReason === "stop") {
          finishReason = "stop";
        } else if (stepResult.finishReason === "tool-calls") {
          finishReason = "tool-calls";
        } else if (stepResult.finishReason === "length") {
          finishReason = "length";
        } else if (stepResult.finishReason === "content-filter") {
          finishReason = "content-filter";
        } else if (stepResult.finishReason === "error") {
          finishReason = "error";
        }

        sessionDataCollector.endAiCall(finishReason, tokenUsage);

        // Start a new AI call if this wasn't the final step
        // (AI SDK will continue processing for tool calls)
        if (finishReason === "tool-calls") {
          sessionDataCollector.startAiCall(settings.selectedModel.name);
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
          cachedInputTokens ? (cachedInputTokens ?? 0) / (inputTokens ?? 0) : 0,
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
        sessionDataCollector.recordAiCallError(errorMessage, "AI_STREAM_ERROR");
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
          sessionDataCollector.recordFirstToken();
          sessionDataCollector.recordTextDelta();
          chunk += part.text;
          break;

        case "reasoning-start":
          if (!inThinkingBlock) {
            chunk = "<think>";
            inThinkingBlock = true;
          }
          break;

        case "reasoning-delta":
          sessionDataCollector.recordFirstToken();
          sessionDataCollector.recordReasoningDelta();
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
          // Track tool call start - execution happens via execute callbacks
          sessionDataCollector.startToolCall(
            part.toolCallId,
            part.toolName,
            part.args,
          );
          break;

        case "tool-result":
          // Track tool result
          if (
            part.result &&
            typeof part.result === "object" &&
            "isError" in part.result &&
            part.result.isError
          ) {
            sessionDataCollector.endToolCall(
              part.toolCallId,
              "failed",
              part.result,
              part.result.text || "Tool execution failed",
            );
          } else {
            sessionDataCollector.endToolCall(
              part.toolCallId,
              "success",
              part.result,
            );
          }
          break;
      }

      if (chunk) {
        fullResponse += chunk;
        await updateResponseInDb(placeholderMessageId, fullResponse);
        sendResponseChunk(event, req.chatId, chat, fullResponse);
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

    // In read-only mode, skip deploys and commits
    if (!readOnly) {
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

    // End session data collection
    sessionDataCollector.endMessage(false, false);

    // Log session data summary for debugging
    const sessionSummary = {
      aiCalls: sessionDataCollector.getCurrentAiCallIndex() + 1,
      toolCalls: sessionDataCollector.getToolCallCount(),
      successfulToolCalls: sessionDataCollector.getSuccessfulToolCallCount(),
      failedToolCalls: sessionDataCollector.getFailedToolCallCount(),
      errors: sessionDataCollector.getErrorCount(),
    };
    logger.log("Session data summary:", sessionSummary);

    // Emit session data for potential upload
    // The session data is available via sessionDataCollector.getAssistantMessageData()
    // but we don't persist it here - it's emitted for external consumers
    safeSend(event.sender, "chat:session-data", {
      chatId: req.chatId,
      messageId: placeholderMessageId,
      summary: sessionSummary,
    });

    // Send completion
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      updatedFiles: !readOnly,
    } satisfies ChatResponseEnd);

    return;
  } catch (error) {
    // Clean up any pending consent requests for this chat to prevent
    // stale UI banners and orphaned promises
    clearPendingConsentsForChat(req.chatId);

    if (abortController.signal.aborted) {
      // Handle cancellation
      sessionDataCollector.endMessage(true, false);
      if (fullResponse) {
        await db
          .update(messages)
          .set({ content: `${fullResponse}\n\n[Response cancelled by user]` })
          .where(eq(messages.id, placeholderMessageId));
      }
      return;
    }

    // Track the error in session data
    sessionDataCollector.recordError(
      error instanceof Error ? error : String(error),
      "LOCAL_AGENT_ERROR",
    );
    sessionDataCollector.endMessage(false, false);

    logger.error("Local agent error:", error);
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error: `Error: ${error}`,
    });
    return;
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
) {
  const currentMessages = [...chat.messages];
  if (currentMessages.length > 0) {
    const lastMsg = currentMessages[currentMessages.length - 1];
    if (lastMsg.role === "assistant") {
      lastMsg.content = fullResponse;
    }
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
            // Generate a unique tool call ID for tracking
            const toolCallId = `mcp_${s.id}_${name}_${Date.now()}`;

            try {
              const inputPreview =
                typeof args === "string"
                  ? args
                  : Array.isArray(args)
                    ? args.join(" ")
                    : JSON.stringify(args).slice(0, 500);

              // Track MCP tool call start
              ctx.sessionDataCollector?.startToolCall(toolCallId, key, args, {
                isMcpTool: true,
                mcpServerName: s.name,
              });

              const ok = await requireMcpToolConsent(event, {
                serverId: s.id,
                serverName: s.name,
                toolName: name,
                toolDescription: mcpTool.description,
                inputPreview,
              });

              // Track consent decision
              ctx.sessionDataCollector?.recordToolConsent(
                toolCallId,
                true,
                ok ? "accept-once" : "decline",
              );

              if (!ok) {
                ctx.sessionDataCollector?.endToolCall(
                  toolCallId,
                  "denied",
                  null,
                  "User declined running tool",
                );
                throw new Error(`User declined running tool ${key}`);
              }

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

              // Track successful completion
              ctx.sessionDataCollector?.endToolCall(
                toolCallId,
                "success",
                resultStr,
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

              // Track error if not already tracked (e.g., consent denial)
              const toolCall = ctx.sessionDataCollector?.getToolCallCount();
              if (toolCall !== undefined) {
                ctx.sessionDataCollector?.endToolCall(
                  toolCallId,
                  "failed",
                  null,
                  error instanceof Error ? error : errorMessage,
                );
              }

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
