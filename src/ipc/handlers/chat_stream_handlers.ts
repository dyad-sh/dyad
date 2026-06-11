import { v4 as uuidv4 } from "uuid";
import { app, ipcMain, IpcMainInvokeEvent } from "electron";
import { createTypedHandler } from "./base";
import { chatContracts } from "../types/chat";
import { ModelMessage, ToolSet, type ToolExecutionOptions } from "ai";

import { db } from "../../db";
import { chats, messages, mcpServers } from "../../db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import { getDyadAppPath } from "../../paths/paths";
import type { ChatResponseEnd, ChatStreamParams } from "@/ipc/types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { extractCodebase } from "../../utils/codebase";
import { processFullResponseActions } from "../processors/response_processor";
import {
  streamTestResponse,
  getTestResponse,
  noteAck,
} from "./testing_chat_handlers";
import { getModelClient } from "../utils/get_model_client";
import log from "electron-log";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { validateChatContext } from "../utils/context_paths_utils";
import { requireMcpToolConsent } from "../utils/mcp_consent";

import { handleLocalAgentStream } from "../../pro/main/ipc/handlers/local_agent/local_agent_handler";

import { safeSend } from "../utils/safe_sender";
import { appendCancelledResponseNotice } from "@/shared/chatCancellation";
import {
  extractMentionedAppsCodebases,
  extractMentionedAppsReferences,
  type MentionedAppCodebaseEntry,
  type MentionedAppReference,
} from "../utils/mention_apps";
import { parseAppMentions } from "@/shared/parse_mention_apps";
import { mcpManager } from "../utils/mcp_manager";
import z from "zod";
import { isBasicAgentMode, isLocalAgentBackedMode } from "@/lib/schemas";
import { resolveChatModeForTurn } from "./chat_mode_resolution";
import {
  getFreeAgentQuotaStatus,
  markMessageAsUsingFreeAgentQuota,
  unmarkMessageAsUsingFreeAgentQuota,
} from "./free_agent_quota_handlers";
import { getCurrentCommitHash } from "../utils/git_utils";
import { getAiMessagesJsonIfWithinLimit } from "../utils/ai_messages_utils";
import { readSettings, setSentinelActiveChat } from "@/main/settings";
import {
  buildLocalAgentAttachmentInfo,
  hasScriptReadableAttachment,
  resolveAttachmentDeliveryConfig,
  type StoredChatAttachment,
} from "../utils/chat_attachment_utils";
import {
  chatAttachmentService,
  createAttachmentCollector,
} from "../services/chat_attachment_service";
import { PromptExpander } from "../services/prompt_expander";
import {
  buildMessageHistory,
  toHistoryChatMessages,
} from "../services/message_history_builder";
import { buildChatSystemPrompt } from "../services/chat_system_prompt_builder";
import { ChatStreamExecutor } from "../services/chat_stream_executor";
import {
  createCodebasePrompt,
  createOtherAppsCodebasePrompt,
  formatMessagesForSummary,
} from "../utils/chat_response_utils";

const logger = log.scope("chat_stream_handlers");

// Track active streams for cancellation
const activeStreams = new Map<number, AbortController>();

// Track partial responses for cancelled streams
const partialResponses = new Map<number, string>();

