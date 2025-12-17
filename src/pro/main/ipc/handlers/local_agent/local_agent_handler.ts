/**
 * Local Agent v2 Handler
 * Main orchestrator for tool-based agent mode with parallel execution
 */

import { IpcMainInvokeEvent } from "electron";
import { streamText, ToolSet, stepCountIs, ModelMessage } from "ai";
import log from "electron-log";
import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq, and, isNull, lt } from "drizzle-orm";

import { isDyadProEnabled } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { safeSend } from "@/ipc/utils/safe_sender";
import { getMaxTokens, getTemperature } from "@/ipc/utils/token_utils";
import { readAiRules } from "@/prompts/system_prompt";
import { constructLocalAgentPrompt } from "@/prompts/local_agent_prompt";
import {
  AgentToolName,
  buildAgentToolSet,
  requireAgentToolConsent,
} from "./tool_definitions";
import {
  resetSharedModulesFlag,
  deployAllFunctionsIfNeeded,
  commitAllChanges,
  type FileOperationContext,
} from "./processors/file_operations";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { mcpServers } from "@/db/schema";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { getAiMessagesJsonIfWithinLimit } from "@/ipc/utils/ai_messages_utils";

import type { ChatStreamParams, ChatResponseEnd } from "@/ipc/ipc_types";
import { ToolExecuteContext } from "./tools/types";

const logger = log.scope("local_agent_handler");

// Type for a message from the database
type DbMessage = {
  id: number;
  role: string;
  content: string;
  aiMessagesJson: ModelMessage[] | null;
};

/**
 * Parse ai_messages_json with graceful fallback to simple content reconstruction.
 * If aiMessagesJson is missing, malformed, or incompatible with the current AI SDK,
 * falls back to constructing a basic message from role and content.
 */
function parseAiMessagesJson(msg: DbMessage): ModelMessage[] {
  if (msg.aiMessagesJson) {
    try {
      const parsed = msg.aiMessagesJson;
      // Basic validation: ensure it's an array with role properties
      if (
        Array.isArray(parsed) &&
        parsed.every((m) => m && typeof m.role === "string")
      ) {
        return parsed;
      }
    } catch (e) {
      // Log but don't throw - fall through to fallback
      logger.warn(`Failed to parse ai_messages_json for message ${msg.id}:`, e);
    }
  }
  // Fallback for legacy messages or parse failures
  return [
    {
      role: msg.role as "user" | "assistant",
      content: msg.content,
    },
  ];
}

// Safely parse an MCP tool key
function parseMcpToolKey(toolKey: string): {
  serverName: string;
  toolName: string;
} {
  const separator = "__";
  const lastIndex = toolKey.lastIndexOf(separator);
  if (lastIndex === -1) {
    return { serverName: "", toolName: toolKey };
  }
  const serverName = toolKey.slice(0, lastIndex);
  const toolName = toolKey.slice(lastIndex + separator.length);
  return { serverName, toolName };
}

/**
 * Handle a chat stream in local-agent mode
 */
