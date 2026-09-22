import { SubscriptionBillingError } from "@/shared/subscription_billing_error";
import type { ExternalModelAdmission } from "../services/external_model_admission";
import { awaitTurnPreflight } from "../services/await_turn_preflight";
import type { AutoModelCandidates } from "../services/auto_model_candidates";
import { preflightSubscriptionTurn } from "../services/subscription_turn_preflight";
import { v4 as uuidv4 } from "uuid";
import { app, type IpcMainInvokeEvent, type WebContents } from "electron";
import { createTypedHandler } from "./base";
import { chatContracts, ChatStreamParamsSchema } from "../types/chat";
import type { ModelMessage, TextPart, ImagePart } from "ai";

import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { scheduleChatSearchIndexing } from "../../pro/main/ipc/handlers/local_agent/chat_search_indexer";
import { and, eq, isNull } from "drizzle-orm";
import { hasSupabaseCredentialsForOrganization } from "../../lib/schemas";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import {
  constructImplementerPrompt,
  resolveImplementerProvider,
} from "../../prompts/local_agent_prompt";
import { detectFrameworkType } from "../utils/framework_utils";
import { getThemePromptById } from "../utils/theme_utils";
import {
  getSupabaseAvailableSystemPrompt,
  SUPABASE_DISCONNECTED_SYSTEM_PROMPT,
} from "../../prompts/supabase_prompt";
import { registerTrustedIpcHandler } from "./trusted_handle";
import {
  buildNeonPromptForApp,
  getNeonEmailVerificationEnabled,
} from "../../neon_admin/neon_prompt_context";
import { NEON_DISCONNECTED_SYSTEM_PROMPT } from "../../prompts/neon_prompt";
import { getDyadAppPath } from "../../paths/paths";
import { buildDyadMediaUrl } from "../../lib/dyadMediaUrl";
import type { ChatStreamParams } from "@/ipc/types";
import type { ChatStreamInvocationRef } from "@/chat_stream/invocation";
import { resolveRootDatabasePromptState } from "@/shared/database_provider";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";
import type {
  ChatStreamChunkPayload,
  ChatStreamEndPayload,
  ChatStreamErrorPayload,
  ChatStreamStartPayload,
  ChatStreamTransportEndPayload,
} from "@/chat_stream/protocol";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { listCodebaseFileMetadata } from "../../utils/codebase";
import { processFullResponseActions } from "../processors/response_processor";
import { getDyadExecuteSqlTags } from "../utils/dyad_tag_parser";
import { doesSqlDeleteData } from "@/lib/sqlSchemaMutation";
import {
  streamTestResponse,
  getTestResponse,
  noteAck,
} from "./testing_chat_handlers";
import {
  normalizeModelSelection,
  resolveDefaultModelSelection,
} from "../utils/model_effort";
import log from "electron-log";
import { sendTelemetryEvent } from "../utils/telemetry";
import { getSupabaseClientCode } from "../../supabase_admin/supabase_context";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "../../prompts/summarize_chat_system_prompt";
import { SECURITY_REVIEW_SYSTEM_PROMPT } from "../../prompts/security_review_prompt";
import fs from "node:fs";
import * as path from "path";
import * as crypto from "crypto";
import { readFile, writeFile } from "fs/promises";

import {
  clearPendingLocalAgentInputsForChat,
  handleLocalAgentStream,
  hasCompletedAppBlueprintQuestionnaire,
} from "../../pro/main/ipc/handlers/local_agent/local_agent_handler";
import { isPreCommitHookAvailable } from "../services/pre_commit_service";
import { userInputRegistry } from "../../user_input/main";
import { getAppBlueprintForChat } from "./app_blueprint_handlers";

import { safeSend, type SafeSender } from "../utils/safe_sender";
import {
  releaseChatProducerInterest,
  sendChatChunk,
} from "@/window_infrastructure/main/production_high_volume";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { escapeXmlAttr } from "../../../shared/xmlEscape";
import { buildDyadAttachmentTag } from "../../../shared/dyadAttachment";
import { appendCancelledResponseNotice } from "@/shared/chatCancellation";
import {
  persistReferencedAppIds,
  readStoredReferencedAppIds,
  resolveStickyReferencedApps,
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
  isTurboEditsV2Enabled,
} from "@/lib/schemas";
import { isFreeProModel } from "@/lib/freeProModel";
import { isImplementerSubagentEnabled } from "@/lib/autoSidekick";
import {
  assertChatModeCompatibleWithModel,
  normalizeStoredChatMode,
  resolveChatModeForTurn,
} from "./chat_mode_resolution";
import {
  acceptChatTurn,
  isChatTurnAlreadyAccepted,
} from "./chat_turn_acceptance";
import { withChatQueueLock } from "@/chat_stream/queue_lock";
import {
  commitFreeAgentQuotaSlot,
  releaseFreeAgentQuotaSlot,
  reserveFreeAgentQuotaSlot,
  unmarkMessageAsUsingFreeAgentQuota,
} from "./free_agent_quota_handlers";
import { getCurrentCommitHash } from "../utils/git_utils";
import { getAiMessagesJsonIfWithinLimit } from "../utils/ai_messages_utils";
import { readSettings, setSentinelActiveChat } from "@/main/settings";
import { recordAppSizeForSession } from "@/main/last_session_store";
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
import { toRendererMessages } from "../utils/renderer_chat_message";