export function registerChatStreamHandlers() {
  // Abort in-flight LLM streams on quit so the process can exit promptly and
  // the module-level stream-tracking maps don't outlive their renderer.
  // (Guarded: `app` is undefined when this module is imported in unit tests.)
  app?.on?.("before-quit", () => {
    for (const controller of activeStreams.values()) {
      controller.abort();
    }
    activeStreams.clear();
    partialResponses.clear();
  });

  createTypedHandler(
    chatContracts.responseAck,
    async (_event, { chatId, lastSeq }) => {
      noteAck(chatId, lastSeq);
    },
  );

  ipcMain.handle("chat:stream", async (event, req: ChatStreamParams) => {
    const attachmentCollector = createAttachmentCollector();
    try {
      let dyadRequestId: string | undefined;
      // Create an AbortController for this stream
      const abortController = new AbortController();
      activeStreams.set(req.chatId, abortController);

      // Notify renderer that stream is starting
      safeSend(event.sender, "chat:stream:start", { chatId: req.chatId });

      // Get the chat to check for existing messages
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true, // Include app information
        },
      });

      if (!chat) {
        throw new DyadError(
          `Chat not found: ${req.chatId}`,
          DyadErrorKind.NotFound,
        );
      }

      // Record the streaming chat in the crash sentinel so a later force-close
      // can offer to upload it. We intentionally don't clear this when the
      // stream ends: the chat of the most recent stream stays the most likely
      // crash culprit even afterwards (its output stays mounted, and the
      // apply/build/preview steps run after the stream), so it remains the best
      // guess until the next stream replaces it. The latest stream wins, and the
      // value is cleared on clean exit.
      setSentinelActiveChat(req.chatId);

      // Handle redo option: remove the most recent messages if needed
      if (req.redo) {
        // Get the most recent messages
        const chatMessages = [...chat.messages];

        // Find the most recent user message
        let lastUserMessageIndex = chatMessages.length - 1;
        while (
          lastUserMessageIndex >= 0 &&
          chatMessages[lastUserMessageIndex].role !== "user"
        ) {
          lastUserMessageIndex--;
        }

        if (lastUserMessageIndex >= 0) {
          // Delete the user message
          await db
            .delete(messages)
            .where(eq(messages.id, chatMessages[lastUserMessageIndex].id));

          // If there's an assistant message after the user message, delete it too
          if (
            lastUserMessageIndex < chatMessages.length - 1 &&
            chatMessages[lastUserMessageIndex + 1].role === "assistant"
          ) {
            await db
              .delete(messages)
              .where(
                eq(messages.id, chatMessages[lastUserMessageIndex + 1].id),
              );
          }
        }
      }

      const appPath = getDyadAppPath(chat.app.path);

      // Process attachments if any. The AI-facing instructions go into the
      // user message; the display-facing <dyad-attachment> tags go into the
      // stored message content.
      const { attachmentInfo, displayAttachmentInfo } =
        await chatAttachmentService.persistIncomingAttachments({
          attachments: req.attachments ?? [],
          appPath,
          appRelativePath: chat.app.path,
          appId: chat.app.id,
          chatId: req.chatId,
          collector: attachmentCollector,
        });

      // Build the full AI prompt. Attachment-specific instructions are added
      // to the user message, never the system prompt.
      let userPrompt = req.prompt;
      // Build the display prompt (with <dyad-attachment> tags for inline rendering)
      // This separates what the user sees from what the AI receives.
      let displayUserPrompt: string | undefined;
      if (displayAttachmentInfo) {
        displayUserPrompt = req.prompt + displayAttachmentInfo;
      }

      const promptExpander = new PromptExpander({ db });
      // Inline referenced prompt contents for mentions like @prompt:<id>
      userPrompt = await promptExpander.expandPromptReferences(userPrompt);
      // Expand /slug skill references (e.g. /webapp-testing) to prompt content
      userPrompt = promptExpander.expandSlashSkills(userPrompt);

      // Resolve @media: mentions to image attachments
      ({ userPrompt, displayUserPrompt } =
        await chatAttachmentService.resolveMediaMentionAttachments({
          userPrompt,
          displayUserPrompt,
          originalPrompt: req.prompt,
          appRelativePath: chat.app.path,
          appName: chat.app.name,
          collector: attachmentCollector,
        }));

      const storedAttachments: StoredChatAttachment[] =
        await chatAttachmentService.finalizeStoredAttachments({
          appPath,
          collector: attachmentCollector,
        });

      // Expand /implement-plan= into full implementation prompt
      // Keep the original short form for display in the UI; the expanded
      // content is only injected into the AI message history.
      const implementPlanExpansion = await promptExpander.expandImplementPlan(
        userPrompt,
        appPath,
      );
      userPrompt = implementPlanExpansion.userPrompt;
      const implementPlanDisplayPrompt = implementPlanExpansion.displayPrompt;

      userPrompt = await promptExpander.appendSelectedComponents(
        userPrompt,
        appPath,
        req.selectedComponents || [],
      );

      const defaultAiUserPrompt =
        userPrompt + (attachmentInfo ? attachmentInfo : "");

      const [insertedUserMessage] = await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "user",
          content:
            implementPlanDisplayPrompt ??
            displayUserPrompt ??
            defaultAiUserPrompt,
        })
        .returning({ id: messages.id });
      const userMessageId = insertedUserMessage.id;
      const {
        settings: storedSettings,
        mode: selectedChatMode,
        fallbackReason: chatModeFallbackReason,
      } = await resolveChatModeForTurn({
        storedChatMode: chat.chatMode,
        requestedChatMode: req.requestedChatMode,
      });
      const settings = {
        ...storedSettings,
        selectedChatMode,
      };
      const hasImageAttachments = storedAttachments.some((attachment) =>
        attachment.mimeType.startsWith("image/"),
      );
      const hasUploadedAttachments = storedAttachments.some(
        (attachment) => attachment.attachmentType === "upload-to-codebase",
      );
      const attachmentDeliveryConfig = resolveAttachmentDeliveryConfig({
        mode: selectedChatMode,
        settings,
        hasImageAttachments,
        hasUploadedAttachments,
      });
      const localAgentAiUserPrompt =
        userPrompt +
        buildLocalAgentAttachmentInfo(
          storedAttachments,
          attachmentDeliveryConfig,
        );
      safeSend(event.sender, "chat:response:chunk", {
        chatId: req.chatId,
        effectiveChatMode: selectedChatMode,
        chatModeFallbackReason,
      });
      // Only Dyad Pro requests have request ids.
      if (settings.enableDyadPro) {
        // Generate requestId early so it can be saved with the message
        dyadRequestId = uuidv4();
      }

      // Add a placeholder assistant message immediately
      const [placeholderAssistantMessage] = await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "assistant",
          content: "", // Start with empty content
          requestId: dyadRequestId,
          model: settings.selectedModel.name,
          sourceCommitHash: await getCurrentCommitHash({
            path: getDyadAppPath(chat.app.path),
          }),
        })
        .returning();

      // Fetch updated chat data after possible deletions and additions
      const updatedChat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true, // Include app information
        },
      });

      if (!updatedChat) {
        throw new DyadError(
          `Chat not found: ${req.chatId}`,
          DyadErrorKind.NotFound,
        );
      }

      // Send the messages right away so that the loading state is shown for the message.
      safeSend(event.sender, "chat:response:chunk", {
        chatId: req.chatId,
        messages: updatedChat.messages,
      });

      let fullResponse = "";

      // Check if this is a test prompt
      const testResponse = getTestResponse(req.prompt);

      if (testResponse) {
        // For test prompts, use the dedicated function
        fullResponse = await streamTestResponse(
          event,
          req.chatId,
          testResponse,
          abortController,
          placeholderAssistantMessage.id,
        );
      } else {
        // Normal AI processing for non-test prompts
        const { modelClient, isEngineEnabled, isSmartContextEnabled } =
          await getModelClient(settings.selectedModel, settings);

        // When we don't have smart context enabled, we
        // only include the selected components' files for codebase context.
        //
        // If we have selected components and smart context is enabled,
        // we handle this specially below.
        const chatContext =
          req.selectedComponents &&
          req.selectedComponents.length > 0 &&
          !isSmartContextEnabled
            ? {
                contextPaths: req.selectedComponents.map((component) => ({
                  globPath: component.relativePath,
                })),
                smartContextAutoIncludes: [],
              }
            : validateChatContext(updatedChat.app.chatContext);

        // Extract codebase for current app
        const { formattedOutput: codebaseInfo, files } = await extractCodebase({
          appPath,
          chatContext,
        });

        // For smart context and selected components, we will mark the selected components' files as focused.
        // This means that we don't do the regular smart context handling, but we'll allow fetching
        // additional files through <dyad-read> as needed.
        if (
          isSmartContextEnabled &&
          req.selectedComponents &&
          req.selectedComponents.length > 0
        ) {
          const selectedPaths = new Set(
            req.selectedComponents.map((component) => component.relativePath),
          );
          for (const file of files) {
            if (selectedPaths.has(file.path)) {
              file.focused = true;
            }
          }
        }

        // Parse app mentions from the prompt
        const mentionedAppNames = parseAppMentions(req.prompt);

        const isLocalAgentMode = selectedChatMode === "local-agent";
        const isAskMode = selectedChatMode === "ask";
        const isPlanMode = selectedChatMode === "plan";
        const willUseLocalAgentStream =
          isLocalAgentBackedMode(selectedChatMode);

        // Agent/ask/plan modes reach referenced apps via tool calls (`app_name`
        // on read-only tools), so we only need name/path pairs — skip the heavy
        // codebase extraction entirely. Build mode still injects full codebases.
        let mentionedAppsCodebases: MentionedAppCodebaseEntry[] = [];
        let referencedAppsForAgent: MentionedAppReference[] = [];
        if (willUseLocalAgentStream) {
          referencedAppsForAgent = await extractMentionedAppsReferences(
            mentionedAppNames,
            updatedChat.app.id, // Exclude current app
          );
        } else {
          mentionedAppsCodebases = await extractMentionedAppsCodebases(
            mentionedAppNames,
            updatedChat.app.id, // Exclude current app
          );
          referencedAppsForAgent = mentionedAppsCodebases.map(
            ({ appName, appPath }) => ({ appName, appPath }),
          );
        }
        const useReferencedAppManifest =
          willUseLocalAgentStream && referencedAppsForAgent.length > 0;
        const effectiveAiUserPrompt =
          attachmentDeliveryConfig.useOnDiskAttachmentBlock
            ? localAgentAiUserPrompt
            : defaultAiUserPrompt;

        const isDeepContextEnabled =
          isEngineEnabled &&
          settings.enableProSmartFilesContextMode &&
          // Anything besides balanced will use deep context.
          settings.proSmartContextOption !== "balanced" &&
          referencedAppsForAgent.length === 0;
        logger.log(`isDeepContextEnabled: ${isDeepContextEnabled}`);

        // Combine current app codebase with mentioned apps' codebases.
        // In agent/ask/plan modes we skip the full codebase injection — the
        // model can read referenced apps on-demand via tool calls with `app_name`
        // instead of carrying their full contents in the system prompt.
        let otherAppsCodebaseInfo = "";
        if (mentionedAppsCodebases.length > 0 && !useReferencedAppManifest) {
          const mentionedAppsSection = mentionedAppsCodebases
            .map(
              ({ appName, codebaseInfo }) =>
                `\n\n=== Referenced App: ${appName} ===\n${codebaseInfo}`,
            )
            .join("");

          otherAppsCodebaseInfo = mentionedAppsSection;

          logger.log(
            `Added ${mentionedAppsCodebases.length} mentioned app codebases`,
          );
        }

        logger.log(`Extracted codebase information from ${appPath}`);
        logger.log(
          "codebaseInfo: length",
          codebaseInfo.length,
          "estimated tokens",
          codebaseInfo.length / 4,
        );

        // For Dyad Pro + Deep Context, we set to 200 chat turns (+1)
        // this is to enable more cache hits. Practically, users should
        // rarely go over this limit because they will hit the model's
        // context window limit.
        //
        // Limit chat history based on maxChatTurnsInContext setting
        // We add 1 because the current prompt counts as a turn.
        const maxChatTurns = isDeepContextEnabled
          ? 201
          : (settings.maxChatTurnsInContext || MAX_CHAT_TURNS_IN_CONTEXT) + 1;

        // Prepare message history for the AI. The DB stores display-friendly
        // versions (short /implement-plan= form or clean <dyad-attachment>
        // tags); replace the last user message with the full AI prompt so the
        // model receives expanded plan content or attachment paths.
        const limitedMessageHistory = buildMessageHistory({
          messages: updatedChat.messages.map((message) => ({
            role: message.role as "user" | "assistant" | "system",
            content: message.content,
            sourceCommitHash: message.sourceCommitHash,
            commitHash: message.commitHash,
          })),
          replaceLastUserMessageWith:
            implementPlanDisplayPrompt || displayUserPrompt
              ? effectiveAiUserPrompt
              : undefined,
          maxChatTurns,
        });

        const {
          systemPrompt,
          aiRules,
          themePrompt,
          frameworkType,
          isSummarizeIntent,
        } = await buildChatSystemPrompt({
          app: updatedChat.app,
          appPath,
          settings,
          selectedChatMode,
          requestPrompt: req.prompt,
          mentionedAppsCodebases,
          otherAppsCodebaseInfo,
          attachmentDeliveryConfig,
        });

        const codebasePrefix = isEngineEnabled
          ? // No codebase prefix if engine is set, we will take of it there.
            []
          : ([
              {
                role: "user",
                content: createCodebasePrompt(codebaseInfo),
              },
              {
                role: "assistant",
                content: "OK, got it. I'm ready to help",
              },
            ] as const);

        // If engine is enabled, we will send the other apps codebase info to the engine
        // and process it with smart context.
        const otherCodebasePrefix =
          otherAppsCodebaseInfo && !isEngineEnabled
            ? ([
                {
                  role: "user",
                  content: createOtherAppsCodebasePrompt(otherAppsCodebaseInfo),
                },
                {
                  role: "assistant",
                  content: "OK.",
                },
              ] as const)
            : [];

        const limitedHistoryChatMessages = toHistoryChatMessages({
          history: limitedMessageHistory,
          selectedChatMode,
        });

        let chatMessages: ModelMessage[] = [
          ...codebasePrefix,
          ...otherCodebasePrefix,
          ...limitedHistoryChatMessages,
        ];

        // Check if the last message should include attachments
        if (chatMessages.length >= 2) {
          const lastUserIndex = chatMessages.length - 2;
          const lastUserMessage = chatMessages[lastUserIndex];
          if (lastUserMessage.role === "user") {
            if (attachmentCollector.attachmentPaths.length > 0) {
              // Replace the last message with one that includes attachments
              chatMessages[lastUserIndex] =
                await chatAttachmentService.prepareMessageWithAttachments(
                  lastUserMessage,
                  attachmentCollector.attachmentPaths,
                  {
                    includeImageAttachments:
                      attachmentDeliveryConfig.includeImageParts,
                    inlineTextAttachments:
                      attachmentDeliveryConfig.inlineTextAttachments,
                  },
                );
            }
            // Save aiMessagesJson for modes that use handleLocalAgentStream
            // (which reads from DB and needs structured image content)

            if (willUseLocalAgentStream) {
              // Insert into DB (with size guard)
              const userAiMessagesJson = getAiMessagesJsonIfWithinLimit([
                chatMessages[lastUserIndex],
              ]);
              if (userAiMessagesJson) {
                await db
                  .update(messages)
                  .set({ aiMessagesJson: userAiMessagesJson })
                  .where(eq(messages.id, userMessageId));
              }
            }
          }
        } else {
          logger.warn(
            "Unexpected number of chat messages:",
            chatMessages.length,
          );
        }

        if (isSummarizeIntent) {
          const previousChat = await db.query.chats.findFirst({
            where: eq(chats.id, parseInt(req.prompt.split("=")[1])),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });
          chatMessages = [
            {
              role: "user",
              content:
                "Summarize the following chat: " +
                formatMessagesForSummary(previousChat?.messages ?? []),
            } satisfies ModelMessage,
          ];
        }

        const executor = new ChatStreamExecutor(
          {
            db,
            sendChunk: (payload) =>
              safeSend(event.sender, "chat:response:chunk", payload),
            // Note: intentionally not safeSend — matches original behavior of
            // surfacing stream errors even during teardown.
            sendError: (error) =>
              event.sender.send("chat:response:error", {
                chatId: req.chatId,
                error,
              }),
            onPartialResponse: (partial) =>
              partialResponses.set(req.chatId, partial),
            onStreamErrorCleanup: () => activeStreams.delete(req.chatId),
          },
          {
            chatId: req.chatId,
            appId: updatedChat.app.id,
            appPath,
            chatContext,
            placeholderMessageId: placeholderAssistantMessage.id,
            abortController,
            settings,
            modelClient,
            isEngineEnabled,
            isDeepContextEnabled,
            dyadRequestId,
            systemPrompt,
            mentionedAppsCodebases,
          },
        );

        // Handle ask mode: use local-agent in read-only mode
        // This gives users access to code reading tools while in ask mode
        // Ask mode does not consume free agent quota
        if (isAskMode) {
          // Reconstruct system prompt for local-agent read-only mode
          const readOnlySystemPrompt = constructSystemPrompt({
            aiRules,
            chatMode: "local-agent",
            enableTurboEditsV2: false,
            themePrompt,
            readOnly: true,
          });

          // Return value indicates success/failure for quota tracking.
          // Ask mode doesn't consume quota, but we still capture it for
          // consistent error handling.
          const streamSuccess = await handleLocalAgentStream(
            event,
            req,
            abortController,
            {
              placeholderMessageId: placeholderAssistantMessage.id,
              // Note: this is using the read-only system prompt rather than the
              // regular system prompt which gets overrides for special intents
              // like summarize chat, security review, etc.
              //
              // This is OK because those intents should always happen in a new chat
              // and new chats will default to non-ask modes.
              systemPrompt: readOnlySystemPrompt,
              dyadRequestId: dyadRequestId ?? "[no-request-id]",
              readOnly: true,
              messageOverride: isSummarizeIntent ? chatMessages : undefined,
              settingsOverride: settings,
              referencedApps: referencedAppsForAgent,
              currentTurnHasOnDiskAttachment:
                hasScriptReadableAttachment(storedAttachments),
            },
          );
          if (!streamSuccess) {
            logger.warn(
              "Ask mode local agent stream did not complete successfully",
            );
          }
          return;
        }

        // Handle plan mode: use local-agent with plan tools only
        // Plan mode is for requirements gathering and creating implementation plans
        if (isPlanMode) {
          // Reconstruct system prompt for plan mode
          const planModeSystemPrompt = constructSystemPrompt({
            aiRules,
            chatMode: "plan",
            enableTurboEditsV2: false,
            themePrompt,
          });

          await handleLocalAgentStream(event, req, abortController, {
            placeholderMessageId: placeholderAssistantMessage.id,
            systemPrompt: planModeSystemPrompt,
            dyadRequestId: dyadRequestId ?? "[no-request-id]",
            planModeOnly: true,
            messageOverride: isSummarizeIntent ? chatMessages : undefined,
            settingsOverride: settings,
            referencedApps: referencedAppsForAgent,
            currentTurnHasOnDiskAttachment: false,
          });
          return;
        }

        // Handle local-agent mode (Agent v2).
        // Referenced apps (from `@app:Name` mentions) are accessed by the
        // agent via tool calls with an `app_name` parameter — see
        // resolveTargetAppPath in the local agent tools. handleLocalAgentStream
        // injects a `<system-reminder>` into the user's latest message telling
        // the agent which `app_name` values are valid.
        if (isLocalAgentMode) {
          // Check quota for Basic Agent mode (non-Pro users)
          const isBasicAgentModeRequest = isBasicAgentMode(settings);
          if (isBasicAgentModeRequest) {
            const quotaStatus = await getFreeAgentQuotaStatus();
            if (quotaStatus.isQuotaExceeded) {
              safeSend(event.sender, "chat:response:error", {
                chatId: req.chatId,
                error: JSON.stringify({
                  type: "FREE_AGENT_QUOTA_EXCEEDED",
                  hoursUntilReset: quotaStatus.hoursUntilReset,
                  resetTime: quotaStatus.resetTime,
                }),
              });
              return;
            }
          }

          // Mark the user message as using quota BEFORE starting the stream
          // to prevent race conditions with parallel requests
          if (isBasicAgentModeRequest && userMessageId) {
            await markMessageAsUsingFreeAgentQuota(userMessageId);
          }

          let streamSuccess = false;
          try {
            streamSuccess = await handleLocalAgentStream(
              event,
              req,
              abortController,
              {
                placeholderMessageId: placeholderAssistantMessage.id,
                systemPrompt,
                dyadRequestId: dyadRequestId ?? "[no-request-id]",
                messageOverride: isSummarizeIntent ? chatMessages : undefined,
                settingsOverride: settings,
                referencedApps: referencedAppsForAgent,
                currentTurnHasOnDiskAttachment:
                  hasScriptReadableAttachment(storedAttachments),
              },
            );
          } finally {
            // If the stream failed, was aborted, or threw, refund the quota
            if (isBasicAgentModeRequest && userMessageId && !streamSuccess) {
              await unmarkMessageAsUsingFreeAgentQuota(userMessageId);
            }
          }

          return;
        }

        // Use MCP agent code path if:
        // 1. The enableMcpServersForBuildMode experiment is on AND
        // 2. Mode is "build" AND there are enabled MCP servers
        if (
          settings.enableMcpServersForBuildMode &&
          selectedChatMode === "build"
        ) {
          const tools = await getMcpTools(event, req.chatId);
          const hasEnabledMcpServers = Object.keys(tools).length > 0;

          // Only run MCP agent path if build mode has enabled MCP servers
          if (hasEnabledMcpServers) {
            const { fullStream } = await executor.streamSimple({
              chatMessages: limitedHistoryChatMessages,
              tools: {
                ...tools,
                "generate-code": {
                  description:
                    "ALWAYS use this tool whenever generating or editing code for the codebase.",
                  inputSchema: z.object({}),
                  execute: async () => "",
                },
              },
              systemPromptOverride: constructSystemPrompt({
                aiRules: await readAiRules(
                  getDyadAppPath(updatedChat.app.path),
                ),
                chatMode: "build",
                enableTurboEditsV2: false,
                frameworkType,
                hasSupabaseProject: !!updatedChat.app?.supabaseProjectId,
              }),
              files: files,
              dyadDisableFiles: true,
            });

            const result = await executor.processStreamChunks({
              fullStream,
              fullResponse,
            });
            fullResponse = result.fullResponse;
            chatMessages.push({
              role: "assistant",
              content: fullResponse,
            });
            chatMessages.push({
              role: "user",
              content: "OK.",
            });
          }
        }

        // Run the main stream plus recovery passes (Turbo Edits fixes,
        // unclosed dyad-write continuation, auto-fix problems).
        try {
          fullResponse = await executor.runMainStream({
            chatMessages,
            files,
            initialFullResponse: fullResponse,
          });
        } catch (streamError) {
          // Check if this was an abort error
          if (abortController.signal.aborted) {
            const chatId = req.chatId;
            const partialResponse = partialResponses.get(req.chatId) ?? "";
            try {
              // Update the placeholder assistant message with the partial content and cancellation note
              await db
                .update(messages)
                .set({
                  content: appendCancelledResponseNotice(partialResponse),
                })
                .where(eq(messages.id, placeholderAssistantMessage.id));

              logger.log(
                `Updated cancelled response for placeholder message ${placeholderAssistantMessage.id} in chat ${chatId}`,
              );
              partialResponses.delete(req.chatId);
            } catch (error) {
              logger.error(
                `Error saving partial response for chat ${chatId}:`,
                error,
              );
            }
            return req.chatId;
          }
          throw streamError;
        }
      }

      // If the stream was aborted but didn't throw (e.g. stream ended gracefully),
      // save the cancellation notice to the placeholder message.
      if (abortController.signal.aborted) {
        const partialResponse = partialResponses.get(req.chatId) ?? "";
        try {
          await db
            .update(messages)
            .set({
              content: appendCancelledResponseNotice(partialResponse),
            })
            .where(eq(messages.id, placeholderAssistantMessage.id));
          partialResponses.delete(req.chatId);
        } catch (error) {
          logger.error(
            `Error saving cancelled response for chat ${req.chatId}:`,
            error,
          );
        }
      }

      // Only save the response and process it if we weren't aborted
      if (!abortController.signal.aborted && fullResponse) {
        // Scrape from: <dyad-chat-summary>Renaming profile file</dyad-chat-title>
        const chatTitle = fullResponse.match(
          /<dyad-chat-summary>(.*?)<\/dyad-chat-summary>/,
        );
        if (chatTitle) {
          await db
            .update(chats)
            .set({ title: chatTitle[1] })
            .where(and(eq(chats.id, req.chatId), isNull(chats.title)));
        }
        const chatSummary = chatTitle?.[1];

        // Update the placeholder assistant message with the full response
        await db
          .update(messages)
          .set({ content: fullResponse })
          .where(eq(messages.id, placeholderAssistantMessage.id));
        const latestSettings = readSettings();
        if (latestSettings.autoApproveChanges && selectedChatMode !== "ask") {
          const status = await processFullResponseActions(
            fullResponse,
            req.chatId,
            {
              chatSummary,
              messageId: placeholderAssistantMessage.id,
            }, // Use placeholder ID
          );

          const chat = await db.query.chats.findFirst({
            where: eq(chats.id, req.chatId),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });

          safeSend(event.sender, "chat:response:chunk", {
            chatId: req.chatId,
            messages: chat!.messages,
          });

          if (status.error) {
            safeSend(event.sender, "chat:response:error", {
              chatId: req.chatId,
              error: `Sorry, there was an error applying the AI's changes: ${status.error}`,
              warningMessages: status.warningMessages,
            });
          }

          // Signal that the stream has completed
          safeSend(event.sender, "chat:response:end", {
            chatId: req.chatId,
            updatedFiles: status.updatedFiles ?? false,
            extraFiles: status.extraFiles,
            extraFilesError: status.extraFilesError,
            warningMessages: status.warningMessages,
            chatSummary,
          } satisfies ChatResponseEnd);
        } else {
          safeSend(event.sender, "chat:response:end", {
            chatId: req.chatId,
            updatedFiles: false,
            chatSummary,
          } satisfies ChatResponseEnd);
        }
      }

      // Return the chat ID for backwards compatibility
      return req.chatId;
    } catch (error) {
      logger.error("Error calling LLM:", error);
      safeSend(event.sender, "chat:response:error", {
        chatId: req.chatId,
        error: `Sorry, there was an error processing your request: ${error}`,
      });

      return "error";
    } finally {
      // Clean up the abort controller
      activeStreams.delete(req.chatId);

      // Notify renderer that stream has ended
      safeSend(event.sender, "chat:stream:end", { chatId: req.chatId });
    }
  });

  // Handler to cancel an ongoing stream
  createTypedHandler(chatContracts.cancelStream, async (event, chatId) => {
    const abortController = activeStreams.get(chatId);

    if (abortController) {
      // Abort the stream
      abortController.abort();
      activeStreams.delete(chatId);
      logger.log(`Aborted stream for chat ${chatId}`);
    } else {
      logger.warn(`No active stream found for chat ${chatId}`);
    }

    // Send the end event to the renderer with wasCancelled flag
    safeSend(event.sender, "chat:response:end", {
      chatId,
      updatedFiles: false,
      wasCancelled: true,
    } satisfies ChatResponseEnd);

    // Also emit stream:end so cleanup listeners (e.g., pending agent consents) fire
    safeSend(event.sender, "chat:stream:end", { chatId });

    return true;
  });
}

