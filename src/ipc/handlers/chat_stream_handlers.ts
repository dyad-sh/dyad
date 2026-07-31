import { v4 as uuidv4 } from "uuid";
import { app, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createTypedHandler } from "./base";
import { chatContracts, ChatStreamParamsSchema } from "../types/chat";
import { db } from "../../db";
import { chats, messages, prompts as promptsTable } from "../../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import { detectFrameworkType } from "../utils/framework_utils";
import { getThemePromptById } from "../utils/theme_utils";
import { getSupabaseAvailableSystemPrompt } from "../../prompts/supabase_prompt";
import { registerTrustedIpcHandler } from "./trusted_handle";
import { buildNeonPromptForApp } from "../../neon_admin/neon_prompt_context";
import { getDyadAppPath } from "../../paths/paths";
import { buildDyadMediaUrl } from "../../lib/dyadMediaUrl";
import type { ChatStreamParams } from "@/ipc/types";
import type { ChatStreamInvocationRef } from "@/chat_stream/invocation";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";
import type {
  ChatStreamChunkPayload,
  ChatStreamEndPayload,
  ChatStreamErrorPayload,
  ChatStreamStartPayload,
  ChatStreamTransportEndPayload,
} from "@/chat_stream/protocol";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import log from "electron-log";
import { sendTelemetryEvent } from "../utils/telemetry";
import { getSupabaseClientCode } from "../../supabase_admin/supabase_context";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "../../prompts/summarize_chat_system_prompt";
import { SECURITY_REVIEW_SYSTEM_PROMPT } from "../../prompts/security_review_prompt";
import fs from "node:fs";
import * as path from "path";
import * as crypto from "crypto";
import { writeFile } from "fs/promises";
import { executePiChatTurn } from "@/ipc/pi/chat/execute_chat_turn";
import {
  isChatPendingCompaction,
  performCompaction,
} from "./compaction/compaction_handler";
import { getPostCompactionMessages } from "./compaction/compaction_utils";
import { userInputRegistry } from "../../user_input/main";

import { safeSend, type SafeSender } from "../utils/safe_sender";
import {
  releaseChatProducerInterest,
  sendChatChunk,
} from "@/window_infrastructure/main/production_high_volume";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { escapeXmlAttr, escapeXmlContent } from "../../../shared/xmlEscape";
import {
  appendReferencedAppsReminder,
  extractMentionedAppsReferencesFromPrompt,
} from "../utils/mention_apps";
import {
  parseMediaMentions,
  stripResolvedMediaMentions,
} from "@/shared/parse_media_mentions";
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
import { isSupabaseConnected } from "@/lib/schemas";
import { resolveChatModeForTurn } from "./chat_mode_resolution";
import { acceptChatTurn } from "./chat_turn_acceptance";
import { withChatQueueLock } from "@/chat_stream/queue_lock";
import { getCurrentCommitHash } from "../utils/git_utils";
import { setSentinelActiveChat } from "@/main/settings";
import {
  buildLocalAgentAttachmentInfo,
  isTextFile,
  resolveAttachmentDeliveryConfig,
  type PendingStoredChatAttachment,
  type StoredChatAttachment,
} from "../utils/chat_attachment_utils";
import { inspectBase64DataUrl } from "../../shared/chatAttachmentLimits";
import { toRendererMessage } from "../utils/renderer_chat_message";
import { extractCodebase } from "../../utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";
import { buildSelectedComponentContext } from "@/ipc/pi/chat/selected_component_context";
import { limitChatHistoryRows } from "@/ipc/pi/chat/history_limit";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";

const logger = log.scope("chat_stream_handlers");

export interface ChatStreamExecutionObserver {
  intent: SerializableChatTurnIntent;
  sessionQueued: boolean;
  onAccepted?(acceptedMessageId: number): void;
  onEnd?(response: ChatStreamEndPayload): void;
  onError?(error: ChatStreamErrorPayload): void;
}