const logger = log.scope("chat_stream_handlers");

type ImplementerCapabilityApp = Pick<
  typeof apps.$inferSelect,
  | "supabaseProjectId"
  | "supabaseOrganizationSlug"
  | "neonProjectId"
  | "neonActiveBranchId"
  | "neonDevelopmentBranchId"
>;

export function resolveImplementerCapabilityState(
  app: ImplementerCapabilityApp,
  settings: ReturnType<typeof readSettings>,
) {
  const supabaseConnected = hasSupabaseCredentialsForOrganization(
    settings,
    app.supabaseOrganizationSlug,
  );
  const neonConnected = Boolean(settings.neon?.accessToken?.value);
  const neonBranchId = app.neonActiveBranchId ?? app.neonDevelopmentBranchId;
  const neonToolsAvailable = Boolean(
    neonConnected && app.neonProjectId && neonBranchId,
  );
  const provider = resolveImplementerProvider({
    hasSupabaseProject: Boolean(app.supabaseProjectId),
    hasNeonProject: Boolean(app.neonProjectId),
  });
  const providerAvailable =
    provider === "supabase"
      ? supabaseConnected
      : provider === "neon"
        ? neonToolsAvailable
        : false;
  const providerMetadataToolName =
    provider === "supabase"
      ? "get_supabase_project_info"
      : provider === "neon"
        ? "get_neon_project_info"
        : undefined;

  return {
    provider,
    supabaseConnected,
    neonToolsAvailable,
    neonBranchId,
    providerMetadataReadAvailable:
      providerAvailable &&
      providerMetadataToolName !== undefined &&
      settings.agentToolConsents?.[providerMetadataToolName] !== "never",
    databaseSchemaReadAvailable:
      providerAvailable &&
      settings.agentToolConsents?.["get_database_table_schema"] !== "never",
    readGuideAvailable: settings.agentToolConsents?.["read_guide"] !== "never",
  };
}

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
const admittedStreams = new Map<number, Set<TrackedStream>>();
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