async function getMcpTools(
  event: IpcMainInvokeEvent,
  chatId: number,
): Promise<ToolSet> {
  const mcpToolSet: ToolSet = {};
  try {
    const servers = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true as any));
    for (const s of servers) {
      // One bad server (e.g. unconnected OAuth) must not strip tools
      // from every later enabled server in the same agent run.
      const toolSet = await (async () => {
        try {
          const client = await mcpManager.getClient(s.id);
          return await client.tools();
        } catch (e) {
          logger.warn(
            `Failed to load tools for MCP server ${s.id} (${s.name})`,
            e,
          );
          return null;
        }
      })();
      if (!toolSet) continue;
      for (const [name, mcpTool] of Object.entries(toolSet)) {
        const key = `${String(s.name || "").replace(/[^a-zA-Z0-9_-]/g, "-")}__${String(name).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        mcpToolSet[key] = {
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          execute: async (args: unknown, execCtx: ToolExecutionOptions) => {
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
              chatId,
            });

            if (!ok)
              throw new DyadError(
                `User declined running tool ${key}`,
                DyadErrorKind.UserCancelled,
              );
            const res = await mcpTool.execute(args, execCtx);

            return typeof res === "string" ? res : JSON.stringify(res);
          },
        };
      }
    }
  } catch (e) {
    logger.warn("Failed building MCP toolset", e);
  }
  return mcpToolSet;
}
