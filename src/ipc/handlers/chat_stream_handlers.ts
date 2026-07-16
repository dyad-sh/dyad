import { v4 as uuidv4 } from "uuid";
import { app, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createTypedHandler } from "./base";
import {
  computeStreamingPatch,
  fastTextOutput,
} from "../utils/stream_text_utils";
import { chatContracts, ChatStreamParamsSchema } from "../types/chat";
import {
  ModelMessage,
  TextPart,
  ImagePart,
  streamText,
  ToolSet,
  TextStreamPart,
  stepCountIs,
  hasToolCall,
} from "ai";

import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { scheduleChatSearchIndexing } from "../../pro/main/ipc/handlers/local_agent/chat_search_indexer";
import { and, eq, isNull } from "drizzle-orm";
import type { SmartContextMode } from "../../lib/schemas";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import { detectFrameworkType } from "../utils/framework_utils";
import { getThemePromptById } from "../utils/theme_utils";
import { registerTrustedIpcHandler } from "./trusted_handle";
import {
  getSupabaseAvailableSystemPrompt,
  SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT,
} from "../../prompts/supabase_prompt";
import { buildNeonPromptForApp } from "../../neon_admin/neon_prompt_context";
import { getDyadAppPath } from "../../paths/paths";
import { buildDyadMediaUrl } from "../../lib/dyadMediaUrl";
import type { ChatResponseEnd, ChatStreamParams } from "@/ipc/types";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { CodebaseFile, extractCodebase } from "../../utils/codebase";
import {
  dryRunSearchReplace,
  processFullResponseActions,
} from "../processors/response_processor";
import { getDyadExecuteSqlTags } from "../utils/dyad_tag_parser";
import { doesSqlDeleteData } from "@/lib/sqlSchemaMutation";
import {
  streamTestResponse,
  getTestResponse,
  noteAck,
} from "./testing_chat_handlers";
import { getModelClient, ModelClient } from "../utils/get_model_client";
import log from "electron-log";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  getSupabaseContext,
  getSupabaseClientCode,
} from "../../supabase_admin/supabase_context";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "../../prompts/summarize_chat_system_prompt";
import { SECURITY_REVIEW_SYSTEM_PROMPT } from "../../prompts/security_review_prompt";
import fs from "node:fs";
import * as path from "path";
import * as crypto from "crypto";
import { readFile, writeFile } from "fs/promises";
import { getMaxTokens, getTemperature } from "../utils/token_utils";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { validateChatContext } from "../utils/context_paths_utils";
import { getProviderOptions, getAiHeaders } from "../utils/provider_options";
import { clearPendingMcpConsentsForChat } from "../utils/mcp_consent";
import { sanitizeMcpToolResult } from "../utils/mcp_result_sanitizer";

import {
  clearPendingLocalAgentInputsForChat,
  handleLocalAgentStream,
} from "../../pro/main/ipc/handlers/local_agent/local_agent_handler";

import { safeSend } from "../utils/safe_sender";
import { cancelOrphanedBaseStream } from "../utils/stream_text_utils";
import { cleanFullResponse } from "../utils/cleanFullResponse";
import { escapeXmlAttr, escapeXmlContent } from "../../../shared/xmlEscape";
import { isCodeExplorerReady } from "../processors/code_explorer";
import { appendCancelledResponseNotice } from "@/shared/chatCancellation";
import {
  isModelRefusal,
  MODEL_REFUSAL_WARNING,
} from "@/ipc/utils/model_refusal";
import {
  extractMentionedAppsCodebasesFromPrompt,
  extractMentionedAppsReferencesFromPrompt,
  type MentionedAppCodebaseEntry,
  type MentionedAppReference,
} from "../utils/mention_apps";
import {
  parseMediaMentions,
  stripResolvedMediaMentions,
} from "@/shared/parse_media_mentions";
import { prompts as promptsTable } from "../../db/schema";
import { inArray } from "drizzle-orm";
import { replacePromptReference } from "../utils/replacePromptReference";
import { replaceSlashSkillReference } from "../utils/replaceSlashSkillReference";
import { resolveMediaMentions } from "../utils/resolve_media_mentions";
import { parsePlanFile, validatePlanId } from "./planUtils";
import { ensureDyadGitignored } from "./gitignoreUtils";
import {
  appendAttachmentManifestEntriesWithLogicalNames,
  createUniqueAttachmentLogicalName,
  DYAD_MEDIA_DIR_NAME,
  type AttachmentManifestEntryInput,
} from "../utils/media_path_utils";
import {
  isBasicAgentMode,
  isDyadProEnabled,
  isLocalAgentBackedMode,
  isSupabaseConnected,
  isTurboEditsV2Enabled,
} from "@/lib/schemas";
import {
  FREE_PRO_BUILD_MODE_ERROR,
  isFreeProBuildModeCombination,
  isFreeProModel,
} from "@/lib/freeProModel";
import { resolveChatModeForTurn } from "./chat_mode_resolution";
import {
  getFreeAgentQuotaStatus,
  markMessageAsUsingFreeAgentQuota,
  unmarkMessageAsUsingFreeAgentQuota,
} from "./free_agent_quota_handlers";
import { AI_STREAMING_ERROR_MESSAGE_PREFIX } from "@/shared/texts";
import { getCurrentCommitHash } from "../utils/git_utils";
import {
  processChatMessagesWithVersionedFiles as getVersionedFiles,
  VersionedFiles,
} from "../utils/versioned_codebase_context";
import { getAiMessagesJsonIfWithinLimit } from "../utils/ai_messages_utils";
import { readSettings, setSentinelActiveChat } from "@/main/settings";
import {
  buildLocalAgentAttachmentInfo,
  getInlineImageMimeType,
  hasScriptReadableAttachment,
  isTextFile,
  resolveAttachmentDeliveryConfig,
  type PendingStoredChatAttachment,
  type StoredChatAttachment,
} from "../utils/chat_attachment_utils";
import { inspectBase64DataUrl } from "../../shared/chatAttachmentLimits";
import { toRendererMessage } from "../utils/renderer_chat_message";

type AsyncIterableStream<T> = AsyncIterable<T> & ReadableStream<T>;

function createEmptyTextStream(): AsyncIterableStream<TextStreamPart<ToolSet>> {
  return new ReadableStream<TextStreamPart<ToolSet>>({
    start(controller) {
      controller.close();
    },
  }) as AsyncIterableStream<TextStreamPart<ToolSet>>;
}

const logger = log.scope("chat_stream_handlers");

// Track active streams for cancellation
const activeStreams = new Map<number, Set<AbortController>>();
const admissionPendingStreams = new Set<AbortController>();

// How many chats are currently streaming a response. Used by the
// performance monitor to record activity alongside memory snapshots.
export function getActiveStreamCount(): number {
  return activeStreams.size;
}

// Resolves when a stream's handler has fully unwound (its `finally` block ran,
// so any in-flight tool/file writes have settled). `cancelStream` awaits this
// after aborting so callers like restore-to-message don't touch the working
// tree while a cancelled turn is still flushing partial file writes.
const streamCompletions = new Map<number, Set<Promise<void>>>();

export function addTrackedValue<T>(
  trackedValues: Map<number, Set<T>>,
  chatId: number,
  value: T,
): void {
  const values = trackedValues.get(chatId) ?? new Set<T>();
  values.add(value);
  trackedValues.set(chatId, values);
}

export function removeTrackedValue<T>(
  trackedValues: Map<number, Set<T>>,
  chatId: number,
  value: T,
): void {
  const values = trackedValues.get(chatId);
  if (!values) {
    return;
  }
  values.delete(value);
  if (values.size === 0) {
    trackedValues.delete(chatId);
  }
}

