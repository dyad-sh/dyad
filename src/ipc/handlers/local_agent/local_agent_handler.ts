/**
 * Local Agent v2 Handler
 * Main orchestrator for tool-based agent mode with parallel execution
 */

import { IpcMainInvokeEvent } from "electron";
import { streamText, ToolSet, } from "ai";
import log from "electron-log";
import { db } from "../../../db";
import { chats, messages } from "../../../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

import { isDyadProEnabled } from "../../../lib/schemas";
import { readSettings } from "../../../main/settings";
import { getDyadAppPath } from "../../../paths/paths";
import { getModelClient } from "../../utils/get_model_client";
import { safeSend } from "../../utils/safe_sender";
import { getMaxTokens, getTemperature } from "../../utils/token_utils";
import { readAiRules } from "../../../prompts/system_prompt";
import { constructLocalAgentPrompt } from "../../../prompts/local_agent_prompt";
import { buildAgentToolSet, type ToolExecuteContext } from "./tool_definitions";
import { } from "./xml_tool_translator";
import {
  resetSharedModulesFlag,
  deployAllFunctionsIfNeeded,
  commitAllChanges,
  type FileOperationContext,
} from "../../processors/file_operations";
import { mcpManager } from "../../utils/mcp_manager";
import { mcpServers } from "../../../db/schema";
import { requireMcpToolConsent } from "../../utils/mcp_consent";
import { getCurrentCommitHash } from "../../utils/git_utils";
import type { ChatStreamParams, ChatResponseEnd } from "../../ipc_types";

const logger = log.scope("local_agent_handler");

