import log from "electron-log";
import {
  ModelMessage,
  streamText,
  ToolSet,
  TextStreamPart,
  stepCountIs,
  hasToolCall,
} from "ai";
import type { SmartContextMode, UserSettings } from "@/lib/schemas";
import { isTurboEditsV2Enabled } from "@/lib/schemas";
import type { db as DbType } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AI_STREAMING_ERROR_MESSAGE_PREFIX } from "@/shared/texts";
import { AsyncVirtualFileSystem } from "../../../shared/VirtualFilesystem";
import { escapeXmlAttr, escapeXmlContent } from "../../../shared/xmlEscape";
import { createProblemFixPrompt } from "@/shared/problem_prompt";
import {
  CodebaseFile,
  extractCodebase,
  readFileWithCache,
} from "@/utils/codebase";
import { dryRunSearchReplace } from "../processors/response_processor";
import { generateProblemReport } from "../processors/tsc";
import { getModelClient, ModelClient } from "../utils/get_model_client";
import { getMaxTokens, getTemperature } from "../utils/token_utils";
import { getProviderOptions, getAiHeaders } from "../utils/provider_options";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  cancelOrphanedBaseStream,
  computeStreamingPatch,
} from "../utils/stream_text_utils";
import { cleanFullResponse } from "../utils/cleanFullResponse";
import {
  getDyadAddDependencyTags,
  getDyadWriteTags,
  getDyadDeleteTags,
  getDyadRenameTags,
} from "../utils/dyad_tag_parser";
import { fileExists } from "../utils/file_utils";
import {
  processChatMessagesWithVersionedFiles as getVersionedFiles,
  VersionedFiles,
} from "../utils/versioned_codebase_context";
import type { MentionedAppCodebaseEntry } from "../utils/mention_apps";
import type { AppChatContext } from "@/lib/schemas";
import {
  CODEBASE_PROMPT_PREFIX,
  createCodebasePrompt,
  escapeDyadTags,
  hasUnclosedDyadWrite,
  removeNonEssentialTags,
} from "../utils/chat_response_utils";

type AsyncIterableStream<T> = AsyncIterable<T> & ReadableStream<T>;

const logger = log.scope("chat_stream_executor");