// A restore must drain existing streams and prevent new ones from entering the
// same app until its Git/database mutation has finished. Counts (rather than a
// Set) make nested/queued guards safe: releasing one guard cannot unblock an
// app while another guard still owns it.
const streamAdmissionBlockCounts = new Map<number, number>();
const chatStreamAdmissionBlockCounts = new Map<number, number>();
const streamAdmissionWaiters = new Map<number, Set<() => void>>();
const chatStreamAdmissionWaiters = new Map<number, Set<() => void>>();

function incrementAdmissionBlock(
  blockCounts: Map<number, number>,
  waiters: Map<number, Set<() => void>>,
  key: number,
): () => void {
  blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;

    const remaining = (blockCounts.get(key) ?? 1) - 1;
    if (remaining <= 0) {
      blockCounts.delete(key);
      const keyWaiters = waiters.get(key);
      waiters.delete(key);
      keyWaiters?.forEach((resolve) => resolve());
    } else {
      blockCounts.set(key, remaining);
    }
  };
}

export function blockNewStreamsForApp(appId: number): () => void {
  return incrementAdmissionBlock(
    streamAdmissionBlockCounts,
    streamAdmissionWaiters,
    appId,
  );
}

export function blockNewStreamsForChat(chatId: number): () => void {
  return incrementAdmissionBlock(
    chatStreamAdmissionBlockCounts,
    chatStreamAdmissionWaiters,
    chatId,
  );
}

function resolveAllAdmissionWaiters(waiters: Map<number, Set<() => void>>) {
  for (const keyWaiters of waiters.values()) {
    keyWaiters.forEach((resolve) => resolve());
  }
  waiters.clear();
}

async function waitForAdmissionBlockToClear({
  blockCounts,
  waiters,
  key,
  signal,
}: {
  blockCounts: Map<number, number>;
  waiters: Map<number, Set<() => void>>;
  key: number;
  signal: AbortSignal;
}): Promise<boolean> {
  if ((blockCounts.get(key) ?? 0) === 0) {
    return true;
  }
  if (signal.aborted) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      const keyWaiters = waiters.get(key);
      keyWaiters?.delete(onRelease);
      if (keyWaiters?.size === 0) {
        waiters.delete(key);
      }
    };
    const settle = (admitted: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(admitted);
    };
    const onRelease = () => settle(!signal.aborted);
    const onAbort = () => settle(false);

    const keyWaiters = waiters.get(key) ?? new Set<() => void>();
    keyWaiters.add(onRelease);
    waiters.set(key, keyWaiters);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Track partial responses by invocation so concurrent streams for one chat do
// not overwrite the content persisted into each assistant placeholder.
const partialResponses = new Map<AbortController, string>();

export function setPartialResponseForStream(
  controller: AbortController,
  response: string,
): void {
  partialResponses.set(controller, response);
}

export function takePartialResponseForStream(
  controller: AbortController,
): string {
  const response = partialResponses.get(controller) ?? "";
  partialResponses.delete(controller);
  return response;
}

async function cancelTrackedStreams(
  chatIds: number[],
  sender: WebContents,
): Promise<boolean> {
  const trackedStreams = chatIds
    .map((chatId) => ({
      chatId,
      abortControllers: [...(activeStreams.get(chatId) ?? [])],
      completions: [...(streamCompletions.get(chatId) ?? [])],
    }))
    .filter(
      ({ abortControllers, completions }) =>
        abortControllers.length > 0 || completions.length > 0,
    );

  if (trackedStreams.length === 0) {
    return false;
  }

  // Resolve consent prompts before awaiting completion. A stream parked on a
  // consent prompt cannot unwind until that prompt is resolved.
  for (const { chatId, abortControllers } of trackedStreams) {
    abortControllers.forEach((controller) => controller.abort());
    clearPendingLocalAgentInputsForChat(chatId);
    clearPendingMcpConsentsForChat(chatId);
    logger.log(
      `Aborted ${abortControllers.length} stream(s) for chat ${chatId}`,
    );
  }

  // Notify the renderer that the stream ended as soon as it is aborted, before
  // awaiting the handler's completion. The renderer clears its streaming state
  // (`isStreaming`, `pendingStreamChatIds`) off these events, so delaying them
  // until after the handler fully unwinds leaves a window where a message the
  // user submits (or a queue the user resumes) right after pressing Stop is
  // treated as still-streaming — it gets queued instead of sent, or the resume
  // never re-arms the queue processor. Callers that need writes to have settled
  // (restore/delete) still await the completions below; only the renderer
  // notification moves earlier, matching the pre-cancellation-refactor timing.
  // A new stream the renderer starts for a chat under an active restore barrier
  // simply waits at admission, so notifying early stays safe.
  for (const { chatId } of trackedStreams) {
    safeSend(sender, "chat:response:end", {
      chatId,
      updatedFiles: false,
      wasCancelled: true,
    } satisfies ChatResponseEnd);
    safeSend(sender, "chat:stream:end", { chatId });
  }

  await Promise.all(
    trackedStreams.flatMap(({ completions }) =>
      completions.map((completion) => completion.catch(() => {})),
    ),
  );

  return true;
}

/**
 * Abort an in-flight stream for a single chat and wait until its handler has
 * stopped writing. Deletion handlers call this before taking the app lock (and
 * before deleting rows) so an in-flight generation can't re-insert messages
 * into a chat that was just cleared or removed. Like
 * {@link cancelActiveStreamsForApp}, it must run outside the app lock: the
 * aborted handler can take the same lock for its own writes, so awaiting its
 * completion while holding the lock would deadlock.
 */
export async function cancelActiveStreamsForChat(
  chatId: number,
  sender: WebContents,
): Promise<boolean> {
  return cancelTrackedStreams([chatId], sender);
}

/**
 * Abort every in-flight stream whose chat belongs to an app and wait until all
 * of their handlers have stopped writing. Version handlers call this before
 * taking the app lock so cancellation cannot deadlock behind a stream write.
 */
export async function cancelActiveStreamsForApp(
  appId: number,
  sender: WebContents,
): Promise<boolean> {
  const inFlightChatIds = [
    ...new Set([...activeStreams.keys(), ...streamCompletions.keys()]),
  ].filter((chatId) =>
    [...(activeStreams.get(chatId) ?? [])].some(
      (controller) => !admissionPendingStreams.has(controller),
    ),
  );
  if (inFlightChatIds.length === 0) {
    return false;
  }

  const appChats = await db.query.chats.findMany({
    columns: { id: true },
    where: and(eq(chats.appId, appId), inArray(chats.id, inFlightChatIds)),
  });

  return cancelTrackedStreams(
    appChats.map(({ id }) => id),
    sender,
  );
}

// Use escapeXmlAttr from shared/xmlEscape for XML escaping

// Safely parse an MCP tool key that combines server and tool names.
// We split on the LAST occurrence of "__" to avoid ambiguity if either
// side contains "__" as part of its sanitized name.
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