export function markStreamAdmitted<T>(
  admitted: Map<number, Set<T>>,
  chatId: number,
  stream: T,
): number | null {
  const isNewConcurrentChat = !admitted.has(chatId);
  addTrackedValue(admitted, chatId, stream);
  return isNewConcurrentChat && admitted.size > 1 ? admitted.size : null;
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
    clearPendingLocalAgentInputsForChat(chatId);
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

/** Read-only active-stream probe used while an app-wide admission block is held. */
export async function hasActiveStreamsForApp(appId: number): Promise<boolean> {
  const inFlightChatIds = [
    ...new Set([...activeStreams.keys(), ...streamCompletions.keys()]),
  ].filter(
    (chatId) =>
      (activeStreams.get(chatId)?.size ?? 0) > 0 ||
      (streamCompletions.get(chatId)?.size ?? 0) > 0,
  );
  if (inFlightChatIds.length === 0) return false;
  const matchingChat = await db.query.chats.findFirst({
    columns: { id: true },
    where: and(eq(chats.appId, appId), inArray(chats.id, inFlightChatIds)),
  });
  return matchingChat !== undefined;
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
    streamCompletions.clear();
    streamAdmissionBlockCounts.clear();
    chatStreamAdmissionBlockCounts.clear();
    admissionPendingStreams.clear();
    pendingActorStreamCancellations.clear();
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
    let trackedStream: TrackedStream | undefined;
    // Set on every successful terminal path — including the agent-mode branches
    // that return early below. The `finally` block only arms a user-input
    // follow-up (`streamFinished`) when this is true, so leaving it false on a
    // turn that actually completed sweeps the armed request instead.
    let finishedNaturally = false;
    let replayedAcceptedFollowUp = false;
    let mutatedPersistedChat = false;
    let freeAgentQuotaReservationId: number | null = null;
    let reservedFreeAgentQuotaMessageId: number | null = null;
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
        const concurrentChatCount = markStreamAdmitted(
          admittedStreams,
          req.chatId,
          trackedStream,
        );
        if (concurrentChatCount !== null) {
          sendTelemetryEvent("chat:concurrent-stream-started", {
            concurrentChatCount,
          });
        }
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

      let baseSettings = readSettings();
      let selectedModel = chat.modelSelection
        ? await normalizeModelSelection(chat.modelSelection)
        : await resolveDefaultModelSelection(baseSettings);
      let { settings: storedSettings, mode: selectedChatMode } =
        await resolveChatModeForTurn({
          storedChatMode: chat.chatMode,
          requestedChatMode: req.requestedChatMode,
          settings: { ...baseSettings, selectedModel },
        });
      assertChatModeCompatibleWithModel(storedSettings, selectedChatMode);

      // Reserve quota before redo or attachment persistence. The reservation
      // is converted to a durable message mark only after turn acceptance.
      let isBasicAgentModeRequest = isBasicAgentMode({
        ...storedSettings,
        selectedChatMode,
      });
      const isAcceptedReplay = isChatTurnAlreadyAccepted(db, {
        chatId: req.chatId,
        chatTurnIntentId: req.intentId,
        userInputRequestId: req.userInputRequestId,
      });
      if (isBasicAgentModeRequest && !isAcceptedReplay) {
        const quotaReservation = await reserveFreeAgentQuotaSlot();
        if (quotaReservation.kind === "quota-exceeded") {
          const { quotaStatus } = quotaReservation;
          safeSend(event.sender, "chat:response:error", {
            chatId: req.chatId,
            invocationRef: req.invocationRef,
            streamId: req.streamId,
            error: JSON.stringify({
              type: "FREE_AGENT_QUOTA_EXCEEDED",
              hoursUntilReset: quotaStatus.hoursUntilReset,
              resetTime: quotaStatus.resetTime,
            }),
          } satisfies ChatStreamErrorPayload);
          return req.chatId;
        }
        freeAgentQuotaReservationId = quotaReservation.reservationId;
      }

      // Capture redo targets now, but delete them only when the replacement
      // turn is durably accepted after all rejecting preflight checks.
      const redoMessageIds: number[] = [];
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
          redoMessageIds.push(chatMessages[lastUserMessageIndex].id);

          // If there's an assistant message after the user message, delete it too
          if (
            lastUserMessageIndex < chatMessages.length - 1 &&
            chatMessages[lastUserMessageIndex + 1].role === "assistant"
          ) {
            redoMessageIds.push(chatMessages[lastUserMessageIndex + 1].id);
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
          displayAttachmentInfo += buildDyadAttachmentTag({
            name: attachment.name,
            type: attachment.type,
            url: mediaUrl,
            path: persistentPath,
            attachmentType: attachment.attachmentType,
          });

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
            mediaDisplayInfo += buildDyadAttachmentTag({
              name: media.fileName,
              type: media.mimeType,
              url: mediaUrl,
              path: media.filePath,
              attachmentType: "chat-context",
            });
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

      const autoModelCandidates: AutoModelCandidates = new Map();
      let externalModelAdmission: ExternalModelAdmission | undefined;
      const readAdmissionChat = () => {
        const latestChat = db
          .select({
            chatMode: chats.chatMode,
            modelSelection: chats.modelSelection,
          })
          .from(chats)
          .where(eq(chats.id, req.chatId))
          .get();
        if (!latestChat) {
          throw new DyadError(
            `Chat not found: ${req.chatId}`,
            DyadErrorKind.NotFound,
          );
        }

        return latestChat;
      };
      const readAdmissionSettings = () => {
        const current = readSettings();
        return {
          enableDyadPro: current.enableDyadPro,
          proModelUsage: current.proModelUsage,
          providerSettings: current.providerSettings,
          selectedModel: current.selectedModel,
          selectedChatMode: current.selectedChatMode,
          defaultChatMode: current.defaultChatMode,
          modelEffortPreferences: current.modelEffortPreferences,
        };
      };
      const retryAdmission = Symbol("retry-admission");
      const acceptTurn = async () => {
        // Preflight can wait on remote catalogs, auth and credits. Keep those
        // waits outside the queue lock so Stop and picker/queue edits can run.
        while (true) {
          abortController.signal.throwIfAborted();
          const snapshot = readAdmissionChat();
          const sourceSettings = readAdmissionSettings();
          const attemptSettings = { ...baseSettings, ...sourceSettings };
          const candidates: AutoModelCandidates = new Map();
          const prepared = await awaitTurnPreflight(
            (async () => {
              const model = snapshot.modelSelection
                ? await normalizeModelSelection(snapshot.modelSelection)
                : await resolveDefaultModelSelection(attemptSettings);
              const { mode } = await resolveChatModeForTurn({
                storedChatMode: snapshot.chatMode,
                requestedChatMode:
                  req.requestedChatMode ??
                  normalizeStoredChatMode(snapshot.chatMode),
                settings: { ...attemptSettings, selectedModel: model },
              });
              return isAcceptedReplay
                ? { model, externalModelAdmission: undefined }
                : preflightSubscriptionTurn(
                    model,
                    { ...attemptSettings, selectedChatMode: mode },
                    abortController.signal,
                    candidates,
                  );
            })().then(
              (result) => ({ ok: true as const, ...result }),
              (error) => ({ ok: false as const, error }),
            ),
            abortController.signal,
          );
          const result = await withChatQueueLock(req.chatId, async () => {
            abortController.signal.throwIfAborted();
            const latestChat = readAdmissionChat();
            // Even a rejection belongs to the checked selection, not a model
            // the user chose while that check was pending.
            if (
              JSON.stringify(latestChat) !== JSON.stringify(snapshot) ||
              JSON.stringify(readAdmissionSettings()) !==
                JSON.stringify(sourceSettings)
            )
              return retryAdmission;
            if (!prepared.ok) throw prepared.error;
            baseSettings = attemptSettings;
            selectedModel = prepared.model;
            externalModelAdmission = prepared.externalModelAdmission;
            autoModelCandidates.clear();
            for (const [alias, candidate] of candidates)
              autoModelCandidates.set(alias, candidate);
            const latestResolution = await resolveChatModeForTurn({
              storedChatMode: latestChat.chatMode,
              requestedChatMode:
                req.requestedChatMode ??
                normalizeStoredChatMode(latestChat.chatMode),
              settings: { ...baseSettings, selectedModel },
            });
            ({ settings: storedSettings, mode: selectedChatMode } =
              latestResolution);
            assertChatModeCompatibleWithModel(storedSettings, selectedChatMode);
            isBasicAgentModeRequest = isBasicAgentMode({
              ...storedSettings,
              selectedChatMode,
            });

            if (
              isBasicAgentModeRequest &&
              freeAgentQuotaReservationId === null &&
              !isAcceptedReplay
            ) {
              const quotaReservation = await reserveFreeAgentQuotaSlot();
              if (quotaReservation.kind === "quota-exceeded") {
                const { quotaStatus } = quotaReservation;
                safeSend(event.sender, "chat:response:error", {
                  chatId: req.chatId,
                  invocationRef: req.invocationRef,
                  streamId: req.streamId,
                  error: JSON.stringify({
                    type: "FREE_AGENT_QUOTA_EXCEEDED",
                    hoursUntilReset: quotaStatus.hoursUntilReset,
                    resetTime: quotaStatus.resetTime,
                  }),
                } satisfies ChatStreamErrorPayload);
                return null;
              }
              freeAgentQuotaReservationId = quotaReservation.reservationId;
            } else if (
              !isBasicAgentModeRequest &&
              freeAgentQuotaReservationId !== null
            ) {
              await releaseFreeAgentQuotaSlot(freeAgentQuotaReservationId);
              freeAgentQuotaReservationId = null;
            }

            const persistAcceptedTurn = () => {
              abortController.signal.throwIfAborted();
              return acceptChatTurn(db, {
                chatId: req.chatId,
                storedChatMode: latestChat.chatMode,
                selectedChatMode,
                selectedModel,
                content:
                  implementPlanDisplayPrompt ??
                  displayUserPrompt ??
                  defaultAiUserPrompt,
                userInputRequestId: req.userInputRequestId,
                chatTurnIntentId: req.intentId,
                chatTurnIntent: executionObserver(req)?.intent,
                usingFreeAgentModeQuota: freeAgentQuotaReservationId !== null,
                redoMessageIds,
              });
            };
            if (freeAgentQuotaReservationId === null) {
              return persistAcceptedTurn();
            }

            const reservationId = freeAgentQuotaReservationId;
            const acceptedTurn = await commitFreeAgentQuotaSlot(
              reservationId,
              persistAcceptedTurn,
            );
            freeAgentQuotaReservationId = null;
            if (acceptedTurn.userMessageId !== null) {
              reservedFreeAgentQuotaMessageId = acceptedTurn.userMessageId;
            }
            return acceptedTurn;
          });
          if (result !== retryAdmission) return result;
        }
      };

      const acceptedTurn = await acceptTurn();
      if (acceptedTurn === null) {
        return req.chatId;
      }
      mutatedPersistedChat = true;

      // Accept the user message and latch an implicit chat's first mode in one
      // synchronous transaction. This keeps the idempotent message insert and
      // the mode latch atomic. The conditional update also arbitrates
      // concurrent first turns; a loser reloads and uses the winner below.
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

      if (acceptedTurn.authoritativeModel) {
        const connection = selectedModel.connection;
        selectedModel = {
          ...(await normalizeModelSelection(acceptedTurn.authoritativeModel)),
          connection,
        };
        storedSettings = { ...storedSettings, selectedModel };
      }

      const authoritativeResolution = await resolveChatModeForTurn({
        storedChatMode: acceptedTurn.authoritativeChatMode,
        requestedChatMode:
          req.requestedChatMode ??
          normalizeStoredChatMode(acceptedTurn.authoritativeChatMode),
        settings: storedSettings,
      });
      ({ settings: storedSettings, mode: selectedChatMode } =
        authoritativeResolution);
      assertChatModeCompatibleWithModel(storedSettings, selectedChatMode);

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
      isBasicAgentModeRequest = isBasicAgentMode(settings);
      if (
        !isBasicAgentModeRequest &&
        reservedFreeAgentQuotaMessageId !== null
      ) {
        await unmarkMessageAsUsingFreeAgentQuota(
          reservedFreeAgentQuotaMessageId,
        );
        reservedFreeAgentQuotaMessageId = null;
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
      sendChatChunk(event.sender, {
        chatId: req.chatId,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
        effectiveChatMode: selectedChatMode,
      } satisfies ChatStreamChunkPayload);
      // Only Dyad Pro requests have request ids.
      if (settings.enableDyadPro) {
        // Generate requestId early so it can be saved with the message
        dyadRequestId = uuidv4();
      }
      if (!isLocalAgentBackedMode(selectedChatMode)) {
        throw new DyadError(
          `Chat mode ${selectedChatMode} is not backed by the local agent stream`,
          DyadErrorKind.Internal,
        );
      }

      // Add a placeholder assistant message immediately
      const [placeholderAssistantMessage] = await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "assistant",
          content: "", // Start with empty content
          // Agentic tools apply their mutations as they run. Mark their
          // messages as already handled so legacy proposal actions cannot
          // replay tool XML after an error or cancellation.
          approvalState: "approved",
          requestId: dyadRequestId,
          model:
            selectedModel.connection === "subscription"
              ? `ChatGPT subscription (${selectedModel.name})`
              : selectedModel.name,
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
        messages: toRendererMessages(updatedChat.messages),
      } satisfies ChatStreamChunkPayload);

      let fullResponse = "";

      // Check if this is a test prompt
      const testResponse = getTestResponse(req.prompt);

      if (testResponse) {
        // For test prompts, use the dedicated function
        fullResponse = await streamTestResponse(
          event,
          req.chatId,
          req.invocationRef,
          req.streamId,
          testResponse,
          abortController,
          placeholderAssistantMessage.id,
        );
      } else {
        const isBuildMode = selectedChatMode === "build";
        const isLocalAgentMode = selectedChatMode === "local-agent";
        const isAskMode = selectedChatMode === "ask";
        const isPlanMode = selectedChatMode === "plan";
        const appPath = getDyadAppPath(updatedChat.app.path);
        // All modes inspect files on demand. Keep diagnostics metadata-only;
        // neither a model client nor full codebase contents are needed here.
        const { sizeStats } = await listCodebaseFileMetadata({
          appPath,
          chatContext: {
            contextPaths: [],
            smartContextAutoIncludes: [],
            excludePaths: [],
          },
        });
        if (sizeStats) {
          recordAppSizeForSession({ appId: updatedChat.app.id, ...sizeStats });
        }

        // References remain available through read-only tools for this chat.
        // Never eagerly inject the other apps' file contents into the prompt.
        const stickyReferences = await resolveStickyReferencedApps({
          prompt: req.prompt,
          persistedAppIds: readStoredReferencedAppIds(
            updatedChat.referencedAppIds,
          ),
          excludeCurrentAppId: updatedChat.app.id,
        });
        const referencedAppsForAgent = stickyReferences.references;
        if (stickyReferences.changed) {
          await persistReferencedAppIds(req.chatId, stickyReferences.appIds);
        }
        const effectiveAiUserPrompt =
          attachmentDeliveryConfig.useOnDiskAttachmentBlock
            ? localAgentAiUserPrompt
            : defaultAiUserPrompt;

        const aiRules = await readAiRules(getDyadAppPath(updatedChat.app.path));

        // Get theme prompt for the app (null themeId means "no theme")
        const themePrompt = await getThemePromptById(updatedChat.app.themeId);
        logger.log(
          `Theme for app ${updatedChat.app.id}: ${updatedChat.app.themeId ?? "none"}, prompt length: ${themePrompt.length} chars`,
        );

        const frameworkType = detectFrameworkType(appPath);
        // Match the Explorer persona's actual tool gate so the prompt never
        // points the model at spawn_agent(persona="explorer") when that
        // persona is disabled. Code-index readiness is independent now that
        // spawn_agent replaces the old explore_code tool.
        const codeExplorerAvailable =
          isDyadProEnabled(settings) &&
          settings.enableExplorerSubagent !== false &&
          settings.agentToolConsents?.["spawn_agent"] !== "never";
        // Mirrors explore_chat_history's toolset inclusion (Pro, and not
        // consent-"never") so the prompt never points the model at a tool
        // that isn't in the toolset. Consent is read from settings directly
        // because this module must not import the pro tool registry.
        const historyExplorerAvailable =
          isDyadProEnabled(settings) &&
          settings.agentToolConsents?.["explore_chat_history"] !== "never";
        const implementerAvailable =
          selectedChatMode === "local-agent" &&
          isDyadProEnabled(settings) &&
          isImplementerSubagentEnabled(settings);
        const restartAppToolAvailable =
          settings.agentToolConsents?.["restart_app"] !== "never";
        const preCommitHookAvailable =
          selectedChatMode === "local-agent" &&
          settings.agentToolConsents?.["run_pre_commit"] !== "never" &&
          (await isPreCommitHookAvailable(appPath));
        const reinstallAndRestartAppToolAvailable =
          settings.agentToolConsents?.["reinstall_and_restart_app"] !== "never";
        const runBuildToolAvailable =
          settings.agentToolConsents?.["run_build"] !== "never";
        const planningQuestionnaireAvailable =
          settings.agentToolConsents?.["planning_questionnaire"] !== "never";
        const appBlueprint = getAppBlueprintForChat(updatedChat.id);
        const hasAppBlueprint = Boolean(appBlueprint);
        const appBlueprintQuestionnaireCompleted =
          hasCompletedAppBlueprintQuestionnaire(updatedChat.messages);
        const initialSupabaseProviderToolsAvailable = Boolean(
          updatedChat.app.supabaseProjectId &&
          hasSupabaseCredentialsForOrganization(
            settings,
            updatedChat.app.supabaseOrganizationSlug,
          ),
        );
        const initialNeonCredentialsAvailable = Boolean(
          updatedChat.app.neonProjectId && settings.neon?.accessToken?.value,
        );
        const initialNeonProviderToolsAvailable = Boolean(
          initialNeonCredentialsAvailable &&
          (updatedChat.app.neonActiveBranchId ??
            updatedChat.app.neonDevelopmentBranchId),
        );
        const implementerFallbackSystemPrompt = constructImplementerPrompt(
          aiRules,
          {
            provider: resolveImplementerProvider({
              hasSupabaseProject: Boolean(updatedChat.app.supabaseProjectId),
              hasNeonProject: Boolean(updatedChat.app.neonProjectId),
            }),
            frameworkType,
            testingEnabled: Boolean(updatedChat.app.testingEnabled),
            runTestsAvailable:
              settings.agentToolConsents?.["run_tests"] !== "never",
            // Refresh failure disables every provider tool for the child, so
            // the fallback prompt must not advertise live provider reads.
            supabaseConnected: false,
            neonToolsAvailable: false,
            neonEmailVerificationEnabled: undefined,
            providerMetadataReadAvailable: false,
            databaseSchemaReadAvailable: false,
            readGuideAvailable:
              settings.agentToolConsents?.["read_guide"] !== "never",
          },
        );
        const refreshImplementerContext = async () => {
          const refreshedApp =
            (await db.query.apps.findFirst({
              where: eq(apps.id, updatedChat.app.id),
            })) ?? updatedChat.app;
          const latestSettings = readSettings();
          const capabilityState = resolveImplementerCapabilityState(
            refreshedApp,
            latestSettings,
          );
          const {
            provider,
            supabaseConnected,
            neonToolsAvailable,
            neonBranchId,
            providerMetadataReadAvailable,
            databaseSchemaReadAvailable,
            readGuideAvailable,
          } = capabilityState;
          const refreshedFrameworkType = detectFrameworkType(
            getDyadAppPath(refreshedApp.path),
          );
          const neonEmailVerificationEnabled =
            provider === "neon" &&
            neonToolsAvailable &&
            refreshedApp.neonProjectId
              ? await getNeonEmailVerificationEnabled(
                  refreshedApp.neonProjectId,
                  neonBranchId,
                )
              : provider === "neon"
                ? undefined
                : false;
          return {
            systemPrompt: constructImplementerPrompt(aiRules, {
              provider,
              frameworkType: refreshedFrameworkType,
              testingEnabled: Boolean(refreshedApp.testingEnabled),
              runTestsAvailable:
                latestSettings.agentToolConsents?.["run_tests"] !== "never",
              supabaseConnected,
              neonToolsAvailable,
              neonEmailVerificationEnabled,
              providerMetadataReadAvailable,
              databaseSchemaReadAvailable,
              readGuideAvailable,
            }),
            supabaseProjectId: refreshedApp.supabaseProjectId,
            supabaseOrganizationSlug: refreshedApp.supabaseOrganizationSlug,
            neonProjectId: refreshedApp.neonProjectId,
            neonActiveBranchId: neonBranchId,
            supabaseProviderToolsAvailable: Boolean(
              supabaseConnected && refreshedApp.supabaseProjectId,
            ),
            neonProviderToolsAvailable: neonToolsAvailable,
            frameworkType: refreshedFrameworkType,
            testingEnabled: Boolean(refreshedApp.testingEnabled),
          };
        };

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
          hasAppBlueprint,
          planningQuestionnaireAvailable,
          appBlueprintQuestionnaireCompleted,
          appBlueprint,
          codeExplorerAvailable,
          historyExplorerAvailable,
          implementerAvailable,
          testingEnabled: !!updatedChat.app?.testingEnabled,
          preCommitHookAvailable,
          restartAppToolAvailable,
          reinstallAndRestartAppToolAvailable,
          runBuildToolAvailable,
        });

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

        const rootDatabasePromptState = resolveRootDatabasePromptState({
          hasSupabaseProject: Boolean(updatedChat.app.supabaseProjectId),
          supabaseCredentialsAvailable: initialSupabaseProviderToolsAvailable,
          hasNeonProject: Boolean(updatedChat.app.neonProjectId),
          neonCredentialsAvailable: initialNeonCredentialsAvailable,
        });
        if (rootDatabasePromptState === "supabase") {
          const supabaseClientCode = await getSupabaseClientCode({
            projectId: updatedChat.app.supabaseProjectId!,
            organizationSlug: updatedChat.app.supabaseOrganizationSlug ?? null,
          });
          systemPrompt +=
            "\n\n" +
            getSupabaseAvailableSystemPrompt(supabaseClientCode) +
            "\n\n";
        } else if (rootDatabasePromptState === "supabase-disconnected") {
          systemPrompt += "\n\n" + SUPABASE_DISCONNECTED_SYSTEM_PROMPT;
        } else if (rootDatabasePromptState === "neon") {
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
        } else if (rootDatabasePromptState === "neon-disconnected") {
          systemPrompt += "\n\n" + NEON_DISCONNECTED_SYSTEM_PROMPT;
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

        // Persist only this turn's model-facing user message. The shared agent
        // loop builds history from aiMessagesJson; the former XML generator's
        // separate, truncated display-history copy was never used by it.
        const userContent =
          implementPlanDisplayPrompt || displayUserPrompt
            ? effectiveAiUserPrompt
            : updatedChat.messages.find(
                (message) => message.id === userMessageId,
              )!.content;
        let aiUserMessage: ModelMessage = {
          role: "user",
          content: isAskMode
            ? removeDyadTags(removeNonEssentialTags(userContent))
            : removeNonEssentialTags(userContent),
        };
        if (attachmentPaths.length > 0) {
          aiUserMessage = await prepareMessageWithAttachments(
            aiUserMessage,
            attachmentPaths,
            {
              includeImageAttachments:
                attachmentDeliveryConfig.includeImageParts,
              inlineTextAttachments:
                attachmentDeliveryConfig.inlineTextAttachments,
            },
          );
        }
        const userAiMessagesJson = getAiMessagesJsonIfWithinLimit([
          aiUserMessage,
        ]);
        if (userAiMessagesJson) {
          await db
            .update(messages)
            .set({ aiMessagesJson: userAiMessagesJson })
            .where(eq(messages.id, userMessageId));
        }

        let chatMessages: ModelMessage[] | undefined;
        if (isSummarizeIntent) {
          const previousChat = await db.query.chats.findFirst({
            where: eq(chats.id, parseInt(req.prompt.split("=")[1])),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [
                  asc(messages.createdAt),
                  asc(messages.id),
                ],
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
        // Handle ask mode: use local-agent in read-only mode
        // This gives users access to code reading tools while in ask mode
        // Ask mode does not consume free agent quota
        if (isAskMode) {
          // Reconstruct system prompt for local-agent read-only mode
          let readOnlySystemPrompt = constructSystemPrompt({
            aiRules,
            chatMode: "local-agent",
            enableTurboEditsV2: false,
            themePrompt,
            readOnly: true,
            freeModelMode,
            codeExplorerAvailable,
            historyExplorerAvailable,
          });
          if (rootDatabasePromptState === "supabase-disconnected") {
            readOnlySystemPrompt +=
              "\n\n" + SUPABASE_DISCONNECTED_SYSTEM_PROMPT;
          } else if (rootDatabasePromptState === "neon-disconnected") {
            readOnlySystemPrompt += "\n\n" + NEON_DISCONNECTED_SYSTEM_PROMPT;
          }

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
              modelSelectionOverride: selectedModel,
              autoModelCandidates,
              externalModelAdmission,
              freeModelMode,
              referencedApps: referencedAppsForAgent,
              currentTurnHasOnDiskAttachment:
                hasScriptReadableAttachment(storedAttachments),
              supabaseProviderToolsAvailable:
                initialSupabaseProviderToolsAvailable,
              neonProviderToolsAvailable: initialNeonProviderToolsAvailable,
            },
          );
          if (!streamSuccess) {
            logger.warn(
              "Ask mode local agent stream did not complete successfully",
            );
          }
          finishedNaturally = streamSuccess;
          return;
        }

        // Handle plan mode: use local-agent with plan tools only
        // Plan mode is for requirements gathering and creating implementation plans
        if (isPlanMode) {
          // Reconstruct system prompt for plan mode
          let planModeSystemPrompt = constructSystemPrompt({
            aiRules,
            chatMode: "plan",
            enableTurboEditsV2: false,
            themePrompt,
            freeModelMode,
          });
          if (rootDatabasePromptState === "supabase-disconnected") {
            planModeSystemPrompt +=
              "\n\n" + SUPABASE_DISCONNECTED_SYSTEM_PROMPT;
          } else if (rootDatabasePromptState === "neon-disconnected") {
            planModeSystemPrompt += "\n\n" + NEON_DISCONNECTED_SYSTEM_PROMPT;
          }

          finishedNaturally = await handleLocalAgentStream(
            event,
            req,
            abortController,
            {
              placeholderMessageId: placeholderAssistantMessage.id,
              systemPrompt: planModeSystemPrompt,
              dyadRequestId: dyadRequestId ?? "[no-request-id]",
              planModeOnly: true,
              messageOverride: isSummarizeIntent ? chatMessages : undefined,
              settingsOverride: settings,
              modelSelectionOverride: selectedModel,
              autoModelCandidates,
              externalModelAdmission,
              freeModelMode,
              referencedApps: referencedAppsForAgent,
              currentTurnHasOnDiskAttachment: false,
              supabaseProviderToolsAvailable:
                initialSupabaseProviderToolsAvailable,
              neonProviderToolsAvailable: initialNeonProviderToolsAvailable,
            },
          );
          return;
        }

        // Build uses the same multi-step tool-calling loop as Agent, but with
        // a fail-closed app-building tool profile: no sub-agents, Engine tools,
        // logs, verification commands, sandbox scripts, or MCP servers.
        if (isBuildMode) {
          const readOnlyBuildTurn = isSecurityReviewIntent || isSummarizeIntent;
          finishedNaturally = await handleLocalAgentStream(
            event,
            req,
            abortController,
            {
              placeholderMessageId: placeholderAssistantMessage.id,
              systemPrompt,
              dyadRequestId: dyadRequestId ?? "[no-request-id]",
              readOnly: readOnlyBuildTurn,
              toolProfile: "build",
              messageOverride: isSummarizeIntent ? chatMessages : undefined,
              settingsOverride: settings,
              modelSelectionOverride: selectedModel,
              autoModelCandidates,
              externalModelAdmission,
              freeModelMode,
              referencedApps: referencedAppsForAgent,
              currentTurnHasOnDiskAttachment:
                hasScriptReadableAttachment(storedAttachments),
              supabaseProviderToolsAvailable:
                initialSupabaseProviderToolsAvailable,
              neonProviderToolsAvailable: initialNeonProviderToolsAvailable,
            },
          );
          return;
        }

        // Handle local-agent mode (Agent v2).
        // Referenced apps (from `@app:Name` mentions) are accessed by the
        // agent via tool calls with an `app_name` parameter — see
        // resolveTargetAppPath in the local agent tools. handleLocalAgentStream
        // injects a `<system-reminder>` into the user's latest message telling
        // the agent which `app_name` values are valid.
        if (isLocalAgentMode) {
          const streamSuccess = await handleLocalAgentStream(
            event,
            req,
            abortController,
            {
              placeholderMessageId: placeholderAssistantMessage.id,
              systemPrompt,
              dyadRequestId: dyadRequestId ?? "[no-request-id]",
              messageOverride: isSummarizeIntent ? chatMessages : undefined,
              settingsOverride: settings,
              modelSelectionOverride: selectedModel,
              autoModelCandidates,
              externalModelAdmission,
              freeModelMode,
              preCommitHookAvailable,
              refreshImplementerContext,
              implementerFallbackSystemPrompt,
              supabaseProviderToolsAvailable:
                initialSupabaseProviderToolsAvailable,
              neonProviderToolsAvailable: initialNeonProviderToolsAvailable,
              referencedApps: referencedAppsForAgent,
              currentTurnHasOnDiskAttachment:
                hasScriptReadableAttachment(storedAttachments),
            },
          );
          if (streamSuccess) {
            reservedFreeAgentQuotaMessageId = null;
          }

          finishedNaturally = streamSuccess;
          return;
        }

        // Adding a mode must explicitly choose a tool profile; never fall back
        // to interpreting generated XML as executable changes.
        throw new DyadError(
          `Unsupported chat mode: ${selectedChatMode}`,
          DyadErrorKind.Internal,
        );
      }

      // Only explicit [dyad-qa=...] fixtures reach this compatibility finalizer.
      // Real model turns return through the shared agent loop above.
      // If the stream was aborted but didn't throw (e.g. stream ended gracefully),
      // save the cancellation notice to the placeholder message.
      if (abortController.signal.aborted) {
        try {
          await db
            .update(messages)
            .set({
              content: appendCancelledResponseNotice(fullResponse),
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

      // PROTOCOL-GROUNDED REGION: handler terminal emission, outer catch,
      // guarded transport end, and completion resolution. Keep in sync with
      // src/chat_stream/host_transition.ts.
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
                orderBy: (messages, { asc }) => [
                  asc(messages.createdAt),
                  asc(messages.id),
                ],
              },
            },
          });

          sendChatChunk(event.sender, {
            chatId: req.chatId,
            invocationRef: req.invocationRef,
            streamId: req.streamId,
            messages: toRendererMessages(chat!.messages),
          } satisfies ChatStreamChunkPayload);

          if (status.error) {
            safeSend(event.sender, "chat:response:error", {
              chatId: req.chatId,
              invocationRef: req.invocationRef,
              streamId: req.streamId,
              error: `Sorry, there was an error applying the AI's changes: ${status.error}`,
              warningMessages: status.warningMessages,
            } satisfies ChatStreamErrorPayload);
          }

          // Signal that the stream has completed
          const terminalResponse = {
            chatId: req.chatId,
            invocationRef: req.invocationRef,
            streamId: req.streamId,
            updatedFiles: status.updatedFiles ?? false,
            extraFiles: status.extraFiles,
            extraFilesError: status.extraFilesError,
            warningMessages: status.warningMessages,
            chatSummary,
          } satisfies ChatStreamEndPayload;
          safeSend(event.sender, "chat:response:end", terminalResponse);
        } else {
          const terminalResponse = {
            chatId: req.chatId,
            invocationRef: req.invocationRef,
            streamId: req.streamId,
            updatedFiles: false,
            chatSummary,
          } satisfies ChatStreamEndPayload;
          safeSend(event.sender, "chat:response:end", terminalResponse);
        }
      }

      // Return the chat ID for backwards compatibility
      finishedNaturally = true;
      return req.chatId;
    } catch (error) {
      logger.error("Error calling LLM:", error);
      const errorMessage = isDyadError(error) ? error.message : String(error);
      const rendererError =
        error instanceof SubscriptionBillingError
          ? error.serialize()
          : `Sorry, there was an error processing your request: ${errorMessage}`;
      safeSend(event.sender, "chat:response:error", {
        chatId: req.chatId,
        invocationRef: req.invocationRef,
        streamId: req.streamId,
        error: rendererError,
      } satisfies ChatStreamErrorPayload);

      return "error";
    } finally {
      if (freeAgentQuotaReservationId !== null) {
        try {
          await releaseFreeAgentQuotaSlot(freeAgentQuotaReservationId);
        } catch (error) {
          logger.error("Failed to release pending Basic Agent quota", error);
        }
      }
      if (reservedFreeAgentQuotaMessageId !== null) {
        try {
          await unmarkMessageAsUsingFreeAgentQuota(
            reservedFreeAgentQuotaMessageId,
          );
        } catch (error) {
          logger.error("Failed to refund reserved Basic Agent quota", error);
        }
      }
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
        removeTrackedValue(admittedStreams, req.chatId, trackedStream);
      }
      admissionPendingStreams.delete(abortController);

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