type InternalChatStreamHandler = (
  event: IpcMainInvokeEvent,
  request: ChatStreamParams,
) => Promise<number | "error" | undefined>;

let internalChatStreamHandler: InternalChatStreamHandler | undefined;

export function settleUnobservedChatStreamResult(
  request: ChatStreamParams,
  result: number | "error",
  observer: ChatStreamExecutionObserver,
  wasCancelled = false,
): void {
  if (wasCancelled) {
    observer.onEnd?.({
      chatId: request.chatId,
      invocationRef: request.invocationRef,
      streamId: request.streamId,
      updatedFiles: false,
      wasCancelled: true,
    });
    return;
  }
  if (result === "error") {
    observer.onError?.({
      chatId: request.chatId,
      invocationRef: request.invocationRef,
      streamId: request.streamId,
      error: "Chat stream ended without reporting a terminal error",
    });
    return;
  }
  observer.onEnd?.({
    chatId: request.chatId,
    invocationRef: request.invocationRef,
    streamId: request.streamId,
    updatedFiles: false,
  });
}

export function createObservedChatStreamSender(
  sender: WebContents,
  observeTerminal: (channel: string, payload: unknown) => void,
): WebContents {
  const targetIsUnavailable = (): boolean => {
    if (sender.isDestroyed()) return true;
    const senderWithCrashState = sender as WebContents & {
      isCrashed?: () => boolean;
    };
    return senderWithCrashState.isCrashed?.() ?? false;
  };
  return new Proxy(sender, {
    get(target, property, receiver) {
      if (property === "id" && targetIsUnavailable()) {
        // High-volume routing treats non-integer endpoints as non-producers.
        // This prevents a real webContents that closed after route selection
        // from being re-registered through this observation proxy.
        return Number.NaN;
      }
      // `safeSend` must reach the proxy's `send` trap even if the presentation
      // endpoint disappeared. Actor completion is independent of renderer
      // delivery; the trap below separately checks whether delivery is safe.
      if (property === "isDestroyed" || property === "isCrashed") {
        return () => false;
      }
      if (property === "send") {
        return (channel: string, payload: unknown) => {
          observeTerminal(channel, payload);
          if (targetIsUnavailable()) return;
          try {
            target.send(channel, payload);
          } catch {
            // Presentation delivery is best effort. The observer above is the
            // main-owned lifecycle authority and has already been notified.
          }
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Compatibility seam for the in-process Vitest harness. Production renderers
 * must dispatch through the remote chat actor and never receive this endpoint.
 */
export function registerLegacyChatStreamTestHandler(): void {
  if (!process.env.VITEST) {
    throw new Error("Legacy chat stream IPC is test-only");
  }
  registerTrustedIpcHandler("chat:stream", async (event, request) => {
    if (!internalChatStreamHandler) {
      throw new Error("Chat stream handlers have not been registered");
    }
    return internalChatStreamHandler(
      event,
      ChatStreamParamsSchema.parse(request),
    );
  });
}

export async function executeChatStreamFromActor(
  sender: WebContents,
  request: ChatStreamParams,
  observer: ChatStreamExecutionObserver,
): Promise<number | "error"> {
  if (!internalChatStreamHandler) {
    throw new Error("Chat stream handlers have not been registered");
  }
  if (
    request.invocationRef &&
    takePendingActorStreamCancellation(request.invocationRef)
  ) {
    return request.chatId;
  }
  executionObservers.set(
    request.intentId ?? request.invocationRef?.operationId ?? "",
    observer,
  );
  let terminalObserved = false;
  let deferredCancellation: ChatStreamEndPayload | undefined;
  const observeTerminal = (channel: string, payload: unknown) => {
    if (terminalObserved) return;
    if (channel === "chat:response:end") {
      terminalObserved = true;
      const response = payload as ChatStreamEndPayload;
      if (response.wasCancelled) {
        // Cancellation is announced to renderers before the handler has
        // finished persisting its partial response. Keep actor authority
        // pending until the handler unwinds so its completion snapshot only
        // becomes observable after the cancellation notice is durable.
        deferredCancellation = response;
      } else {
        observer.onEnd?.(response);
      }
    } else if (channel === "chat:response:error") {
      terminalObserved = true;
      observer.onError?.(payload as ChatStreamErrorPayload);
    }
  };
  const observedSender = createObservedChatStreamSender(
    sender,
    observeTerminal,
  );
  try {
    const result =
      (await internalChatStreamHandler(
        { sender: observedSender } as IpcMainInvokeEvent,
        request,
      )) ?? "error";
    if (deferredCancellation) {
      observer.onEnd?.(deferredCancellation);
    } else if (!terminalObserved) {
      const wasCancelled = request.invocationRef
        ? cancelledActorInvocations.delete(request.invocationRef.operationId)
        : false;
      settleUnobservedChatStreamResult(request, result, observer, wasCancelled);
    }
    return result;
  } finally {
    if (request.invocationRef) {
      cancelledActorInvocations.delete(request.invocationRef.operationId);
    }
    executionObservers.delete(
      request.intentId ?? request.invocationRef?.operationId ?? "",
    );
  }
}

const executionObservers = new Map<string, ChatStreamExecutionObserver>();
const cancelledActorInvocations = new Set<string>();
const pendingActorStreamCancellations = new Set<string>();

export function markPendingActorStreamCancellation(
  invocationRef: ChatStreamInvocationRef,
): void {
  pendingActorStreamCancellations.add(invocationRef.operationId);
}

export function takePendingActorStreamCancellation(
  invocationRef: ChatStreamInvocationRef,
): boolean {
  return pendingActorStreamCancellations.delete(invocationRef.operationId);
}

export function clearPendingActorStreamCancellation(
  invocationRef: ChatStreamInvocationRef,
): void {
  pendingActorStreamCancellations.delete(invocationRef.operationId);
}

function executionObserver(
  request: ChatStreamParams,
): ChatStreamExecutionObserver | undefined {
  return executionObservers.get(
    request.intentId ?? request.invocationRef?.operationId ?? "",
  );
}

// PROTOCOL-GROUNDED REGION: tracking/completion abstraction. Keep in sync with
// src/chat_stream/host_transition.ts and src/chat_stream/main_actor.test.ts.
interface TrackedStream {
  abortController: AbortController;
  sender: SafeSender;
  invocationRef?: ChatStreamInvocationRef;
  /** @deprecated Correlation used only by pre-InvocationRef renderers. */
  streamId?: number;
}

// Track active streams for cancellation together with the renderer correlation
// identity. Legacy callers may omit InvocationRef and/or use numeric streamId.
const activeStreams = new Map<number, Set<TrackedStream>>();
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

// PROTOCOL-GROUNDED REGION: cancellation selection, early terminals, and
// unwind waiting. Keep in sync with src/chat_stream/host_transition.ts.
async function cancelTrackedStreams(
  chatIds: number[],
  sender: SafeSender | undefined,
): Promise<boolean> {
  const trackedStreams = chatIds
    .map((chatId) => ({
      chatId,
      streams: [...(activeStreams.get(chatId) ?? [])],
      completions: [...(streamCompletions.get(chatId) ?? [])],
    }))
    .filter(
      ({ streams, completions }) =>
        streams.length > 0 || completions.length > 0,
    );

  if (trackedStreams.length === 0) {
    return false;
  }

  // Resolve consent prompts before awaiting completion. A stream parked on a
  // consent prompt cannot unwind until that prompt is resolved.
  for (const { chatId, streams } of trackedStreams) {
    streams.forEach(({ abortController }) => abortController.abort());
    userInputRegistry.sweepChat(chatId);
    logger.log(`Aborted ${streams.length} stream(s) for chat ${chatId}`);
  }

  // Notify the renderer that the stream ended as soon as it is aborted, before
  // awaiting the handler's completion. The renderer's chat stream machine
  // finalizes (clearing the `isStreaming` projection) off these events, so
  // delaying them until after the handler fully unwinds leaves a window where
  // a message the user submits (or a queue the user resumes) right after
  // pressing Stop is treated as still-streaming — it stays queued instead of
  // dispatching immediately. Callers that need writes to have settled
  // (restore/delete) still await the completions below; only the renderer
  // notification moves earlier, matching the pre-cancellation-refactor timing.
  // A new stream the renderer starts for a chat under an active restore barrier
  // simply waits at admission, so notifying early stays safe.
  for (const { chatId, streams } of trackedStreams) {
    const correlations =
      streams.length > 0
        ? streams.map(({ invocationRef, streamId, sender: streamSender }) => ({
            invocationRef,
            streamId,
            sender: streamSender,
          }))
        : [{ invocationRef: undefined, streamId: undefined, sender }];
    for (const {
      invocationRef,
      streamId,
      sender: streamSender,
    } of correlations) {
      if (invocationRef) {
        cancelledActorInvocations.add(invocationRef.operationId);
      }
      const targetSender = streamSender ?? sender;
      if (targetSender) {
        safeSend(targetSender, "chat:response:end", {
          chatId,
          invocationRef,
          streamId,
          updatedFiles: false,
          wasCancelled: true,
        } satisfies ChatStreamEndPayload);
      }
    }
    const terminalSenders = new Set(
      streams.map(({ sender: streamSender }) => streamSender),
    );
    if (terminalSenders.size === 0 && sender) terminalSenders.add(sender);
    for (const terminalSender of terminalSenders) {
      safeSend(terminalSender, "chat:stream:end", {
        chatId,
      } satisfies ChatStreamTransportEndPayload);
    }
  }

  await Promise.all(
    trackedStreams.flatMap(({ completions }) =>
      completions.map((completion) => completion.catch(() => {})),
    ),
  );

  return true;
}

/**
 * Abort and drain every tracked stream, including streams still waiting for
 * admission. Process/test teardown cannot safely close shared databases,
 * servers, or temp roots while either class of handler is alive.
 */
export async function cancelAllActiveStreams(
  sender?: SafeSender,
): Promise<boolean> {
  return cancelTrackedStreams(
    [...new Set([...activeStreams.keys(), ...streamCompletions.keys()])],
    sender,
  );
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
  sender: SafeSender | undefined,
  pendingInvocationRef?: ChatStreamInvocationRef,
): Promise<boolean> {
  if (
    pendingInvocationRef &&
    (activeStreams.get(chatId)?.size ?? 0) === 0 &&
    (streamCompletions.get(chatId)?.size ?? 0) === 0
  ) {
    markPendingActorStreamCancellation(pendingInvocationRef);
    return true;
  }
  return cancelTrackedStreams([chatId], sender);
}

/**
 * Abort every in-flight stream whose chat belongs to an app and wait until all
 * of their handlers have stopped writing. Version handlers call this before
 * taking the app lock so cancellation cannot deadlock behind a stream write.
 */
export async function cancelActiveStreamsForApp(
  appId: number,
  sender?: SafeSender,
): Promise<boolean> {
  const inFlightChatIds = [
    ...new Set([...activeStreams.keys(), ...streamCompletions.keys()]),
  ].filter((chatId) =>
    [...(activeStreams.get(chatId) ?? [])].some(
      ({ abortController }) => !admissionPendingStreams.has(abortController),
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

export function registerChatStreamHandlers() {
  // Abort in-flight LLM streams on quit so the process can exit promptly and
  // the module-level stream-tracking maps don't outlive their renderer.
  // (Guarded: `app` is undefined when this module is imported in unit tests.)
  app?.on?.("before-quit", () => {
    userInputRegistry.dispose();
    for (const controllers of activeStreams.values()) {
      controllers.forEach(({ abortController }) => abortController.abort());
    }
    activeStreams.clear();
    partialResponses.clear();
    streamCompletions.clear();
    streamAdmissionBlockCounts.clear();
    chatStreamAdmissionBlockCounts.clear();
    admissionPendingStreams.clear();
    pendingActorStreamCancellations.clear();
    resolveAllAdmissionWaiters(streamAdmissionWaiters);
    resolveAllAdmissionWaiters(chatStreamAdmissionWaiters);
  });

  const chatStreamHandler = async (
    event: IpcMainInvokeEvent,
    req: ChatStreamParams,
  ) => {
    let attachmentPaths: string[] = [];
    const abortController = new AbortController();
    let trackedStream: TrackedStream | undefined;
    // Set on every successful terminal path — including the agent-mode branches
    // that return early below. The `finally` block only arms a user-input
    // follow-up (`streamFinished`) when this is true, so leaving it false on a
    // turn that actually completed sweeps the armed request instead.
    let finishedNaturally = false;
    let replayedAcceptedFollowUp = false;
    let mutatedPersistedChat = false;
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

      const dyadRequestId = uuidv4();
      trackedStream = {
        abortController,
        sender: event.sender,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
      };
      addTrackedValue(activeStreams, req.chatId, trackedStream);
      admissionPendingStreams.add(abortController);

      const loadChatForStream = () =>
        db.query.chats.findFirst({
          where: eq(chats.id, req.chatId),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [
                asc(messages.createdAt),
                asc(messages.id),
              ],
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

      // PROTOCOL-GROUNDED REGION: admission barrier loop and atomic admission.
      // Keep in sync with src/chat_stream/host_transition.ts.
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
      safeSend(event.sender, "chat:stream:start", {
        chatId: req.chatId,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
      } satisfies ChatStreamStartPayload);

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
          mutatedPersistedChat = true;

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

      const selectedComponentContext = await buildSelectedComponentContext(
        getDyadAppPath(chat.app.path),
        req.selectedComponents ?? [],
      );
      const aiUserPrompt = userPrompt + selectedComponentContext;
      const defaultAiUserPrompt =
        aiUserPrompt + (attachmentInfo ? attachmentInfo : "");

      let { settings: storedSettings, mode: selectedChatMode } =
        await resolveChatModeForTurn({
          storedChatMode: chat.chatMode,
          requestedChatMode: req.requestedChatMode,
        });

      // Accept the user message and latch an implicit chat's first mode in one
      // synchronous transaction. This keeps the idempotent message insert and
      // the mode latch atomic. The conditional update also arbitrates
      // concurrent first turns; a loser reloads and uses the winner below.
      const acceptedTurn = await withChatQueueLock(req.chatId, () =>
        acceptChatTurn(db, {
          chatId: req.chatId,
          storedChatMode: chat.chatMode,
          selectedChatMode,
          content:
            implementPlanDisplayPrompt ??
            displayUserPrompt ??
            defaultAiUserPrompt,
          userInputRequestId: req.userInputRequestId,
          chatTurnIntentId: req.intentId,
          chatTurnIntent: executionObserver(req)?.intent,
        }),
      );
      mutatedPersistedChat = true;
      if (acceptedTurn.userMessageId !== null) {
        executionObserver(req)?.onAccepted?.(acceptedTurn.userMessageId);
      }

      if (acceptedTurn.userMessageId === null) {
        // A renderer replayed a continuation after main had already accepted
        // the same idempotency key. Confirm acceptance without
        // inserting another user message or starting another model turn. The
        // transaction above also repairs a still-null first-turn mode.
        replayedAcceptedFollowUp = true;
        sendChatChunk(event.sender, {
          chatId: req.chatId,
          invocationRef: req.invocationRef,
          streamId: req.streamId,
          acceptedUserInputRequestId: req.userInputRequestId,
        } satisfies ChatStreamChunkPayload);
        const terminalResponse = {
          chatId: req.chatId,
          invocationRef: req.invocationRef,
          streamId: req.streamId,
          updatedFiles: false,
        } satisfies ChatStreamEndPayload;
        safeSend(event.sender, "chat:response:end", terminalResponse);
        return req.chatId;
      }

      if (
        acceptedTurn.authoritativeChatMode !== null &&
        acceptedTurn.authoritativeChatMode !== selectedChatMode
      ) {
        const authoritativeResolution = await resolveChatModeForTurn({
          storedChatMode: acceptedTurn.authoritativeChatMode,
        });
        ({ settings: storedSettings, mode: selectedChatMode } =
          authoritativeResolution);
      }

      const userMessageId = acceptedTurn.userMessageId;
      if (req.userInputRequestId) {
        sendChatChunk(event.sender, {
          chatId: req.chatId,
          invocationRef: req.invocationRef,
          streamId: req.streamId,
          acceptedUserInputRequestId: req.userInputRequestId,
        } satisfies ChatStreamChunkPayload);
      }
      const settings = {
        ...storedSettings,
        selectedChatMode,
      };
      if (
        settings.enableContextCompaction !== false &&
        (await isChatPendingCompaction(req.chatId))
      ) {
        let streamedCompactionPreview = false;
        const compactionResult = await performCompaction(
          event,
          req.chatId,
          getDyadAppPath(chat.app.path),
          dyadRequestId,
          (summary) => {
            streamedCompactionPreview = true;
            safeSend(event.sender, "chat:response:chunk", {
              chatId: req.chatId,
              invocationRef: req.invocationRef,
              streamId: req.streamId,
              streamingPreview: {
                content: `<dyad-compaction title="Compacting conversation">\n${escapeXmlContent(summary)}\n</dyad-compaction>`,
              },
            } satisfies ChatStreamChunkPayload);
          },
          { abortSignal: abortController.signal },
        );
        if (streamedCompactionPreview) {
          safeSend(event.sender, "chat:response:chunk", {
            chatId: req.chatId,
            invocationRef: req.invocationRef,
            streamId: req.streamId,
            streamingPreview: { content: "" },
          } satisfies ChatStreamChunkPayload);
        }
        if (!compactionResult.success && !compactionResult.aborted) {
          logger.warn(
            `Compaction failed for chat ${req.chatId}: ${compactionResult.error ?? "already in progress"}`,
          );
        }
        if (abortController.signal.aborted) {
          return req.chatId;
        }
      }

      const attachmentDeliveryConfig = resolveAttachmentDeliveryConfig({
        mode: selectedChatMode,
      });
      const localAgentAiUserPrompt =
        aiUserPrompt +
        buildLocalAgentAttachmentInfo(
          storedAttachments,
          attachmentDeliveryConfig,
        );
      sendChatChunk(event.sender, {
        chatId: req.chatId,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
        effectiveChatMode: selectedChatMode,
      } satisfies ChatStreamChunkPayload);
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
            orderBy: (messages, { asc }) => [
              asc(messages.createdAt),
              asc(messages.id),
            ],
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
      sendChatChunk(event.sender, {
        chatId: req.chatId,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
        messages: updatedChat.messages.map(toRendererMessage),
      } satisfies ChatStreamChunkPayload);

      const piAppPath = getDyadAppPath(updatedChat.app.path);
      const referencedAppsForAgent =
        await extractMentionedAppsReferencesFromPrompt(
          req.prompt,
          updatedChat.app.id,
        );
      const effectiveAiUserPrompt =
        attachmentDeliveryConfig.useOnDiskAttachmentBlock
          ? localAgentAiUserPrompt
          : defaultAiUserPrompt;
      const aiRules = await readAiRules(piAppPath);
      const themePrompt = await getThemePromptById(updatedChat.app.themeId);
      const frameworkType = detectFrameworkType(piAppPath);
      const restartAppToolAvailable =
        settings.agentToolConsents?.restart_app !== "never";
      const rebuildAppToolAvailable =
        settings.agentToolConsents?.rebuild_app !== "never";
      const isSecurityReviewIntent = req.prompt.startsWith("/security-review");
      let piSystemPrompt: string;
      if (isSecurityReviewIntent) {
        const { formattedOutput } = await extractCodebase({
          appPath: piAppPath,
          chatContext: validateChatContext(updatedChat.app.chatContext),
        });
        piSystemPrompt = `${SECURITY_REVIEW_SYSTEM_PROMPT}\n\nThis is my codebase. ${formattedOutput}`;
        try {
          const securityRules = await fs.promises.readFile(
            path.join(piAppPath, "SECURITY_RULES.md"),
            "utf8",
          );
          if (securityRules.trim()) {
            piSystemPrompt +=
              "\n\n# Project-specific security rules:\n" + securityRules;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            logger.warn("Failed to read security rules", error);
          }
        }
      } else {
        piSystemPrompt = constructSystemPrompt({
          aiRules,
          chatMode: selectedChatMode,
          themePrompt,
          readOnly: selectedChatMode === "ask",
          frameworkType,
          hasSupabaseProject: !!updatedChat.app.supabaseProjectId,
          enableAppBlueprint:
            settings.enableAppBlueprint && updatedChat.app.needsAppBlueprint,
          testingEnabled: !!updatedChat.app.testingEnabled,
          restartAppToolAvailable,
          rebuildAppToolAvailable,
        });
      }

      if (updatedChat.app.supabaseProjectId && isSupabaseConnected(settings)) {
        const supabaseClientCode = await getSupabaseClientCode({
          projectId: updatedChat.app.supabaseProjectId,
          organizationSlug: updatedChat.app.supabaseOrganizationSlug ?? null,
        });
        piSystemPrompt +=
          "\n\n" + getSupabaseAvailableSystemPrompt(supabaseClientCode);
      } else if (updatedChat.app.neonProjectId) {
        piSystemPrompt +=
          "\n\n" +
          (await buildNeonPromptForApp({
            appPath: updatedChat.app.path,
            neonProjectId: updatedChat.app.neonProjectId,
            neonActiveBranchId: updatedChat.app.neonActiveBranchId,
            neonDevelopmentBranchId: updatedChat.app.neonDevelopmentBranchId,
            selectedChatMode,
          }));
      }

      let piPrompt = effectiveAiUserPrompt;
      if (req.prompt.startsWith("Summarize from chat-id=")) {
        const previousChat = await db.query.chats.findFirst({
          where: eq(chats.id, Number(req.prompt.split("=")[1])),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            },
          },
        });
        piSystemPrompt = SUMMARIZE_CHAT_SYSTEM_PROMPT;
        piPrompt =
          "Summarize the following chat: " +
          formatMessagesForSummary(previousChat?.messages ?? []);
      }
      piPrompt = appendReferencedAppsReminder(piPrompt, referencedAppsForAgent);

      let lastDbSaveAt = 0;
      let piPartialResponse = "";
      const result = await executePiChatTurn({
        event,
        chatId: req.chatId,
        app: updatedChat.app,
        historyRows: limitChatHistoryRows(
          getPostCompactionMessages(updatedChat.messages).filter(
            (message) =>
              message.id !== userMessageId &&
              message.id !== placeholderAssistantMessage.id,
          ),
          settings.maxChatTurnsInContext ?? MAX_CHAT_TURNS_IN_CONTEXT,
        ),
        userMessageId,
        placeholderMessageId: placeholderAssistantMessage.id,
        settings,
        chatMode: selectedChatMode,
        systemPrompt: piSystemPrompt,
        prompt: piPrompt,
        attachmentPaths,
        referencedApps: referencedAppsForAgent,
        dyadRequestId,
        abortController,
        onChunk: async (chunk) => {
          if (chunk.streamingPatch) {
            piPartialResponse =
              piPartialResponse.slice(0, chunk.streamingPatch.offset) +
              chunk.streamingPatch.content;
            setPartialResponseForStream(abortController, piPartialResponse);
            const now = Date.now();
            if (now - lastDbSaveAt >= 150) {
              await db
                .update(messages)
                .set({ content: piPartialResponse })
                .where(eq(messages.id, placeholderAssistantMessage.id));
              lastDbSaveAt = now;
            }
          }
          sendChatChunk(event.sender, {
            ...chunk,
            chatId: req.chatId,
            invocationRef: req.invocationRef,
            streamId: req.streamId,
          } satisfies ChatStreamChunkPayload);
        },
      });

      if (!abortController.signal.aborted) {
        safeSend(event.sender, "chat:response:end", {
          chatId: req.chatId,
          invocationRef: req.invocationRef,
          streamId: req.streamId,
          updatedFiles: result.updatedFiles,
          chatSummary: result.chatSummary,
          warningMessages: result.warningMessages,
        } satisfies ChatStreamEndPayload);
      }
      finishedNaturally = true;
      return req.chatId;
    } catch (error) {
      logger.error("Error calling LLM:", error);
      const errorMessage = isDyadError(error) ? error.message : String(error);
      const rendererError = `Sorry, there was an error processing your request: ${errorMessage}`;
      safeSend(event.sender, "chat:response:error", {
        chatId: req.chatId,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
        error: rendererError,
      } satisfies ChatStreamErrorPayload);

      return "error";
    } finally {
      if (mutatedPersistedChat) {
        queryInvalidationBus.publish(
          [{ family: "chats" }, { family: "chat", chatId: req.chatId }],
          {
            originEndpoint: event.sender,
            // Every terminal path refreshes the origin's list; detail must
            // still be invalidated on errors/cancellation.
            originHandledScopes: [{ family: "chats" }],
          },
        );
      }
      releaseChatProducerInterest(event.sender, req.chatId);
      // Clean up the abort controller
      if (trackedStream) {
        removeTrackedValue(activeStreams, req.chatId, trackedStream);
      }
      admissionPendingStreams.delete(abortController);
      partialResponses.delete(abortController);

      // Notify renderer that stream has ended. When the stream was cancelled,
      // `cancelTrackedStreams` is the sole sender of the end events (it emits
      // both `chat:response:end` with `wasCancelled` and `chat:stream:end`
      // as soon as it aborts this stream). Sending `chat:stream:end` here too
      // would deliver a duplicate end event to the renderer, so skip it on the
      // aborted path.
      if (!abortController.signal.aborted) {
        safeSend(event.sender, "chat:stream:end", {
          chatId: req.chatId,
        } satisfies ChatStreamTransportEndPayload);
      }
      if (!replayedAcceptedFollowUp) {
        if (finishedNaturally) {
          userInputRegistry.streamFinished(req.chatId);
        } else if (!activeStreams.has(req.chatId)) {
          // Errors and cancellation sweep pending user inputs; only successful
          // natural completion can arm a follow-up dispatch.
          // A memory-owned follow-up stays due on dispatch failure. Sweeping
          // it here would prevent renderer focus/remount from retrying it.
          userInputRegistry.sweepChat(req.chatId, req.userInputRequestId);
        }
      }

      // Signal any awaiting `cancelStream` call that all writes have settled,
      // then drop the (now-resolved) completion promise for this chat. Resolve
      // before deleting so a reader that consults the map after the abort still
      // observes a settled promise rather than a missing entry.
      resolveCompletion();
      removeTrackedValue(streamCompletions, req.chatId, completion);
    }
  };
  internalChatStreamHandler = chatStreamHandler;

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