// Helper function to process stream chunks
export async function processStreamChunks({
  fullStream,
  fullResponse,
  abortController,
  chatId,
  processResponseChunkUpdate,
  includeReasoning = true,
}: {
  fullStream: AsyncIterableStream<TextStreamPart<ToolSet>>;
  fullResponse: string;
  abortController: AbortController;
  chatId: number;
  processResponseChunkUpdate: (params: {
    fullResponse: string;
  }) => Promise<string>;
  includeReasoning?: boolean;
}): Promise<{
  fullResponse: string;
  incrementalResponse: string;
  modelRefused: boolean;
}> {
  const responseBeforeStream = fullResponse;
  let incrementalResponse = "";
  let inThinkingBlock = false;
  let modelRefused = false;

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
    if (isModelRefusal(part)) {
      // Anthropic returns Fable classifier refusals as successful responses.
      // A refusal can arrive after partial output, which Anthropic documents as
      // incomplete, so replace this stream's output with a persisted warning.
      fullResponse = responseBeforeStream;
      incrementalResponse = "";
      chunk = MODEL_REFUSAL_WARNING;
      modelRefused = true;
    } else if (part.type === "text-delta") {
      chunk += part.text;
    } else if (part.type === "reasoning-delta" && includeReasoning) {
      if (!inThinkingBlock) {
        chunk = "<think>";
        inThinkingBlock = true;
      }

      chunk += escapeDyadTags(part.text);
    } else if (part.type === "tool-call") {
      const { serverName, toolName } = parseMcpToolKey(part.toolName);
      const content = escapeDyadTags(JSON.stringify(part.input));
      chunk = `<dyad-mcp-tool-call server="${escapeXmlAttr(serverName)}" tool="${escapeXmlAttr(toolName)}" call-id="${escapeXmlAttr(part.toolCallId)}">\n${content}\n</dyad-mcp-tool-call>\n`;
    } else if (part.type === "tool-result") {
      const { serverName, toolName } = parseMcpToolKey(part.toolName);
      const content = escapeXmlContent(part.output);
      chunk = `<dyad-mcp-tool-result server="${escapeXmlAttr(serverName)}" tool="${escapeXmlAttr(toolName)}" call-id="${escapeXmlAttr(part.toolCallId)}">\n${content}\n</dyad-mcp-tool-result>\n`;
    } else if (part.type === "tool-error") {
      // Emit an errored result so the merged card terminates in an error
      // state instead of staying on "Running".
      const { serverName, toolName } = parseMcpToolKey(part.toolName);
      const message =
        part.error instanceof Error ? part.error.message : String(part.error);
      const content = escapeXmlContent(
        sanitizeMcpToolResult(message).serialized,
      );
      chunk = `<dyad-mcp-tool-result server="${escapeXmlAttr(serverName)}" tool="${escapeXmlAttr(toolName)}" call-id="${escapeXmlAttr(part.toolCallId)}" is-error="true">\n${content}\n</dyad-mcp-tool-result>\n`;
    }

    if (!chunk) {
      continue;
    }

    fullResponse += chunk;
    incrementalResponse += chunk;
    fullResponse = cleanFullResponse(fullResponse);
    fullResponse = await processResponseChunkUpdate({
      fullResponse,
    });

    // If the stream was aborted, exit early
    if (abortController.signal.aborted) {
      logger.log(`Stream for chat ${chatId} was aborted`);
      break;
    }

    if (modelRefused) {
      break;
    }
  }

  return { fullResponse, incrementalResponse, modelRefused };
}