type AsyncIterableStream<T> = AsyncIterable<T> & ReadableStream<T>;

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
): Promise<number | "error"> {
  const settings = readSettings();

  // Check Pro status
  if (!isDyadProEnabled(settings)) {
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error:
        "Agent v2 requires Dyad Pro. Please enable Dyad Pro in Settings → Pro.",
    });
    return "error";
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
  const dyadRequestId = uuidv4();

  // Add user message
  await db
    .insert(messages)
    .values({
      chatId: req.chatId,
      role: "user",
      content: req.prompt,
    })
    .returning();

  // Create placeholder assistant message
  const [placeholderMessage] = await db
    .insert(messages)
    .values({
      chatId: req.chatId,
      role: "assistant",
      content: "",
      requestId: dyadRequestId,
      sourceCommitHash: await getCurrentCommitHash({ path: appPath }),
    })
    .returning();

  // Fetch updated chat
  const updatedChat = await db.query.chats.findFirst({
    where: eq(chats.id, req.chatId),
    with: {
      messages: {
        orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      },
      app: true,
    },
  });

  if (!updatedChat) {
    throw new Error(`Chat not found: ${req.chatId}`);
  }

  // Send initial message update
  safeSend(event.sender, "chat:response:chunk", {
    chatId: req.chatId,
    messages: updatedChat.messages,
  });

  // Reset shared modules tracking
  resetSharedModulesFlag();

  let fullResponse = "";
  const writtenFiles: string[] = [];
  const deletedFiles: string[] = [];
  const renamedFiles: string[] = [];
  const packagesAdded: string[] = [];
  let sqlQueriesExecuted = 0;
  let chatSummary: string | undefined;

  try {
    // Build system prompt
    const systemPrompt = constructLocalAgentPrompt(
      await readAiRules(appPath),
    );

    // Get model client
    const { modelClient, isEngineEnabled } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Build tool execute context
    const toolCtx: ToolExecuteContext = {
      event,
      appPath,
      supabaseProjectId: chat.app.supabaseProjectId,
      messageId: placeholderMessage.id,
      onXmlChunk: (xml: string) => {
        fullResponse += xml + "\n";
        updateResponseInDb(placeholderMessage.id, fullResponse);
        sendResponseChunk(event, req.chatId, updatedChat, fullResponse);
      },
    };

    // Build tool set (agent tools + MCP tools)
    const agentTools = buildAgentToolSet(toolCtx);
    const mcpTools = await getMcpTools(event, toolCtx);
    const allTools: ToolSet = { ...agentTools, ...mcpTools };

    // Prepare message history
    const messageHistory = updatedChat.messages
      .filter((msg) => msg.content)
      .map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));

    // Stream the response
    const streamResult = streamText({
      model: modelClient.model,
      maxOutputTokens: await getMaxTokens(settings.selectedModel),
      temperature: await getTemperature(settings.selectedModel),
      maxRetries: 2,
      system: systemPrompt,
      messages: messageHistory,
      tools: allTools,
      maxSteps: 20, // Allow multiple tool call rounds
      abortSignal: abortController.signal,
      onFinish: async (response) => {
        const totalTokens = response.usage?.totalTokens;
        if (typeof totalTokens === "number") {
          await db
            .update(messages)
            .set({ maxTokensUsed: totalTokens })
            .where(eq(messages.id, placeholderMessage.id))
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
          // We track which files were modified
          trackToolExecution(
            part.toolName,
            part.args,
            writtenFiles,
            deletedFiles,
            renamedFiles,
            packagesAdded,
            () => sqlQueriesExecuted++,
            (summary) => (chatSummary = summary),
          );
          break;

        case "tool-result":
          // Tool results are already handled by the execute callback
          break;
      }

      if (chunk) {
        fullResponse += chunk;
        await updateResponseInDb(placeholderMessage.id, fullResponse);
        sendResponseChunk(event, req.chatId, updatedChat, fullResponse);
      }
    }

    // Close thinking block if still open
    if (inThinkingBlock) {
      fullResponse += "</think>\n";
      await updateResponseInDb(placeholderMessage.id, fullResponse);
    }

    // Deploy all Supabase functions if shared modules changed
    const opCtx: FileOperationContext = {
      appPath,
      supabaseProjectId: chat.app.supabaseProjectId,
    };
    await deployAllFunctionsIfNeeded(opCtx);

    // Commit all changes
    const commitResult = await commitAllChanges(
      opCtx,
      writtenFiles,
      deletedFiles,
      renamedFiles,
      packagesAdded,
      sqlQueriesExecuted,
      chatSummary,
    );

    if (commitResult.commitHash) {
      await db
        .update(messages)
        .set({ commitHash: commitResult.commitHash })
        .where(eq(messages.id, placeholderMessage.id));
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
      .where(eq(messages.id, placeholderMessage.id));

    // Send completion
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      updatedFiles:
        writtenFiles.length > 0 ||
        deletedFiles.length > 0 ||
        renamedFiles.length > 0,
      extraFiles: commitResult.extraFiles,
    } satisfies ChatResponseEnd);

    return req.chatId;
  } catch (error) {
    if (abortController.signal.aborted) {
      // Handle cancellation
      if (fullResponse) {
        await db
          .update(messages)
          .set({ content: `${fullResponse}\n\n[Response cancelled by user]` })
          .where(eq(messages.id, placeholderMessage.id));
      }
      return req.chatId;
    }

    logger.error("Local agent error:", error);
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error: `Error: ${error}`,
    });
    return "error";
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

function trackToolExecution(
  toolName: string,
  args: any,
  writtenFiles: string[],
  deletedFiles: string[],
  renamedFiles: string[],
  packagesAdded: string[],
  onSqlExecuted: () => void,
  onChatSummary: (summary: string) => void,
) {
  switch (toolName) {
    case "write_file":
      if (args.path && !writtenFiles.includes(args.path)) {
        writtenFiles.push(args.path);
      }
      break;
    case "delete_file":
      if (args.path && !deletedFiles.includes(args.path)) {
        deletedFiles.push(args.path);
      }
      break;
    case "rename_file":
      if (args.to && !renamedFiles.includes(args.to)) {
        renamedFiles.push(args.to);
      }
      break;
    case "search_replace":
      if (args.path && !writtenFiles.includes(args.path)) {
        writtenFiles.push(args.path);
      }
      break;
    case "add_dependency":
      if (Array.isArray(args.packages)) {
        for (const pkg of args.packages) {
          if (!packagesAdded.includes(pkg)) {
            packagesAdded.push(pkg);
          }
        }
      }
      break;
    case "execute_sql":
      onSqlExecuted();
      break;
    case "set_chat_summary":
      if (args.summary) {
        onChatSummary(args.summary);
      }
      break;
  }
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
            const resultStr = typeof res === "string" ? res : JSON.stringify(res);

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

