/**
 * Local Agent v2 Handler
 * Main orchestrator for tool-based agent mode with parallel execution
 */

import { IpcMainInvokeEvent } from "electron";
import { streamText, ToolSet, stepCountIs, ModelMessage } from "ai";
import log from "electron-log";
import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq } from "drizzle-orm";

import { readSettings } from "@/main/settings";
import { getJoyAppPath } from "@/paths/paths";
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
import { generateProblemReport } from "@/ipc/processors/tsc";
import { createProblemFixPrompt } from "@/shared/problem_prompt";
import { convertMarkdownCodeBlocksToJoyWrite } from "@/ipc/utils/markdown_to_joy_write";
import { processFullResponseActions } from "@/ipc/processors/response_processor";
import { getGitUncommittedFiles } from "@/ipc/utils/git_utils";

import type { ChatStreamParams, ChatResponseEnd } from "@/ipc/ipc_types";
import {
  AgentContext,
  parsePartialJson,
  escapeXmlAttr,
  escapeXmlContent,
} from "./tools/types";
import { TOOL_DEFINITIONS } from "./tool_definitions";
import { parseAiMessagesJson } from "@/ipc/utils/ai_messages_utils";
import { parseMcpToolKey, sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import {
  generateXmlToolDocumentation,
  parseXmlToolCalls,
  hasToolCalls,
  formatToolResults,
} from "./xml_tool_emulator";

const logger = log.scope("local_agent_handler");

// Local model providers that may not support function calling
const LOCAL_MODEL_PROVIDERS = ["ollama", "lmstudio"];

/**
 * Check if the selected model is a local model (Ollama, LM Studio, etc.)
 * Local models often don't support function calling/tools
 */
function isLocalModel(provider: string): boolean {
  return LOCAL_MODEL_PROVIDERS.includes(provider);
}

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
  }: { placeholderMessageId: number; systemPrompt: string },
): Promise<void> {
  const settings = readSettings();

  // All features are now free - no Pro check needed

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

  const appPath = getJoyAppPath(chat.app.path);

  // Generate request ID

  // Send initial message update
  safeSend(event.sender, "chat:response:chunk", {
    chatId: req.chatId,
    messages: chat.messages,
  });

  let fullResponse = "";
  let streamingPreview = ""; // Temporary preview for current tool, not persisted

  try {
    // Get model client
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Build tool execute context
    const ctx: AgentContext = {
      event,
      appPath,
      chatId: chat.id,
      supabaseProjectId: chat.app.supabaseProjectId,
      supabaseOrganizationSlug: chat.app.supabaseOrganizationSlug,
      messageId: placeholderMessageId,
      isSharedModulesChanged: false,
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
    };

    // Check if this is a local model that may not support tools
    const isLocal = isLocalModel(settings.selectedModel.provider);
    
    // Build tool set (agent tools + MCP tools)
    const agentTools = buildAgentToolSet(ctx);
    const mcpTools = isLocal ? {} : await getMcpTools(event, ctx);
    let allTools: ToolSet | undefined;
    if (!isLocal) {
      allTools = { ...agentTools, ...mcpTools };
    } else {
      logger.info("Local model detected — using XML tool emulation for agent loop");
      // For local models, we don't pass tools to streamText but handle them via XML parsing
      allTools = undefined;
    }

    // Prepare message history with graceful fallback
    const messageHistory: ModelMessage[] = chat.messages
      .filter((msg) => msg.content || msg.aiMessagesJson)
      .flatMap((msg) => parseAiMessagesJson(msg));

    // For local models, only expose essential tools to avoid overwhelming small models.
    // 17 tools with XML documentation is too much context for 7B models — they
    // get confused and output planning text instead of code.
    const LOCAL_ESSENTIAL_TOOLS = new Set(["write_file", "read_file", "list_files", "set_chat_summary", "search_replace", "add_dependency"]);
    const localToolDefs = isLocal
      ? TOOL_DEFINITIONS.filter((t) => LOCAL_ESSENTIAL_TOOLS.has(t.name))
      : TOOL_DEFINITIONS;

    // For local models, append XML tool documentation to the system prompt
    const effectiveSystemPrompt = isLocal
      ? systemPrompt + "\n\n" + generateXmlToolDocumentation(localToolDefs)
      : systemPrompt;

    // Stream the response
    const streamResult = streamText({
      model: modelClient.model,
      headers: getAiHeaders({
        builtinProviderId: modelClient.builtinProviderId,
      }),
      providerOptions: getProviderOptions({
        joyAppId: chat.app.id,
        joyDisableFiles: true, // Local agent uses tools, not file injection
        joyFiles: [],
        mentionedAppsCodebases: [],
        builtinProviderId: modelClient.builtinProviderId,
        settings,
      }),
      maxOutputTokens: await getMaxTokens(settings.selectedModel),
      temperature: await getTemperature(settings.selectedModel),
      maxRetries: 2,
      system: effectiveSystemPrompt,
      messages: messageHistory,
      ...(allTools ? { tools: allTools, stopWhen: stepCountIs(25) } : {}),
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
        const errorMessage = error?.error?.message || error?.message || JSON.stringify(error);
        logger.error("Local agent stream error:", errorMessage);
        
        // Check for "does not support tools" error
        let userFriendlyError = errorMessage;
        if (errorMessage.includes("does not support tools")) {
          // Extract model name from error message if present
          const modelMatch = errorMessage.match(/([^\s]+) does not support tools/);
          const modelName = modelMatch ? modelMatch[1] : "This model";
          userFriendlyError = `${modelName} does not support function calling/tools. Agent mode requires a model with tool support. Try using a different model like:\n• GPT-4 or GPT-4o (OpenAI)\n• Claude 3.5 (Anthropic)\n• Gemini Pro (Google)\n• Llama 3.1 or Mistral (with function calling support)\n\nOr switch to Chat mode which doesn't require tools.`;
        }
        
        safeSend(event.sender, "chat:response:error", {
          chatId: req.chatId,
          error: userFriendlyError,
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
        sendResponseChunk(event, req.chatId, chat, fullResponse);
      }
    }

    // Close thinking block if still open
    if (inThinkingBlock) {
      fullResponse += "</think>\n";
      await updateResponseInDb(placeholderMessageId, fullResponse);
    }

    // ===================================================================
    // XML Tool Emulation Loop (for local models only)
    // ===================================================================
    if (isLocal && !abortController.signal.aborted) {
      let xmlLoopStep = 0;
      const XML_MAX_STEPS = 15;
      let currentResponse = fullResponse;

      while (
        hasToolCalls(currentResponse.slice(currentResponse.lastIndexOf("</tool-result>") + 14 || 0)) &&
        xmlLoopStep < XML_MAX_STEPS &&
        !abortController.signal.aborted
      ) {
        xmlLoopStep++;
        logger.info(`XML tool emulation step ${xmlLoopStep}/${XML_MAX_STEPS}`);

        const { toolCalls, textSegments } = parseXmlToolCalls(
          // Only parse the latest response segment (after last tool-result, or full if first pass)
          xmlLoopStep === 1 ? currentResponse : currentResponse,
        );

        if (toolCalls.length === 0) break;

        // Execute each tool call
        const results: Array<{ toolName: string; result: string; isError?: boolean }> = [];

        for (const tc of toolCalls) {
          const toolDef = TOOL_DEFINITIONS.find((t) => t.name === tc.toolName);
          if (!toolDef) {
            results.push({
              toolName: tc.toolName,
              result: `Unknown tool: ${tc.toolName}. Available tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}`,
              isError: true,
            });
            continue;
          }

          try {
            // Check consent
            const allowed = await ctx.requireConsent({
              toolName: toolDef.name,
              toolDescription: toolDef.description,
              inputPreview: toolDef.getConsentPreview?.(tc.args) ?? JSON.stringify(tc.args).slice(0, 200),
            });

            if (!allowed) {
              results.push({
                toolName: tc.toolName,
                result: `User denied permission for ${tc.toolName}`,
                isError: true,
              });
              continue;
            }

            // Build XML preview for the tool call
            if (toolDef.buildXml) {
              const xml = toolDef.buildXml(tc.args, true);
              if (xml) ctx.onXmlComplete(xml);
            }

            // Execute the tool
            const result = await toolDef.execute(tc.args, ctx);
            results.push({ toolName: tc.toolName, result });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            results.push({ toolName: tc.toolName, result: errMsg, isError: true });
          }
        }

        // Format results and append to the response
        const resultsText = formatToolResults(results);
        fullResponse += "\n" + resultsText + "\n";
        await updateResponseInDb(placeholderMessageId, fullResponse);
        sendResponseChunk(event, req.chatId, chat, fullResponse);

        // Re-prompt the model with tool results for the next iteration
        const updatedHistory: ModelMessage[] = [
          ...messageHistory,
          { role: "assistant" as const, content: currentResponse },
          { role: "user" as const, content: resultsText + "\n\nContinue based on these tool results. Use more tool calls if needed, or provide your final response." },
        ];

        currentResponse = "";
        const continueResult = streamText({
          model: modelClient.model,
          headers: getAiHeaders({
            builtinProviderId: modelClient.builtinProviderId,
          }),
          providerOptions: getProviderOptions({
            joyAppId: chat.app.id,
            joyDisableFiles: true,
            joyFiles: [],
            mentionedAppsCodebases: [],
            builtinProviderId: modelClient.builtinProviderId,
            settings,
          }),
          maxOutputTokens: await getMaxTokens(settings.selectedModel),
          temperature: await getTemperature(settings.selectedModel),
          maxRetries: 2,
          system: effectiveSystemPrompt,
          messages: updatedHistory,
          abortSignal: abortController.signal,
        });

        for await (const part of continueResult.fullStream) {
          if (abortController.signal.aborted) break;
          if (part.type === "text-delta") {
            currentResponse += part.text;
            fullResponse += part.text;
            await updateResponseInDb(placeholderMessageId, fullResponse);
            sendResponseChunk(event, req.chatId, chat, fullResponse);
          }
        }
      }

      if (xmlLoopStep > 0) {
        logger.info(`XML tool emulation completed after ${xmlLoopStep} steps`);
      }
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

    // ===================================================================
    // Fallback: if the model produced no tool calls but output markdown
    // code blocks or joy-write tags, apply them via the standard processor.
    // This catches weak local models that ignore XML tool instructions.
    // ===================================================================
    if (!abortController.signal.aborted && fullResponse.length > 50) {
      const uncommittedBefore = await getGitUncommittedFiles({ path: appPath }).catch(() => []);
      // Run fallback if:
      // 1. No files were written by agent tools (uncommitted === 0), OR
      // 2. The response contains joy-write or convertible markdown despite tool changes
      //    (mixed output — model used tools for some files, markdown for others)
      const converted = convertMarkdownCodeBlocksToJoyWrite(fullResponse);
      const hasJoyWriteTags = /<(?:joy|dyad)-write\s/i.test(converted);
      if (hasJoyWriteTags) {
        // Only process if there are actual joy-write tags after conversion
        // (avoiding double-processing if tools already wrote these exact files)
        logger.info(
          uncommittedBefore.length === 0
            ? "No files written by agent tools — applying joy-write fallback"
            : "Agent tools wrote some files, but response also contains joy-write/markdown — applying hybrid fallback",
        );
        const chatSummaryMatch = converted.match(/<joy-chat-summary>(.*?)<\/joy-chat-summary>/);
        await processFullResponseActions(converted, req.chatId, {
          chatSummary: chatSummaryMatch?.[1],
          messageId: placeholderMessageId,
        });
        fullResponse = converted;
        await updateResponseInDb(placeholderMessageId, fullResponse);
        sendResponseChunk(event, req.chatId, chat, fullResponse);
      } else if (uncommittedBefore.length === 0) {
        // The model produced only planning text / no code at all.
        // Re-prompt with a focused instruction to force code generation.
        logger.warn(
          "Model response had no code output — retrying with focused code generation prompt",
        );

        const retryPrompt =
          "You did not write any code. Please write the actual code files NOW using write_file. " +
          "Do not describe or plan — immediately create the files. " +
          "Start with src/pages/Index.tsx as the main page.";

        const retryMessages: ModelMessage[] = [
          ...messageHistory,
          { role: "assistant" as const, content: fullResponse },
          { role: "user" as const, content: retryPrompt },
        ];

        let retryResponse = "";
        const retryResult = streamText({
          model: modelClient.model,
          headers: getAiHeaders({
            builtinProviderId: modelClient.builtinProviderId,
          }),
          providerOptions: getProviderOptions({
            joyAppId: chat.app.id,
            joyDisableFiles: true,
            joyFiles: [],
            mentionedAppsCodebases: [],
            builtinProviderId: modelClient.builtinProviderId,
            settings,
          }),
          maxOutputTokens: await getMaxTokens(settings.selectedModel),
          temperature: await getTemperature(settings.selectedModel),
          maxRetries: 2,
          system: effectiveSystemPrompt,
          messages: retryMessages,
          abortSignal: abortController.signal,
        });

        for await (const part of retryResult.fullStream) {
          if (abortController.signal.aborted) break;
          if (part.type === "text-delta") {
            retryResponse += part.text;
            fullResponse += part.text;
            await updateResponseInDb(placeholderMessageId, fullResponse);
            sendResponseChunk(event, req.chatId, chat, fullResponse);
          }
        }

        // Try conversion on the retry response
        if (retryResponse.length > 50) {
          const retryConverted = convertMarkdownCodeBlocksToJoyWrite(retryResponse);
          const retryHasTags = /<(?:joy|dyad)-write\s/i.test(retryConverted);
          if (retryHasTags) {
            logger.info("Retry produced convertible code — applying joy-write fallback");
            const chatSummaryMatch = retryConverted.match(/<joy-chat-summary>(.*?)<\/joy-chat-summary>/);
            await processFullResponseActions(retryConverted, req.chatId, {
              chatSummary: chatSummaryMatch?.[1],
              messageId: placeholderMessageId,
            });
            // Update the full response with the converted version
            fullResponse = fullResponse.replace(retryResponse, retryConverted);
            await updateResponseInDb(placeholderMessageId, fullResponse);
            sendResponseChunk(event, req.chatId, chat, fullResponse);
          } else {
            logger.warn(
              "Retry also produced no code. The model may not be capable enough for structured code generation. " +
              "Consider using a larger model or Build mode.",
            );
          }
        }
      }
    }

    // ===================================================================
    // Post-agent verification: check for TypeScript errors and auto-fix
    // ===================================================================
    if (!abortController.signal.aborted) {
      try {
        const problemReport = await generateProblemReport({
          fullResponse: "", // empty = check disk state directly
          appPath,
        });

        if (problemReport.problems.length > 0) {
          logger.info(
            `Post-agent verification found ${problemReport.problems.length} TS errors, requesting fix...`,
          );

          const fixPrompt = createProblemFixPrompt(problemReport);

          // Append the problem report to the response for visibility
          fullResponse += `\n<joy-problem-report summary="${problemReport.problems.length} problems found after implementation">
${problemReport.problems.map((p) => `<problem file="${p.file}" line="${p.line}" column="${p.column}" code="${p.code}">${p.message}</problem>`).join("\n")}
</joy-problem-report>\n`;
          await updateResponseInDb(placeholderMessageId, fullResponse);
          sendResponseChunk(event, req.chatId, chat, fullResponse);

          // Send a follow-up fix request through the same agent loop
          // (uses the remaining step budget from the original 25)
          const { modelClient: fixModelClient } = await getModelClient(
            settings.selectedModel,
            settings,
          );

          // Rebuild message history including the fix request
          const fixMessages: ModelMessage[] = [
            ...chat.messages
              .filter((msg) => msg.content || msg.aiMessagesJson)
              .flatMap((msg) => parseAiMessagesJson(msg)),
            { role: "assistant" as const, content: fullResponse },
            { role: "user" as const, content: fixPrompt },
          ];

          const fixResult = streamText({
            model: fixModelClient.model,
            headers: getAiHeaders({
              builtinProviderId: fixModelClient.builtinProviderId,
            }),
            providerOptions: getProviderOptions({
              joyAppId: chat.app.id,
              joyDisableFiles: true,
              joyFiles: [],
              mentionedAppsCodebases: [],
              builtinProviderId: fixModelClient.builtinProviderId,
              settings,
            }),
            maxOutputTokens: await getMaxTokens(settings.selectedModel),
            temperature: await getTemperature(settings.selectedModel),
            maxRetries: 2,
            system: systemPrompt,
            messages: fixMessages,
            ...(allTools
              ? { tools: allTools, stopWhen: stepCountIs(10) }
              : {}),
            abortSignal: abortController.signal,
          });

          for await (const part of fixResult.fullStream) {
            if (abortController.signal.aborted) break;

            let chunk = "";
            switch (part.type) {
              case "text-delta":
                chunk = part.text;
                break;
              case "tool-input-start":
                getOrCreateStreamingEntry(part.id, part.toolName);
                break;
              case "tool-input-delta": {
                const entry = getOrCreateStreamingEntry(part.id);
                if (entry) {
                  entry.argsAccumulated += part.delta;
                  const toolDef = findToolDefinition(entry.toolName);
                  if (toolDef?.buildXml) {
                    const argsPartial = parsePartialJson(
                      entry.argsAccumulated,
                    );
                    const xml = toolDef.buildXml(argsPartial, false);
                    if (xml) ctx.onXmlStream(xml);
                  }
                }
                break;
              }
              case "tool-input-end": {
                const entry = getOrCreateStreamingEntry(part.id);
                if (entry) {
                  const toolDef = findToolDefinition(entry.toolName);
                  if (toolDef?.buildXml) {
                    const argsPartial = parsePartialJson(
                      entry.argsAccumulated,
                    );
                    const xml = toolDef.buildXml(argsPartial, true);
                    if (xml) ctx.onXmlComplete(xml);
                  }
                }
                cleanupStreamingEntry(part.id);
                break;
              }
            }
            if (chunk) {
              fullResponse += chunk;
              await updateResponseInDb(placeholderMessageId, fullResponse);
              sendResponseChunk(event, req.chatId, chat, fullResponse);
            }
          }
        }
      } catch (verifyError) {
        logger.warn("Post-agent verification failed (non-fatal):", verifyError);
      }
    }

    // Deploy all Supabase functions if shared modules changed
    await deployAllFunctionsIfNeeded(ctx);

    // Commit all changes
    const commitResult = await commitAllChanges(ctx, ctx.chatSummary);

    const hasCommit = !!commitResult.commitHash;

    if (commitResult.commitHash) {
      await db
        .update(messages)
        .set({ commitHash: commitResult.commitHash })
        .where(eq(messages.id, placeholderMessageId));
    }

    // Mark as approved (auto-approve for local-agent)
    await db
      .update(messages)
      .set({ approvalState: "approved" })
      .where(eq(messages.id, placeholderMessageId));

    // Detect if no files were actually written despite the model responding
    if (!hasCommit && fullResponse.length > 100) {
      logger.warn(
        "Agent completed but no files were modified. The model may not be capable enough " +
        "for structured code generation. Consider using a larger model (>=7B) or Build mode.",
      );
    }

    // Send completion
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      updatedFiles: hasCommit,
    } satisfies ChatResponseEnd);

    return;
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

      for (const [name, tool] of Object.entries(toolSet)) {
        const key = `${sanitizeMcpName(s.name || "")}__${sanitizeMcpName(name)}`;
        const original = tool;

        mcpToolSet[key] = {
          description: original?.description,
          inputSchema: original?.inputSchema,
          execute: async (args: any, execCtx: any) => {
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
                toolDescription: original?.description,
                inputPreview,
              });

              if (!ok) throw new Error(`User declined running tool ${key}`);

              // Emit XML for UI (MCP tools don't stream, so use onXmlComplete directly)
              const { serverName, toolName } = parseMcpToolKey(key);
              const content = JSON.stringify(args, null, 2);
              ctx.onXmlComplete(
                `<joy-mcp-tool-call server="${serverName}" tool="${toolName}">\n${content}\n</joy-mcp-tool-call>`,
              );

              const res = await original.execute?.(args, execCtx);
              const resultStr =
                typeof res === "string" ? res : JSON.stringify(res);

              ctx.onXmlComplete(
                `<joy-mcp-tool-result server="${serverName}" tool="${toolName}">\n${resultStr}\n</joy-mcp-tool-result>`,
              );

              return resultStr;
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              const errorStack =
                error instanceof Error && error.stack ? error.stack : "";
              ctx.onXmlComplete(
                `<joy-output type="error" message="MCP tool '${key}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorStack || errorMessage)}</joy-output>`,
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