// Safely parse an MCP tool key that combines server and tool names.
// We split on the LAST occurrence of "__" to avoid ambiguity if either
// side contains "__" as part of its sanitized name.
export function parseMcpToolKey(toolKey: string): {
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

export interface ChatStreamExecutorConfig {
  chatId: number;
  appId: number;
  appPath: string;
  chatContext: AppChatContext;
  placeholderMessageId: number;
  abortController: AbortController;
  settings: UserSettings;
  modelClient: ModelClient;
  isEngineEnabled: boolean | undefined;
  isDeepContextEnabled: boolean | undefined;
  dyadRequestId: string | undefined;
  systemPrompt: string;
  mentionedAppsCodebases: MentionedAppCodebaseEntry[];
}

export interface ChatStreamExecutorDeps {
  db: typeof DbType;
  /** Sends a chat:response:chunk payload to the renderer. */
  sendChunk: (payload: Record<string, unknown>) => void;
  /** Sends a chat:response:error message to the renderer. */
  sendError: (errorMessage: string) => void;
  /** Records the in-progress response (for cancellation recovery). */
  onPartialResponse: (fullResponse: string) => void;
  /** Cleans up stream tracking when the model reports a stream error. */
  onStreamErrorCleanup: () => void;
  /** Injectable for tests; defaults to the AI SDK's streamText. */
  streamTextImpl?: typeof streamText;
}

/**
 * Runs the build-mode AI stream for one chat turn (Phase 2 extraction from
 * chat_stream_handlers.ts): the streamText call with Dyad provider options,
 * chunk-to-renderer fan-out with tail-diff patches and throttled DB saves,
 * plus the recovery loops — Turbo Edits search-replace fixes, unclosed
 * dyad-write continuation, and auto-fix problems.
 *
 * All renderer/DB side effects flow through the injected deps, so the
 * executor can be unit-tested with a fake streamText and in-memory db.
 */
export class ChatStreamExecutor {
  private maxTokensUsed: number | undefined;
  private lastDbSaveAt = 0;
  // Tracks what was last sent to the renderer so we can emit only the
  // tail diff. `cleanFullResponse` may retroactively rewrite earlier
  // bytes inside an in-progress dyad-tag's attribute values, so we
  // compute the longest common prefix on each send rather than
  // assuming pure appends.
  private lastSentContent = "";

  constructor(
    private readonly deps: ChatStreamExecutorDeps,
    private readonly config: ChatStreamExecutorConfig,
  ) {}

  /** Single streamText pass with Dyad provider options. */
  async streamSimple({
    chatMessages,
    modelClient = this.config.modelClient,
    tools,
    systemPromptOverride = this.config.systemPrompt,
    dyadDisableFiles = false,
    files,
  }: {
    chatMessages: ModelMessage[];
    modelClient?: ModelClient;
    files: CodebaseFile[];
    tools?: ToolSet;
    systemPromptOverride?: string;
    dyadDisableFiles?: boolean;
  }) {
    const {
      abortController,
      appId,
      appPath,
      chatId,
      dyadRequestId,
      isDeepContextEnabled,
      isEngineEnabled,
      mentionedAppsCodebases,
      placeholderMessageId,
      settings,
    } = this.config;
    const streamTextImpl = this.deps.streamTextImpl ?? streamText;

    if (isEngineEnabled) {
      logger.log(
        "sending AI request to engine with request id:",
        dyadRequestId,
      );
    } else {
      logger.log("sending AI request");
    }
    let versionedFiles: VersionedFiles | undefined;
    if (isDeepContextEnabled) {
      versionedFiles = await getVersionedFiles({
        files,
        chatMessages,
        appPath,
      });
    }
    const smartContextMode: SmartContextMode = isDeepContextEnabled
      ? "deep"
      : "balanced";
    const providerOptions = getProviderOptions({
      dyadAppId: appId,
      dyadRequestId,
      dyadDisableFiles,
      smartContextMode,
      files,
      versionedFiles,
      mentionedAppsCodebases,
      builtinProviderId: modelClient.builtinProviderId,
      settings,
    });

    const streamResult = streamTextImpl({
      headers: getAiHeaders({
        builtinProviderId: modelClient.builtinProviderId,
      }),
      maxOutputTokens: await getMaxTokens(settings.selectedModel),
      temperature: await getTemperature(settings.selectedModel),
      maxRetries: 2,
      model: modelClient.model,
      stopWhen: [stepCountIs(20), hasToolCall("edit-code")],
      providerOptions,
      system: systemPromptOverride,
      tools,
      messages: chatMessages.filter((m) => m.content),
      onFinish: async (response) => {
        const totalTokens = response.usage?.totalTokens;

        if (typeof totalTokens === "number") {
          // We use the highest total tokens used (we are *not* accumulating)
          // since we're trying to figure it out if we're near the context limit.
          this.maxTokensUsed = Math.max(this.maxTokensUsed ?? 0, totalTokens);

          // Persist the aggregated token usage on the placeholder assistant message
          await this.deps.db
            .update(messages)
            .set({ maxTokensUsed: this.maxTokensUsed })
            .where(eq(messages.id, placeholderMessageId))
            .catch((error) => {
              logger.error(
                "Failed to save total tokens for assistant message",
                error,
              );
            });

          logger.log(
            `Total tokens used (aggregated for message ${placeholderMessageId}): ${this.maxTokensUsed}`,
          );
        } else {
          logger.log("Total tokens used: unknown");
        }
      },
      onError: (error: any) => {
        let errorMessage = (error as any)?.error?.message;
        const responseBody = error?.error?.responseBody;
        if (errorMessage && responseBody) {
          errorMessage += "\n\nDetails: " + responseBody;
        }
        const message = errorMessage || JSON.stringify(error);
        const requestIdPrefix = isEngineEnabled
          ? `[Request ID: ${dyadRequestId}] `
          : "";
        logger.error(
          `AI stream text error for request: ${requestIdPrefix} errorMessage=${errorMessage} error=`,
          error,
        );
        this.deps.sendError(
          `${AI_STREAMING_ERROR_MESSAGE_PREFIX}${requestIdPrefix}${message}`,
        );
        // Clean up the abort controller
        this.deps.onStreamErrorCleanup();
        // The chatId is needed by callers wiring sendError; log for parity.
        void chatId;
      },
      abortSignal: abortController.signal,
    });
    // Read .fullStream now (not lazily) so the SDK's `teeStream()`
    // runs synchronously, then cancel the orphaned tee branch
    // before any chunks are pumped. See `cancelOrphanedBaseStream`
    // for the underlying SDK behavior and why this is required.
    const fullStream = streamResult.fullStream;
    cancelOrphanedBaseStream(streamResult);
    return {
      fullStream,
      usage: streamResult.usage,
    };
  }

  /**
   * Persists the in-progress response (throttled) and sends the tail-diff
   * patch to the renderer.
   */
  async processChunkUpdate({
    fullResponse,
  }: {
    fullResponse: string;
  }): Promise<string> {
    // Store the current partial response
    this.deps.onPartialResponse(fullResponse);
    // Save to DB (in case user is switching chats during the stream)
    const now = Date.now();
    if (now - this.lastDbSaveAt >= 150) {
      await this.deps.db
        .update(messages)
        .set({ content: fullResponse })
        .where(eq(messages.id, this.config.placeholderMessageId));

      this.lastDbSaveAt = now;
    }

    const patch = computeStreamingPatch(fullResponse, this.lastSentContent);
    this.lastSentContent = fullResponse;
    if (!patch) {
      return fullResponse;
    }
    this.deps.sendChunk({
      chatId: this.config.chatId,
      streamingMessageId: this.config.placeholderMessageId,
      streamingPatch: patch,
    });
    return fullResponse;
  }

  /** Folds stream parts (text, reasoning, MCP tool calls) into the response. */
  async processStreamChunks({
    fullStream,
    fullResponse,
  }: {
    fullStream: AsyncIterableStream<TextStreamPart<ToolSet>>;
    fullResponse: string;
  }): Promise<{ fullResponse: string; incrementalResponse: string }> {
    let incrementalResponse = "";
    let inThinkingBlock = false;

    for await (const part of fullStream) {
      let chunk = "";
      if (
        inThinkingBlock &&
        !["reasoning-delta", "reasoning-end", "reasoning-start"].includes(
          part.type,
        )
      ) {
        chunk = "</think>";
        inThinkingBlock = false;
      }
      if (part.type === "text-delta") {
        chunk += part.text;
      } else if (part.type === "reasoning-delta") {
        if (!inThinkingBlock) {
          chunk = "<think>";
          inThinkingBlock = true;
        }

        chunk += escapeDyadTags(part.text);
      } else if (part.type === "tool-call") {
        const { serverName, toolName } = parseMcpToolKey(part.toolName);
        const content = escapeDyadTags(JSON.stringify(part.input));
        chunk = `<dyad-mcp-tool-call server="${serverName}" tool="${toolName}">\n${content}\n</dyad-mcp-tool-call>\n`;
      } else if (part.type === "tool-result") {
        const { serverName, toolName } = parseMcpToolKey(part.toolName);
        const content = escapeDyadTags(part.output);
        chunk = `<dyad-mcp-tool-result server="${serverName}" tool="${toolName}">\n${content}\n</dyad-mcp-tool-result>\n`;
      }

      if (!chunk) {
        continue;
      }

      fullResponse += chunk;
      incrementalResponse += chunk;
      fullResponse = cleanFullResponse(fullResponse);
      fullResponse = await this.processChunkUpdate({ fullResponse });

      // If the stream was aborted, exit early
      if (this.config.abortController.signal.aborted) {
        logger.log(`Stream for chat ${this.config.chatId} was aborted`);
        break;
      }
    }

    return { fullResponse, incrementalResponse };
  }

  /**
   * Runs the main stream plus recovery passes: Turbo Edits search-replace
   * fixes, unclosed dyad-write continuation, and auto-fix problems.
   */
  async runMainStream({
    chatMessages,
    files,
    initialFullResponse = "",
  }: {
    chatMessages: ModelMessage[];
    files: CodebaseFile[];
    initialFullResponse?: string;
  }): Promise<string> {
    const { abortController, appPath, chatContext, chatId, settings } =
      this.config;

    const { fullStream } = await this.streamSimple({
      chatMessages,
      files,
    });

    const result = await this.processStreamChunks({
      fullStream,
      fullResponse: initialFullResponse,
    });
    let fullResponse = result.fullResponse;

    if (isTurboEditsV2Enabled(settings)) {
      let issues = await dryRunSearchReplace({
        fullResponse,
        appPath,
      });
      sendTelemetryEvent("search_replace:fix", {
        attemptNumber: 0,
        success: issues.length === 0,
        issueCount: issues.length,
        errors: issues.map((i) => ({
          filePath: i.filePath,
          error: i.error,
        })),
      });

      let searchReplaceFixAttempts = 0;
      const originalFullResponse = fullResponse;
      const previousAttempts: ModelMessage[] = [];
      while (
        issues.length > 0 &&
        searchReplaceFixAttempts < 2 &&
        !abortController.signal.aborted
      ) {
        logger.warn(
          `Detected search-replace issues (attempt #${searchReplaceFixAttempts + 1}): ${issues.map((i) => i.error).join(", ")}`,
        );
        const formattedSearchReplaceIssues = issues
          .map(({ filePath, error }) => {
            return `File path: ${filePath}\nError: ${error}`;
          })
          .join("\n\n");

        fullResponse += `<dyad-output type="warning" message="Could not apply Turbo Edits properly for some of the files; re-generating code...">${formattedSearchReplaceIssues}</dyad-output>`;
        await this.processChunkUpdate({ fullResponse });

        logger.info(
          `Attempting to fix search-replace issues, attempt #${searchReplaceFixAttempts + 1}`,
        );

        const fixSearchReplacePrompt =
          searchReplaceFixAttempts === 0
            ? `There was an issue with the following \`dyad-search-replace\` tags. Make sure you use \`dyad-read\` to read the latest version of the file and then trying to do search & replace again.`
            : `There was an issue with the following \`dyad-search-replace\` tags. Please fix the errors by generating the code changes using \`dyad-write\` tags instead.`;
        searchReplaceFixAttempts++;
        const userPrompt = {
          role: "user",
          content: `${fixSearchReplacePrompt}\n                \n${formattedSearchReplaceIssues}`,
        } as const;

        const { fullStream: fixSearchReplaceStream } = await this.streamSimple({
          // Build messages: reuse chat history and original full response, then ask to fix search-replace issues.
          chatMessages: [
            ...chatMessages,
            { role: "assistant", content: originalFullResponse },
            ...previousAttempts,
            userPrompt,
          ],
          files,
        });
        previousAttempts.push(userPrompt);
        const result = await this.processStreamChunks({
          fullStream: fixSearchReplaceStream,
          fullResponse,
        });
        fullResponse = result.fullResponse;
        previousAttempts.push({
          role: "assistant",
          content: removeNonEssentialTags(result.incrementalResponse),
        });

        // Re-check for issues after the fix attempt
        issues = await dryRunSearchReplace({
          fullResponse: result.incrementalResponse,
          appPath,
        });

        sendTelemetryEvent("search_replace:fix", {
          attemptNumber: searchReplaceFixAttempts,
          success: issues.length === 0,
          issueCount: issues.length,
          errors: issues.map((i) => ({
            filePath: i.filePath,
            error: i.error,
          })),
        });
      }
    }

    if (!abortController.signal.aborted && hasUnclosedDyadWrite(fullResponse)) {
      let continuationAttempts = 0;
      while (
        hasUnclosedDyadWrite(fullResponse) &&
        continuationAttempts < 2 &&
        !abortController.signal.aborted
      ) {
        logger.warn(
          `Received unclosed dyad-write tag, attempting to continue, attempt #${continuationAttempts + 1}`,
        );
        continuationAttempts++;

        const { fullStream: contStream } = await this.streamSimple({
          // Build messages: replay history, then ask the model to continue from the partial response.
          chatMessages: [
            ...chatMessages,
            {
              role: "assistant",
              content: fullResponse,
            },
            {
              role: "user",
              content:
                "Your previous response did not finish completely. Continue exactly where you left off without any preamble.",
            },
          ],
          files,
        });
        for await (const part of contStream) {
          // If the stream was aborted, exit early
          if (abortController.signal.aborted) {
            logger.log(`Stream for chat ${chatId} was aborted`);
            break;
          }
          if (part.type !== "text-delta") continue; // ignore reasoning for continuation
          fullResponse += part.text;
          fullResponse = cleanFullResponse(fullResponse);
          fullResponse = await this.processChunkUpdate({ fullResponse });
        }
      }
    }
    const addDependencies = getDyadAddDependencyTags(fullResponse);
    if (
      !abortController.signal.aborted &&
      // If there are dependencies, we don't want to auto-fix problems
      // because there's going to be type errors since the packages aren't
      // installed yet.
      addDependencies.length === 0 &&
      settings.enableAutoFixProblems
    ) {
      try {
        // IF auto-fix is enabled
        let problemReport = await generateProblemReport({
          fullResponse,
          appPath,
        });

        let autoFixAttempts = 0;
        const originalFullResponse = fullResponse;
        const previousAttempts: ModelMessage[] = [];
        while (
          problemReport.problems.length > 0 &&
          autoFixAttempts < 2 &&
          !abortController.signal.aborted
        ) {
          fullResponse += `<dyad-problem-report summary="${problemReport.problems.length} problems">
${problemReport.problems
  .map(
    (problem) =>
      `<problem file="${escapeXmlAttr(problem.file)}" line="${problem.line}" column="${problem.column}" code="${problem.code}">${escapeXmlContent(problem.message)}</problem>`,
  )
  .join("\n")}
</dyad-problem-report>`;

          logger.info(
            `Attempting to auto-fix problems, attempt #${autoFixAttempts + 1}`,
          );
          autoFixAttempts++;
          const problemFixPrompt = createProblemFixPrompt(problemReport);

          const virtualFileSystem = new AsyncVirtualFileSystem(appPath, {
            fileExists: (fileName: string) => fileExists(fileName),
            readFile: (fileName: string) => readFileWithCache(fileName),
          });
          const writeTags = getDyadWriteTags(fullResponse);
          const renameTags = getDyadRenameTags(fullResponse);
          const deletePaths = getDyadDeleteTags(fullResponse);
          virtualFileSystem.applyResponseChanges({
            deletePaths,
            renameTags,
            writeTags,
          });

          const { formattedOutput: codebaseInfo, files: updatedFiles } =
            await extractCodebase({
              appPath,
              chatContext,
              virtualFileSystem,
            });
          const { modelClient } = await getModelClient(
            settings.selectedModel,
            settings,
          );

          const { fullStream } = await this.streamSimple({
            modelClient,
            files: updatedFiles,
            chatMessages: [
              ...chatMessages.map((msg, index) => {
                if (
                  index === 0 &&
                  msg.role === "user" &&
                  typeof msg.content === "string" &&
                  msg.content.startsWith(CODEBASE_PROMPT_PREFIX)
                ) {
                  return {
                    role: "user",
                    content: createCodebasePrompt(codebaseInfo),
                  } as const;
                }
                return msg;
              }),
              {
                role: "assistant",
                content: removeNonEssentialTags(originalFullResponse),
              },
              ...previousAttempts,
              { role: "user", content: problemFixPrompt },
            ],
          });
          previousAttempts.push({
            role: "user",
            content: problemFixPrompt,
          });
          const result = await this.processStreamChunks({
            fullStream,
            fullResponse,
          });
          fullResponse = result.fullResponse;
          previousAttempts.push({
            role: "assistant",
            content: removeNonEssentialTags(result.incrementalResponse),
          });

          problemReport = await generateProblemReport({
            fullResponse,
            appPath,
          });
        }
      } catch (error) {
        logger.error(
          "Error generating problem report or auto-fixing:",
          settings.enableAutoFixProblems,
          error,
        );
      }
    }

    return fullResponse;
  }
}