export function registerChatStreamHandlers() {
  // Abort in-flight LLM streams on quit so the process can exit promptly and
  // the module-level stream-tracking maps don't outlive their renderer.
  // (Guarded: `app` is undefined when this module is imported in unit tests.)
  app?.on?.("before-quit", () => {
    for (const controllers of activeStreams.values()) {
      controllers.forEach((controller) => controller.abort());
    }
    activeStreams.clear();
    partialResponses.clear();
    streamCompletions.clear();
    streamAdmissionBlockCounts.clear();
    chatStreamAdmissionBlockCounts.clear();
    admissionPendingStreams.clear();
    resolveAllAdmissionWaiters(streamAdmissionWaiters);
    resolveAllAdmissionWaiters(chatStreamAdmissionWaiters);
  });

  createTypedHandler(
    chatContracts.responseAck,
    async (_event, { chatId, lastSeq }) => {
      noteAck(chatId, lastSeq);
    },
  );

  const chatStreamHandler = async (
    event: IpcMainInvokeEvent,
    req: ChatStreamParams,
  ) => {
    let attachmentPaths: string[] = [];
    const abortController = new AbortController();
    // Expose a promise that resolves once this handler fully unwinds (see the
    // `finally` block) so `cancelStream` can await in-flight tool/file writes.
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    addTrackedValue(streamCompletions, req.chatId, completion);
    try {
      // This legacy stream handler predates createTypedHandler, so enforce the
      // contract explicitly before any attachment string is decoded.
      const parsedRequest = ChatStreamParamsSchema.safeParse(req);
      if (!parsedRequest.success) {
        throw new DyadError(
          parsedRequest.error.issues[0]?.message ?? "Invalid chat request.",
          DyadErrorKind.Validation,
        );
      }
      req = parsedRequest.data;

      let dyadRequestId: string | undefined;
      addTrackedValue(activeStreams, req.chatId, abortController);
      admissionPendingStreams.add(abortController);

      const loadChatForStream = () =>
        db.query.chats.findFirst({
          where: eq(chats.id, req.chatId),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            },
            app: true, // Include app information
          },
        });

      // Get the chat to check for existing messages
      let chat = await loadChatForStream();

      // Cancellation can arrive while the initial chat lookup is pending. Let
      // cancelTrackedStreams remain the sole sender of the cancelled end events
      // instead of also surfacing an admission/not-found error for this request.
      if (abortController.signal.aborted) {
        return req.chatId;
      }

      if (!chat) {
        throw new DyadError(
          `Chat not found: ${req.chatId}`,
          DyadErrorKind.NotFound,
        );
      }

      while (true) {
        if ((chatStreamAdmissionBlockCounts.get(req.chatId) ?? 0) > 0) {
          const admitted = await waitForAdmissionBlockToClear({
            blockCounts: chatStreamAdmissionBlockCounts,
            waiters: chatStreamAdmissionWaiters,
            key: req.chatId,
            signal: abortController.signal,
          });
          if (!admitted) {
            return req.chatId;
          }
          chat = await loadChatForStream();
        }

        if (abortController.signal.aborted) {
          return req.chatId;
        }

        if (!chat) {
          throw new DyadError(
            `Chat not found: ${req.chatId}`,
            DyadErrorKind.NotFound,
          );
        }

        if ((streamAdmissionBlockCounts.get(chat.appId) ?? 0) > 0) {
          const admitted = await waitForAdmissionBlockToClear({
            blockCounts: streamAdmissionBlockCounts,
            waiters: streamAdmissionWaiters,
            key: chat.appId,
            signal: abortController.signal,
          });
          if (!admitted) {
            return req.chatId;
          }
          chat = await loadChatForStream();
          continue;
        }

        // Both admission blocks are clear. Remove the pending marker HERE, in
        // the same synchronous frame as the block checks above and before any
        // further `await`, so admission is atomic with barrier installation.
        // `cancelActiveStreamsForApp` deliberately skips controllers still in
        // `admissionPendingStreams`; a restore that installs its app barrier
        // (`blockNewStreamsForApp`) after this stream last checked the block but
        // before the marker is cleared would therefore neither cancel this
        // stream nor make it re-observe the new barrier, letting it start
        // mid-restore and dirty the freshly reverted tree after the revert
        // releases the app lock. Keeping the check-then-clear free of any
        // intervening `await` closes that window: the stream either observes the
        // barrier above and waits, or clears its marker before the barrier is
        // installed and is then a plain in-flight stream the restore cancels.
        // Do NOT introduce an `await` between the checks above and this line.
        admissionPendingStreams.delete(abortController);
        break;
      }

      // Notify the renderer only after admission succeeds. Requests that arrive
      // during an in-progress restore wait above and then start normally,
      // keeping the submitted prompt owned by the stream instead of dropping it.
      safeSend(event.sender, "chat:stream:start", { chatId: req.chatId });

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

      // Process attachments if any
      let attachmentInfo = "";
      // Display-only attachment info uses <dyad-attachment> tags for inline rendering
      let displayAttachmentInfo = "";
      let storedAttachments: StoredChatAttachment[] = [];
      const pendingStoredAttachments: PendingStoredChatAttachment[] = [];
      const manifestEntries: AttachmentManifestEntryInput[] = [];
      const usedLogicalNames = new Set<string>();
      const appPath = getDyadAppPath(chat.app.path);

      // Detach the serialized payloads from the long-lived stream request as
      // soon as they are persisted. Otherwise every base64 string remains
      // reachable for the entire LLM turn and duplicates later disk reads.
      let incomingAttachments = req.attachments;
      req.attachments = undefined;
      if (incomingAttachments && incomingAttachments.length > 0) {
        attachmentInfo = "\n\nAttachments:\n";

        // Create persistent .dyad/media directory for this app
        const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
        if (!fs.existsSync(mediaDir)) {
          fs.mkdirSync(mediaDir, { recursive: true });
        }
        await ensureDyadGitignored(appPath);

        for (const attachment of incomingAttachments) {
          const inspection = inspectBase64DataUrl(attachment.data);
          if (!inspection.ok) {
            throw new DyadError(
              `"${attachment.name}" is not a valid base64 attachment.`,
              DyadErrorKind.Validation,
            );
          }
          const base64Data = attachment.data.slice(inspection.payloadStart);
          const fileBuffer = Buffer.from(base64Data, "base64");
          const hash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");
          const fileExtension = path.extname(attachment.name);
          const filename = `${hash}${fileExtension}`;
          const logicalName = createUniqueAttachmentLogicalName(
            attachment.name,
            usedLogicalNames,
          );

          // Save to .dyad/media dir
          const persistentPath = path.join(mediaDir, filename);
          await writeFile(persistentPath, fileBuffer);
          attachmentPaths.push(persistentPath);
          pendingStoredAttachments.push({
            filePath: persistentPath,
            attachmentType: attachment.attachmentType,
          });
          manifestEntries.push({
            requestedLogicalName: logicalName,
            originalName: attachment.name,
            storedFileName: filename,
            mimeType: attachment.type,
            sizeBytes: fileBuffer.byteLength,
            createdAt: new Date().toISOString(),
          });
          sendTelemetryEvent("attachment.stored", {
            appId: chat.app.id,
            chatId: req.chatId,
            attachmentType: attachment.attachmentType,
            mimeType: attachment.type,
            sizeBytes: fileBuffer.byteLength,
          });

          // Build dyad-media:// URL for display
          // Use a fixed hostname to avoid URL hostname normalization (lowercasing)
          // Encode path segments so special characters (spaces, #, ?, %) don't
          // break URL parsing. The protocol handler already decodeURIComponent's.
          const mediaUrl = `dyad-media://media/${encodeURIComponent(chat.app.path)}/.dyad/media/${encodeURIComponent(filename)}`;

          // Build display tag for inline rendering (escape attribute values)
          displayAttachmentInfo += `\n<dyad-attachment name="${escapeXmlAttr(attachment.name)}" type="${escapeXmlAttr(attachment.type)}" url="${escapeXmlAttr(mediaUrl)}" path="${escapeXmlAttr(persistentPath)}" attachment-type="${escapeXmlAttr(attachment.attachmentType)}"></dyad-attachment>\n`;

          if (attachment.attachmentType === "upload-to-codebase") {
            // Provide the .dyad/media path so the AI can copy it into the codebase
            attachmentInfo += `\n\nFile to upload to codebase: "${attachment.name}" (path: ${persistentPath})\nUse the copy_file tool when tools are available, or emit a <dyad-copy> tag otherwise, to copy this file into the codebase at the appropriate location.\n`;
          } else {
            // For chat-context, provide file info for reference (no path to avoid auto-copying)
            attachmentInfo += `- ${attachment.name} (${attachment.type})\n`;
            // If it's a text-based file, try to include the content
            if (await isTextFile(persistentPath)) {
              try {
                attachmentInfo += `<dyad-text-attachment filename="${escapeXmlAttr(attachment.name)}" type="${escapeXmlAttr(attachment.type)}" path="${escapeXmlAttr(persistentPath)}">
                </dyad-text-attachment>
                \n\n`;
              } catch (err) {
                logger.error(`Error reading file content: ${err}`);
              }
            }
          }
        }
      }
      incomingAttachments = undefined;

      // Build the full AI prompt. Attachment-specific instructions are added
      // to the user message, never the system prompt.
      let userPrompt = req.prompt;
      // Build the display prompt (with <dyad-attachment> tags for inline rendering)
      // This separates what the user sees from what the AI receives.
      let displayUserPrompt: string | undefined;
      if (displayAttachmentInfo) {
        displayUserPrompt = req.prompt + displayAttachmentInfo;
      }
      // Inline referenced prompt contents for mentions like @prompt:<id>
      try {
        const matches = Array.from(userPrompt.matchAll(/@prompt:(\d+)/g));
        if (matches.length > 0) {
          const ids = Array.from(new Set(matches.map((m) => Number(m[1]))));
          const referenced = await db
            .select()
            .from(promptsTable)
            .where(inArray(promptsTable.id, ids));
          if (referenced.length > 0) {
            const promptsMap: Record<number, string> = {};
            for (const p of referenced) {
              promptsMap[p.id] = p.content;
            }
            userPrompt = replacePromptReference(userPrompt, promptsMap);
          }
        }
      } catch (e) {
        logger.error("Failed to inline referenced prompts:", e);
      }

      // Expand /slug skill references (e.g. /webapp-testing) to prompt content
      try {
        const slashSkillPattern = /(?:^|\s)\/([a-zA-Z0-9-]+)(?=\s|$)/;
        if (slashSkillPattern.test(userPrompt)) {
          const allPrompts = db.select().from(promptsTable).all();
          const promptsBySlug: Record<string, string> = {};
          for (const p of allPrompts) {
            if (p.slug && !promptsBySlug[p.slug]) {
              promptsBySlug[p.slug] = p.content;
            }
          }
          userPrompt = replaceSlashSkillReference(userPrompt, promptsBySlug);
        }
      } catch (e) {
        logger.error("Failed to expand slash skill references:", e);
      }

      // Resolve @media: mentions to image attachments
      const mediaRefs = parseMediaMentions(userPrompt);
      if (mediaRefs.length > 0) {
        try {
          const resolvedMedia = await resolveMediaMentions(
            mediaRefs,
            chat.app.path,
            chat.app.name,
          );
          const resolvedMediaRefs = resolvedMedia.map((media) =>
            encodeURIComponent(media.fileName),
          );
          let mediaDisplayInfo = "";
          for (const media of resolvedMedia) {
            attachmentPaths.push(media.filePath);
            const logicalName = createUniqueAttachmentLogicalName(
              media.fileName,
              usedLogicalNames,
            );
            const stat = await fs.promises.stat(media.filePath);
            pendingStoredAttachments.push({
              filePath: media.filePath,
              attachmentType: "chat-context",
            });
            manifestEntries.push({
              requestedLogicalName: logicalName,
              originalName: media.fileName,
              storedFileName: media.fileName,
              mimeType: media.mimeType,
              sizeBytes: stat.size,
              createdAt: new Date().toISOString(),
            });
            const mediaUrl = buildDyadMediaUrl(chat.app.path, media.fileName);
            mediaDisplayInfo += `\n<dyad-attachment name="${escapeXmlAttr(media.fileName)}" type="${escapeXmlAttr(media.mimeType)}" url="${escapeXmlAttr(mediaUrl)}" path="${escapeXmlAttr(media.filePath)}" attachment-type="chat-context"></dyad-attachment>\n`;
          }
          // Strip only resolved @media: tags from the prompt text.
          // This preserves adjacent user text when mentions are directly followed
          // by text without a whitespace separator.
          userPrompt = stripResolvedMediaMentions(
            userPrompt,
            resolvedMediaRefs,
          );
          // Build display prompt with attachment tags for inline rendering.
          if (mediaDisplayInfo) {
            const strippedPrompt = stripResolvedMediaMentions(
              displayUserPrompt ?? req.prompt,
              resolvedMediaRefs,
            );
            displayUserPrompt = strippedPrompt + mediaDisplayInfo;
          }
        } catch (e) {
          logger.error("Failed to resolve media mentions:", e);
        }
      }

      const finalizedManifestEntries =
        await appendAttachmentManifestEntriesWithLogicalNames(
          appPath,
          manifestEntries,
        );
      storedAttachments = finalizedManifestEntries.map((entry, index) => ({
        ...entry,
        filePath: pendingStoredAttachments[index].filePath,
        attachmentType: pendingStoredAttachments[index].attachmentType,
      }));

      // Expand /implement-plan= into full implementation prompt
      // Keep the original short form for display in the UI; the expanded
      // content is only injected into the AI message history.
      let implementPlanDisplayPrompt: string | undefined;
      const implementPlanMatch = userPrompt.match(/^\/implement-plan=(.+)$/);
      if (implementPlanMatch) {
        try {
          implementPlanDisplayPrompt = userPrompt;
          const planSlug = implementPlanMatch[1];
          validatePlanId(planSlug);
          const appPath = getDyadAppPath(chat.app.path);
          const planFilePath = path.join(
            appPath,
            ".dyad",
            "plans",
            `${planSlug}.md`,
          );
          const raw = await fs.promises.readFile(planFilePath, "utf-8");
          const { meta, content } = parsePlanFile(raw);

          const planPath = `.dyad/plans/${planSlug}.md`;

          userPrompt = `Please implement the following plan:

## ${meta.title || "Implementation Plan"}

${content}

Start implementing this plan now. Follow the steps outlined and create/modify the necessary files.
You may update the plan at \`${planPath}\` to mark your progress.`;
        } catch (e) {
          implementPlanDisplayPrompt = undefined;
          logger.error("Failed to expand /implement-plan= prompt:", e);
        }
      }

      const componentsToProcess = req.selectedComponents || [];

      if (componentsToProcess.length > 0) {
        userPrompt += "\n\nSelected components:\n";

        for (const component of componentsToProcess) {
          let componentSnippet = "[component snippet not available]";
          try {
            const componentFileContent = await readFile(
              path.join(getDyadAppPath(chat.app.path), component.relativePath),
              "utf8",
            );
            const lines = componentFileContent.split(/\r?\n/);
            const selectedIndex = component.lineNumber - 1;

            // Let's get one line before and three after for context.
            const startIndex = Math.max(0, selectedIndex - 1);
            const endIndex = Math.min(lines.length, selectedIndex + 4);

            const snippetLines = lines.slice(startIndex, endIndex);
            const selectedLineInSnippetIndex = selectedIndex - startIndex;

            if (snippetLines[selectedLineInSnippetIndex]) {
              snippetLines[selectedLineInSnippetIndex] =
                `${snippetLines[selectedLineInSnippetIndex]} // <-- EDIT HERE`;
            }

            componentSnippet = snippetLines.join("\n");
          } catch (err) {
            logger.error(
              `Error reading selected component file content: ${err}`,
            );
          }

          userPrompt += `\n${componentsToProcess.length > 1 ? `${componentsToProcess.indexOf(component) + 1}. ` : ""}Component: ${component.name} (file: ${component.relativePath})

Snippet:
\`\`\`
${componentSnippet}
\`\`\`
`;
        }
      }

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
      if (
        isFreeProBuildModeCombination(settings.selectedModel, selectedChatMode)
      ) {
        throw new DyadError(
          FREE_PRO_BUILD_MODE_ERROR,
          DyadErrorKind.Precondition,
        );
      }
      const freeModelMode = isFreeProModel(settings.selectedModel);
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
        messages: updatedChat.messages.map(toRendererMessage),
      });

      let fullResponse = "";
      let maxTokensUsed: number | undefined;

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

        const appPath = getDyadAppPath(updatedChat.app.path);
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
          referencedAppsForAgent =
            await extractMentionedAppsReferencesFromPrompt(
              req.prompt,
              updatedChat.app.id, // Exclude current app
            );
        } else {
          mentionedAppsCodebases =
            await extractMentionedAppsCodebasesFromPrompt(
              req.prompt,
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

        // Prepare message history for the AI
        const messageHistory = updatedChat.messages.map((message) => ({
          role: message.role as "user" | "assistant" | "system",
          content: message.content,
          sourceCommitHash: message.sourceCommitHash,
          commitHash: message.commitHash,
        }));

        // The DB stores display-friendly versions (short /implement-plan= form
        // or clean <dyad-attachment> tags). Replace the last user message with the
        // full AI prompt so the model receives expanded plan content or attachment paths.
        if (implementPlanDisplayPrompt || displayUserPrompt) {
          for (let i = messageHistory.length - 1; i >= 0; i--) {
            if (messageHistory[i].role === "user") {
              messageHistory[i] = {
                ...messageHistory[i],
                content: effectiveAiUserPrompt,
              };
              break;
            }
          }
        }

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

        // If we need to limit the context, we take only the most recent turns
        let limitedMessageHistory = messageHistory;
        if (messageHistory.length > maxChatTurns * 2) {
          // Each turn is a user + assistant pair
          // Calculate how many messages to keep (maxChatTurns * 2)
          let recentMessages = messageHistory
            .filter((msg) => msg.role !== "system")
            .slice(-maxChatTurns * 2);

          // Ensure the first message is a user message
          if (recentMessages.length > 0 && recentMessages[0].role !== "user") {
            // Find the first user message
            const firstUserIndex = recentMessages.findIndex(
              (msg) => msg.role === "user",
            );
            if (firstUserIndex > 0) {
              // Drop assistant messages before the first user message
              recentMessages = recentMessages.slice(firstUserIndex);
            } else if (firstUserIndex === -1) {
              logger.warn(
                "No user messages found in recent history, set recent messages to empty",
              );
              recentMessages = [];
            }
          }

          limitedMessageHistory = [...recentMessages];

          logger.log(
            `Limiting chat history from ${messageHistory.length} to ${limitedMessageHistory.length} messages (max ${maxChatTurns} turns)`,
          );
        }

        const aiRules = await readAiRules(getDyadAppPath(updatedChat.app.path));

        // Get theme prompt for the app (null themeId means "no theme")
        const themePrompt = await getThemePromptById(updatedChat.app.themeId);
        logger.log(
          `Theme for app ${updatedChat.app.id}: ${updatedChat.app.themeId ?? "none"}, prompt length: ${themePrompt.length} chars`,
        );

        const frameworkType = detectFrameworkType(appPath);
        // Gate on Pro to match the `explore_code` tool's `isEnabled`, so the
        // prompt never points the model at a tool that isn't in the toolset.
        const codeExplorerAvailable =
          isDyadProEnabled(settings) &&
          !!settings.enableCodeExplorer &&
          isCodeExplorerReady(appPath);

        // Migration on read converts "agent" to "build", so no need to check for it here
        let systemPrompt = constructSystemPrompt({
          aiRules,
          chatMode: selectedChatMode,
          enableTurboEditsV2: isTurboEditsV2Enabled(settings),
          themePrompt,
          basicAgentMode: isBasicAgentMode(settings),
          freeModelMode,
          frameworkType,
          hasSupabaseProject: !!updatedChat.app?.supabaseProjectId,
          enableAppBlueprint:
            settings.enableAppBlueprint && updatedChat.app.needsAppBlueprint,
          codeExplorerAvailable,
          testingEnabled: !!updatedChat.app?.testingEnabled,
        });

        // Add information about mentioned apps for build mode only.
        // Full codebase injection (build mode): full file contents already
        // concatenated into `otherAppsCodebaseInfo`.
        //
        // Agent/ask/plan modes don't need anything in the system prompt —
        // handleLocalAgentStream injects a `<system-reminder>` into the
        // user's latest message so the system prompt stays static.
        if (otherAppsCodebaseInfo) {
          const mentionedAppsList = mentionedAppsCodebases
            .map(({ appName }) => appName)
            .join(", ");

          systemPrompt += `\n\n# Referenced Apps\nThe user has mentioned the following apps in their prompt: ${mentionedAppsList}. Their codebases have been included in the context for your reference. When referring to these apps, you can understand their structure and code to provide better assistance, however you should NOT edit the files in these referenced apps. The referenced apps are NOT part of the current app and are READ-ONLY.`;
        }

        const isSecurityReviewIntent =
          req.prompt.startsWith("/security-review");
        if (isSecurityReviewIntent) {
          systemPrompt = SECURITY_REVIEW_SYSTEM_PROMPT;
          try {
            const appPath = getDyadAppPath(updatedChat.app.path);
            const rulesPath = path.join(appPath, "SECURITY_RULES.md");
            let securityRules = "";

            await fs.promises.access(rulesPath);
            securityRules = await fs.promises.readFile(rulesPath, "utf8");

            if (securityRules && securityRules.trim().length > 0) {
              systemPrompt +=
                "\n\n# Project-specific security rules:\n" + securityRules;
            }
          } catch (error) {
            // Best-effort: if reading rules fails, continue without them
            logger.info("Failed to read security rules", error);
          }
        }

        if (
          updatedChat.app?.supabaseProjectId &&
          isSupabaseConnected(settings)
        ) {
          const supabaseClientCode = await getSupabaseClientCode({
            projectId: updatedChat.app.supabaseProjectId,
            organizationSlug: updatedChat.app.supabaseOrganizationSlug ?? null,
          });
          systemPrompt +=
            "\n\n" +
            getSupabaseAvailableSystemPrompt(supabaseClientCode) +
            "\n\n" +
            // For local agent, we will explicitly fetch the database context when needed.
            (selectedChatMode === "local-agent"
              ? ""
              : await getSupabaseContext({
                  supabaseProjectId: updatedChat.app.supabaseProjectId,
                  organizationSlug:
                    updatedChat.app.supabaseOrganizationSlug ?? null,
                }));
        } else if (updatedChat.app?.neonProjectId) {
          // Neon is connected — inject Neon prompt instead of Supabase
          systemPrompt +=
            "\n\n" +
            (await buildNeonPromptForApp({
              appPath: updatedChat.app.path,
              neonProjectId: updatedChat.app.neonProjectId!,
              neonActiveBranchId: updatedChat.app.neonActiveBranchId,
              neonDevelopmentBranchId: updatedChat.app.neonDevelopmentBranchId,
              selectedChatMode,
            })) +
            "\n\n";
        } else if (
          // In local agent mode, we will suggest integrations as part of the add-integration tool
          selectedChatMode !== "local-agent" &&
          // If in security review mode, we don't need to mention integrations are available.
          !isSecurityReviewIntent
        ) {
          systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
        }
        const isSummarizeIntent = req.prompt.startsWith(
          "Summarize from chat-id=",
        );
        if (isSummarizeIntent) {
          systemPrompt = SUMMARIZE_CHAT_SYSTEM_PROMPT;
        }

        if (attachmentDeliveryConfig.addSystemCopyInstructions) {
          systemPrompt += `

When files are attached to this conversation for upload to the codebase, copy them into the project using this exact format:

<dyad-copy from="/absolute/path/to/.dyad/media/source.ext" to="path/to/destination/filename.ext" description="Upload file to codebase"></dyad-copy>

Use the attached file path from the user's message as the \`from\` value. Choose an appropriate project-relative \`to\` path.

`;
        }

        if (attachmentDeliveryConfig.addSystemVisionInstructions) {
          systemPrompt += `

# Image Analysis Instructions
This conversation includes one or more image attachments. When the user uploads images:
1. If the user explicitly asks for analysis, description, or information about the image, please analyze the image content.
2. Describe what you see in the image if asked.
3. You can use images as references when the user has coding or design-related questions.
4. For diagrams or wireframes, try to understand the content and structure shown.
5. For screenshots of code or errors, try to identify the issue or explain the code.
`;
        }

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

        const limitedHistoryChatMessages = limitedMessageHistory.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          // Why remove thinking tags?
          // Thinking tags are generally not critical for the context
          // and eats up extra tokens.
          content:
            selectedChatMode === "ask"
              ? removeDyadTags(removeNonEssentialTags(msg.content))
              : removeNonEssentialTags(msg.content),
          providerOptions: {
            "dyad-engine": {
              sourceCommitHash: msg.sourceCommitHash,
              commitHash: msg.commitHash,
            },
          },
        }));

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
            if (attachmentPaths.length > 0) {
              // Replace the last message with one that includes attachments
              chatMessages[lastUserIndex] = await prepareMessageWithAttachments(
                lastUserMessage,
                attachmentPaths,
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
        const simpleStreamText = async ({
          chatMessages,
          modelClient,
          tools,
          systemPromptOverride = systemPrompt,
          dyadDisableFiles = false,
          files,
        }: {
          chatMessages: ModelMessage[];
          modelClient: ModelClient;
          files: CodebaseFile[];
          tools?: ToolSet;
          systemPromptOverride?: string;
          dyadDisableFiles?: boolean;
        }) => {
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
            dyadAppId: updatedChat.app.id,
            dyadRequestId,
            dyadDisableFiles,
            smartContextMode,
            files,
            versionedFiles,
            mentionedAppsCodebases,
            builtinProviderId: modelClient.builtinProviderId,
            settings,
          });

          const streamResult = streamText({
            headers: getAiHeaders({
              builtinProviderId: modelClient.builtinProviderId,
            }),
            maxOutputTokens: await getMaxTokens(settings.selectedModel),
            temperature: await getTemperature(settings.selectedModel),
            maxRetries: 2,
            model: modelClient.model,
            stopWhen: [stepCountIs(20), hasToolCall("edit-code")],
            // Avoids the SDK's O(n^2) per-chunk JSON.stringify of the full
            // accumulated text (see fastTextOutput). We read fullStream parts
            // directly and never consume partialOutput.
            output: fastTextOutput(),
            providerOptions,
            system: systemPromptOverride,
            tools,
            messages: chatMessages.filter((m) => m.content),
            onFinish: async (response) => {
              const totalTokens = response.usage?.totalTokens;

              if (typeof totalTokens === "number") {
                // We use the highest total tokens used (we are *not* accumulating)
                // since we're trying to figure it out if we're near the context limit.
                maxTokensUsed = Math.max(maxTokensUsed ?? 0, totalTokens);

                // Persist the aggregated token usage on the placeholder assistant message
                await db
                  .update(messages)
                  .set({ maxTokensUsed: maxTokensUsed })
                  .where(eq(messages.id, placeholderAssistantMessage.id))
                  .catch((error) => {
                    logger.error(
                      "Failed to save total tokens for assistant message",
                      error,
                    );
                  });

                logger.log(
                  `Total tokens used (aggregated for message ${placeholderAssistantMessage.id}): ${maxTokensUsed}`,
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
              event.sender.send("chat:response:error", {
                chatId: req.chatId,
                error: `${AI_STREAMING_ERROR_MESSAGE_PREFIX}${requestIdPrefix}${message}`,
              });
            },
            abortSignal: abortController.signal,
          });
          // Read .fullStream now (not lazily) so the SDK's `teeStream()`
          // runs synchronously, then cancel the orphaned tee branch
          // before any chunks are pumped. See `cancelOrphanedBaseStream`
          // for the underlying SDK behavior and why this is required.
          const fullStream = streamResult.fullStream;
          cancelOrphanedBaseStream(streamResult);
          // Not every caller consumes `usage`; when the user cancels the
          // stream it rejects with AbortError, so mark it handled here to
          // keep the rejection from surfacing as unhandled. Callers that
          // await it still observe the rejection.
          const usage = streamResult.usage;
          Promise.resolve(usage).catch(() => {});
          return {
            fullStream,
            usage,
          };
        };

        let lastDbSaveAt = 0;
        // Tracks what was last sent to the renderer so we can emit only the
        // tail diff. `cleanFullResponse` may retroactively rewrite earlier
        // bytes inside an in-progress dyad-tag's attribute values, so we
        // compute the longest common prefix on each send rather than
        // assuming pure appends.
        let lastSentContent = "";

        const processResponseChunkUpdate = async ({
          fullResponse,
        }: {
          fullResponse: string;
        }) => {
          // Store the current partial response
          setPartialResponseForStream(abortController, fullResponse);
          // Save to DB (in case user is switching chats during the stream)
          const now = Date.now();
          if (now - lastDbSaveAt >= 150) {
            await db
              .update(messages)
              .set({ content: fullResponse })
              .where(eq(messages.id, placeholderAssistantMessage.id));

            lastDbSaveAt = now;
          }

          const patch = computeStreamingPatch(fullResponse, lastSentContent);
          lastSentContent = fullResponse;
          if (!patch) {
            return fullResponse;
          }
          safeSend(event.sender, "chat:response:chunk", {
            chatId: req.chatId,
            streamingMessageId: placeholderAssistantMessage.id,
            streamingPatch: patch,
          });
          return fullResponse;
        };

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
            freeModelMode,
            codeExplorerAvailable,
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
              freeModelMode,
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
            freeModelMode,
          });

          await handleLocalAgentStream(event, req, abortController, {
            placeholderMessageId: placeholderAssistantMessage.id,
            systemPrompt: planModeSystemPrompt,
            dyadRequestId: dyadRequestId ?? "[no-request-id]",
            planModeOnly: true,
            messageOverride: isSummarizeIntent ? chatMessages : undefined,
            settingsOverride: settings,
            freeModelMode,
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
                freeModelMode,
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

        let modelRefused = false;

        // When calling streamText, the messages need to be properly formatted for mixed content
        const fullStream = modelRefused
          ? createEmptyTextStream()
          : (
              await simpleStreamText({
                chatMessages,
                modelClient,
                files: files,
              })
            ).fullStream;

        // Process the stream as before
        try {
          const result = await processStreamChunks({
            fullStream,
            fullResponse,
            abortController,
            chatId: req.chatId,
            processResponseChunkUpdate,
          });
          fullResponse = result.fullResponse;
          if (result.modelRefused) {
            modelRefused = true;
          }

          if (!modelRefused && isTurboEditsV2Enabled(settings)) {
            let issues = await dryRunSearchReplace({
              fullResponse,
              appPath: getDyadAppPath(updatedChat.app.path),
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
              await processResponseChunkUpdate({
                fullResponse,
              });

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
                content: `${fixSearchReplacePrompt}\n\n${formattedSearchReplaceIssues}`,
              } as const;

              const { fullStream: fixSearchReplaceStream } =
                await simpleStreamText({
                  // Build messages: reuse chat history and original full response, then ask to fix search-replace issues.
                  chatMessages: [
                    ...chatMessages,
                    { role: "assistant", content: originalFullResponse },
                    ...previousAttempts,
                    userPrompt,
                  ],
                  modelClient,
                  files: files,
                });
              previousAttempts.push(userPrompt);
              const result = await processStreamChunks({
                fullStream: fixSearchReplaceStream,
                fullResponse,
                abortController,
                chatId: req.chatId,
                processResponseChunkUpdate,
              });
              fullResponse = result.fullResponse;
              if (result.modelRefused) {
                modelRefused = true;
                break;
              }
              previousAttempts.push({
                role: "assistant",
                content: removeNonEssentialTags(result.incrementalResponse),
              });

              // Re-check for issues after the fix attempt
              issues = await dryRunSearchReplace({
                fullResponse: result.incrementalResponse,
                appPath: getDyadAppPath(updatedChat.app.path),
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

          if (
            !modelRefused &&
            !abortController.signal.aborted &&
            hasUnclosedDyadWrite(fullResponse)
          ) {
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

              const { fullStream: contStream } = await simpleStreamText({
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
                modelClient,
                files: files,
              });
              const result = await processStreamChunks({
                fullStream: contStream,
                fullResponse,
                abortController,
                chatId: req.chatId,
                processResponseChunkUpdate,
                includeReasoning: false,
              });
              fullResponse = result.fullResponse;
              if (result.modelRefused) {
                modelRefused = true;
                break;
              }
            }
          }
        } catch (streamError) {
          // Check if this was an abort error
          if (abortController.signal.aborted) {
            const chatId = req.chatId;
            const partialResponse =
              takePartialResponseForStream(abortController);
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
        const partialResponse = takePartialResponseForStream(abortController);
        try {
          await db
            .update(messages)
            .set({
              content: appendCancelledResponseNotice(partialResponse),
            })
            .where(eq(messages.id, placeholderAssistantMessage.id));
          // Settled (cancelled): index this turn's messages for chat search
          scheduleChatSearchIndexing();
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
        // Settled: index this turn's messages for chat search
        scheduleChatSearchIndexing();
        const latestSettings = readSettings();
        const shouldAutoApply =
          latestSettings.autoApproveChanges && selectedChatMode !== "ask";
        const hasDestructiveSql =
          shouldAutoApply &&
          getDyadExecuteSqlTags(fullResponse).some((query) =>
            doesSqlDeleteData(query.content),
          );
        if (shouldAutoApply && !hasDestructiveSql) {
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
            messages: chat!.messages.map(toRendererMessage),
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
      const errorMessage = isDyadError(error) ? error.message : String(error);
      safeSend(event.sender, "chat:response:error", {
        chatId: req.chatId,
        error: `Sorry, there was an error processing your request: ${errorMessage}`,
      });

      return "error";
    } finally {
      // Clean up the abort controller
      removeTrackedValue(activeStreams, req.chatId, abortController);
      admissionPendingStreams.delete(abortController);
      partialResponses.delete(abortController);

      // Notify renderer that stream has ended. When the stream was cancelled,
      // `cancelTrackedStreams` is the sole sender of the end events (it emits
      // both `chat:response:end` with `wasCancelled` and `chat:stream:end`
      // as soon as it aborts this stream). Sending `chat:stream:end` here too
      // would deliver a duplicate end event to the renderer, so skip it on the
      // aborted path.
      if (!abortController.signal.aborted) {
        safeSend(event.sender, "chat:stream:end", { chatId: req.chatId });
      }
      // Unblock any pending MCP consents (their banners are cleared on stream end).
      if (!activeStreams.has(req.chatId)) {
        clearPendingMcpConsentsForChat(req.chatId);
      }

      // Signal any awaiting `cancelStream` call that all writes have settled,
      // then drop the (now-resolved) completion promise for this chat. Resolve
      // before deleting so a reader that consults the map after the abort still
      // observes a settled promise rather than a missing entry.
      resolveCompletion();
      removeTrackedValue(streamCompletions, req.chatId, completion);
    }
  };
  registerTrustedIpcHandler("chat:stream", chatStreamHandler);

  // Handler to cancel an ongoing stream
  createTypedHandler(chatContracts.cancelStream, async (event, chatId) => {
    const cancelled = await cancelTrackedStreams([chatId], event.sender);
    if (!cancelled) {
      logger.warn(`No active stream found for chat ${chatId}`);
    }

    return true;
  });
}

export function formatMessagesForSummary(
  messages: { role: string; content: string | undefined }[],
) {
  if (messages.length <= 8) {
    // If we have 8 or fewer messages, include all of them
    return messages
      .map((m) => `<message role="${m.role}">${m.content}</message>`)
      .join("\n");
  }

  // Take first 2 messages and last 6 messages
  const firstMessages = messages.slice(0, 2);
  const lastMessages = messages.slice(-6);

  // Combine them with an indicator of skipped messages
  const combinedMessages = [
    ...firstMessages,
    {
      role: "system",
      content: `[... ${messages.length - 8} messages omitted ...]`,
    },
    ...lastMessages,
  ];

  return combinedMessages
    .map((m) => `<message role="${m.role}">${m.content}</message>`)
    .join("\n");
}

// Helper function to replace text attachment placeholders with full content
async function replaceTextAttachmentWithContent(
  text: string,
  filePath: string,
  fileName: string,
): Promise<string> {
  try {
    if (await isTextFile(filePath)) {
      // Read the full content
      const fullContent = await readFile(filePath, "utf-8");

      // Replace the placeholder tag with the full content.
      // The path attribute in the tag is XML-escaped (via escapeXmlAttr), so we
      // must also XML-escape the path before regex-escaping to ensure a match.
      const xmlEscapedPath = escapeXmlAttr(filePath);
      const escapedPath = xmlEscapedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagPattern = new RegExp(
        `<dyad-text-attachment filename="[^"]*" type="[^"]*" path="${escapedPath}">\\s*<\\/dyad-text-attachment>`,
        "g",
      );

      const replacedText = text.replace(
        tagPattern,
        `Full content of ${fileName}:\n\`\`\`\n${fullContent}\n\`\`\``,
      );

      logger.log(
        `Replaced text attachment content for: ${fileName} - length before: ${text.length} - length after: ${replacedText.length}`,
      );
      return replacedText;
    }
    return text;
  } catch (error) {
    logger.error(`Error processing text file: ${error}`);
    return text;
  }
}

// Helper function to convert traditional message to one with proper image attachments
async function prepareMessageWithAttachments(
  message: ModelMessage,
  attachmentPaths: string[],
  {
    includeImageAttachments = true,
    inlineTextAttachments = true,
  }: {
    includeImageAttachments?: boolean;
    inlineTextAttachments?: boolean;
  } = {},
): Promise<ModelMessage> {
  let textContent = message.content;
  // Get the original text content
  if (typeof textContent !== "string") {
    logger.warn(
      "Message content is not a string - shouldn't happen but using message as-is",
    );
    return message;
  }

  if (inlineTextAttachments) {
    // Process text file attachments - replace placeholder tags with full content
    for (const filePath of attachmentPaths) {
      const fileName = path.basename(filePath);
      textContent = await replaceTextAttachmentWithContent(
        textContent,
        filePath,
        fileName,
      );
    }
  }

  // For user messages with attachments, create a content array
  const contentParts: (TextPart | ImagePart)[] = [];

  // Add the text part first with possibly modified content
  contentParts.push({
    type: "text",
    text: textContent,
  });

  if (includeImageAttachments) {
    // Add image parts for any image attachments
    for (const filePath of attachmentPaths) {
      const mimeType = getInlineImageMimeType(filePath);
      if (mimeType) {
        try {
          // Read the file as a buffer and convert to base64 string
          // Using base64 strings instead of raw Buffers ensures proper JSON serialization
          // for storage in aiMessagesJson (raw Buffers serialize inefficiently and exceed size limits)
          const imageBuffer = await readFile(filePath);
          const base64Data = imageBuffer.toString("base64");

          // Add the image to the content parts with base64 data and mediaType
          contentParts.push({
            type: "image",
            image: base64Data,
            mediaType: mimeType,
          });

          logger.log(`Added image attachment: ${filePath}`);
        } catch (error) {
          logger.error(`Error reading image file: ${error}`);
        }
      }
    }
  }

  // Return the message with the content array
  return {
    role: "user",
    content: contentParts,
  };
}

function removeNonEssentialTags(text: string): string {
  return removeProblemReportTags(removeThinkingTags(text));
}

function removeThinkingTags(text: string): string {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  return text.replace(thinkRegex, "").trim();
}

export function removeProblemReportTags(text: string): string {
  const problemReportRegex =
    /<dyad-problem-report[^>]*>[\s\S]*?<\/dyad-problem-report>/g;
  return text.replace(problemReportRegex, "").trim();
}

export function removeDyadTags(text: string): string {
  const dyadRegex = /<dyad-[^>]*>[\s\S]*?<\/dyad-[^>]*>/g;
  return text.replace(dyadRegex, "").trim();
}

export function hasUnclosedDyadWrite(text: string): boolean {
  // Find the last opening dyad-write tag
  const openRegex = /<dyad-write[^>]*>/g;
  let lastOpenIndex = -1;
  let match;

  while ((match = openRegex.exec(text)) !== null) {
    lastOpenIndex = match.index;
  }

  // If no opening tag found, there's nothing unclosed
  if (lastOpenIndex === -1) {
    return false;
  }

  // Look for a closing tag after the last opening tag
  const textAfterLastOpen = text.substring(lastOpenIndex);
  const hasClosingTag = /<\/dyad-write>/.test(textAfterLastOpen);

  return !hasClosingTag;
}

function escapeDyadTags(text: string): string {
  // Escape dyad tags in reasoning content
  // We are replacing the opening tag with a look-alike character
  // to avoid issues where thinking content includes dyad tags
  // and are mishandled by:
  // 1. FE markdown parser
  // 2. Main process response processor
  return text.replace(/<dyad/g, "＜dyad").replace(/<\/dyad/g, "＜/dyad");
}

const CODEBASE_PROMPT_PREFIX = "This is my codebase.";
function createCodebasePrompt(codebaseInfo: string): string {
  return `${CODEBASE_PROMPT_PREFIX} ${codebaseInfo}`;
}

function createOtherAppsCodebasePrompt(otherAppsCodebaseInfo: string): string {
  return `
# Referenced Apps

These are the other apps that I've mentioned in my prompt. These other apps' codebases are READ-ONLY.

${otherAppsCodebaseInfo}
`;
}