export async function handleLocalAgentStream(
  event: IpcMainInvokeEvent,
  req: ChatStreamParams,
  abortController: AbortController,
  { placeholderMessageId }: { placeholderMessageId: number },
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

  // Generate request ID

  // Send initial message update
  safeSend(event.sender, "chat:response:chunk", {
    chatId: req.chatId,
    messages: chat.messages,
  });

  // Reset shared modules tracking
  resetSharedModulesFlag();

  let fullResponse = "";
  let chatSummary: string | undefined;

  try {
    // Build system prompt
    const systemPrompt = constructLocalAgentPrompt(await readAiRules(appPath));

    // Get model client
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Build tool execute context
    const toolCtx: ToolExecuteContext = {
      event,
      appPath,
      supabaseProjectId: chat.app.supabaseProjectId,
      messageId: placeholderMessageId,
      onXmlChunk: (xml: string) => {
        fullResponse += xml + "\n";
        updateResponseInDb(placeholderMessageId, fullResponse);
        sendResponseChunk(event, req.chatId, chat, fullResponse);
      },
      requireConsent: async (params: {
        toolName: string;
        toolDescription?: string | null;
        inputPreview?: string | null;
      }) => {
        return requireAgentToolConsent(event, {
          toolName: params.toolName as AgentToolName,
          toolDescription: params.toolDescription,
          inputPreview: params.inputPreview,
        });
      },
    };

    // Build tool set (agent tools + MCP tools)
    const agentTools = buildAgentToolSet(toolCtx);
    const mcpTools = await getMcpTools(event, toolCtx);
    const allTools: ToolSet = { ...agentTools, ...mcpTools };

    // Prepare message history with graceful fallback
    const messageHistory: ModelMessage[] = chat.messages
      .filter((msg) => msg.content || msg.aiMessagesJson)
      .flatMap((msg) => parseAiMessagesJson(msg));

    // Stream the response
    const streamResult = streamText({
      model: modelClient.model,
      maxOutputTokens: await getMaxTokens(settings.selectedModel),
      temperature: await getTemperature(settings.selectedModel),
      maxRetries: 2,
      system: systemPrompt,
      messages: messageHistory,
      tools: allTools,
      stopWhen: stepCountIs(25), // Allow multiple tool call rounds
      abortSignal: abortController.signal,
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

    // Deploy all Supabase functions if shared modules changed
    const opCtx: FileOperationContext = {
      appPath,
      supabaseProjectId: chat.app.supabaseProjectId,
    };
    await deployAllFunctionsIfNeeded(opCtx);

    // Commit all changes
    const commitResult = await commitAllChanges(opCtx, chatSummary);

    if (commitResult.commitHash) {
      await db
        .update(messages)
        .set({ commitHash: commitResult.commitHash })
        .where(eq(messages.id, placeholderMessageId));
    }

    // Update chat title if we have a summary
    if (chatSummary) {
      await db
        .update(chats)
        .set({ title: chatSummary })
        .where(and(eq(chats.id, req.chatId), isNull(chats.title)));
    }

    // Mark as approved (auto-approve for local-agent)
    await db
      .update(messages)
      .set({ approvalState: "approved" })
      .where(eq(messages.id, placeholderMessageId));

    // Send completion
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      updatedFiles: true,
    } satisfies ChatResponseEnd);

    return;
  } catch (error) {
    if (abortController.signal.aborted) {
      // Handle cancellation
      if (fullResponse) {
        await db
          .update(messages)
          .set({ content: `${fullResponse}\n\n[Response cancelled by user]` })
          .where(eq(messages.id, placeholderMessageId));
      }
      return;
    }

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
  toolCtx: ToolExecuteContext,
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

      for (const [name, tool] of Object.entries(toolSet)) {
        const key = `${String(s.name || "").replace(/[^a-zA-Z0-9_-]/g, "-")}__${String(name).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const original = tool;

        mcpToolSet[key] = {
          description: original?.description,
          inputSchema: original?.inputSchema,
          execute: async (args: any, execCtx: any) => {
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
              toolDescription: original?.description,
              inputPreview,
            });

            if (!ok) throw new Error(`User declined running tool ${key}`);

            // Emit XML for UI
            const { serverName, toolName } = parseMcpToolKey(key);
            const content = JSON.stringify(args, null, 2);
            toolCtx.onXmlChunk(
              `<dyad-mcp-tool-call server="${serverName}" tool="${toolName}">\n${content}\n</dyad-mcp-tool-call>`,
            );

            const res = await original.execute?.(args, execCtx);
            const resultStr =
              typeof res === "string" ? res : JSON.stringify(res);

            toolCtx.onXmlChunk(
              `<dyad-mcp-tool-result server="${serverName}" tool="${toolName}">\n${resultStr}\n</dyad-mcp-tool-result>`,
            );

            return resultStr;
          },
        };
      }
    }
  } catch (e) {
    logger.warn("Failed building MCP toolset for local-agent", e);
  }

  return mcpToolSet;
}

const AI_MESSAGES_TTL_DAYS = 30;

/**
 * Clear ai_messages_json for messages older than TTL.
 * Run on app startup to prevent database bloat.
 */
export async function cleanupOldAiMessagesJson() {
  const cutoffSeconds =
    Math.floor(Date.now() / 1000) - AI_MESSAGES_TTL_DAYS * 24 * 60 * 60;
  const cutoffDate = new Date(cutoffSeconds * 1000);

  try {
    await db
      .update(messages)
      .set({ aiMessagesJson: null })
      .where(lt(messages.createdAt, cutoffDate));

    logger.log("Cleaned up old ai_messages_json entries");
  } catch (err) {
    logger.warn("Failed to cleanup old ai_messages_json:", err);
  }
}
