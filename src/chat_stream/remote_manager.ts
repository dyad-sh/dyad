import type { createStore } from "jotai";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import type { RemoteMachineClientConnection } from "@/distributed_machines/remote_client";
import { IpcRemoteMachineConnection } from "@/distributed_machines/ipc_connection";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import type { ChatStreamRuntimeDeps } from "./runtime_deps";
import { ChatStreamPreviewStore } from "./preview_store";
import { CHAT_STREAM_INVOCATION_KIND } from "./invocation";
import type {
  StreamEvent,
  StreamRequest,
  StreamSettledResult,
} from "./renderer_facade";
import {
  chatStreamClientDefinition,
  chatStreamKey,
  type ChatStreamIntentEvent,
  type ChatStreamRemoteSnapshot,
  type SerializableChatTurnIntent,
  unavailableChatStreamSnapshot,
} from "./transport";
import { sha256Hex } from "@/lib/browser_hash";
import { serializeImmutableChatTurnPayload } from "./intent_payload";
import { queryKeys } from "@/lib/queryKeys";
import { isFreeProModel } from "@/lib/freeProModel";
import { ipc } from "@/ipc/types";
import { mergeResyncMessages } from "@/lib/resyncChat";
import { shouldShowPnpmMinimumReleaseAgeWarning } from "@/lib/schemas";
import { showExtraFilesToast, showWarning } from "@/lib/toast";
import { PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX } from "@/shared/packageManagerWarnings";

type JotaiStore = ReturnType<typeof createStore>;

export type ChatStreamRemoteConnection = RemoteMachineClientConnection & {
  start?: () => () => void;
};

export interface StreamFinishedEvent {
  chatId: number;
  invocationRef: NonNullable<ChatStreamRemoteSnapshot["invocationRef"]>;
  outcome: "completed" | "cancelled" | "errored";
  chatSummary?: string;
}

interface PendingSubmission {
  request: StreamRequest;
  invocationRef: NonNullable<ChatStreamRemoteSnapshot["invocationRef"]>;
  acceptanceDelivered: boolean;
  releaseSubscription: () => void;
}

interface RetainedSubscription {
  consumers: number;
  unsubscribe: () => void;
  bootstrap: Promise<void>;
  bootstrapFailed: boolean;
}

interface RemoteChatRef {
  getSnapshot(): ChatStreamRemoteSnapshot;
  subscribe(listener: () => void): () => void;
  send(event: StreamEvent): void;
}

const IDLE_UNSUBSCRIBE: () => void = () => undefined;

export type QueueMutationWithoutRevision =
  | Omit<
      Extract<ChatStreamIntentEvent, { type: "PAUSE_QUEUE" }>,
      "expectedQueueRevision" | "mutationId"
    >
  | Omit<
      Extract<ChatStreamIntentEvent, { type: "RESUME_QUEUE" }>,
      "expectedQueueRevision" | "mutationId"
    >
  | Omit<
      Extract<ChatStreamIntentEvent, { type: "EDIT_QUEUE_ENTRY" }>,
      "expectedQueueRevision" | "mutationId"
    >
  | Omit<
      Extract<ChatStreamIntentEvent, { type: "REORDER_QUEUE_ENTRY" }>,
      "expectedQueueRevision" | "mutationId"
    >
  | Omit<
      Extract<ChatStreamIntentEvent, { type: "REMOVE_QUEUE_ENTRY" }>,
      "expectedQueueRevision" | "mutationId"
    >
  | Omit<
      Extract<ChatStreamIntentEvent, { type: "CLEAR_QUEUE" }>,
      "expectedQueueRevision" | "mutationId"
    >;

/**
 * Per-window adapter for the main-owned chat protocol.
 *
 * This manager owns no lifecycle or queue authority. It only materializes
 * revisioned remote snapshots, transient streaming previews, and local
 * optimistic receipts for the window that initiated a submission.
 */
export class ChatStreamRemoteManager {
  private readonly client: RemoteMachineClient;
  private readonly subscriptions = new Map<number, RetainedSubscription>();
  private readonly streamFinishedListeners = new Set<
    (event: StreamFinishedEvent) => void
  >();
  private readonly pendingSubmissions = new Map<string, PendingSubmission>();
  private readonly submissionTails = new Map<number, Promise<void>>();
  private readonly snapshotListeners = new Map<number, Set<() => void>>();
  private readonly optimisticSnapshots = new Map<
    number,
    {
      base: ChatStreamRemoteSnapshot;
      intentId: string;
      projected: ChatStreamRemoteSnapshot;
    }
  >();
  private readonly lastAcceptanceByChat = new Map<number, string>();
  private readonly lastCompletionByChat = new Map<number, string>();
  private readonly completionCursorInitialized = new Set<number>();
  private readonly refs = new Map<number, RemoteChatRef>();
  private readonly previews = new ChatStreamPreviewStore();
  private runtimeDeps: Omit<ChatStreamRuntimeDeps, "getIsStreaming"> | null =
    null;
  private stopConnection?: () => void;
  private disposed = false;

  constructor(
    private readonly store: JotaiStore,
    private readonly ids: IdSource = uuidIdSource,
    private readonly connection: ChatStreamRemoteConnection = new IpcRemoteMachineConnection(),
  ) {
    this.client = new RemoteMachineClient(connection, ids);
  }

  start(): void {
    if (this.disposed || this.stopConnection) return;
    this.stopConnection = this.connection.start?.() ?? IDLE_UNSUBSCRIBE;
    this.client.start();
  }

  stop(): void {
    this.client.stop();
    this.stopConnection?.();
    this.stopConnection = undefined;
  }

  registerRuntimeDeps(
    deps: Omit<ChatStreamRuntimeDeps, "getIsStreaming">,
  ): void {
    this.runtimeDeps = deps;
  }

  ensure(chatId: number): RemoteChatRef {
    let ref = this.refs.get(chatId);
    if (ref) return ref;
    const actor = this.actor(chatId);
    ref = {
      getSnapshot: () =>
        this.projectOptimisticAdmission(chatId, actor.getSnapshot()),
      subscribe: (listener) => {
        const release = this.retainSubscription(chatId, actor);
        const listeners = this.snapshotListeners.get(chatId) ?? new Set();
        listeners.add(listener);
        this.snapshotListeners.set(chatId, listeners);
        const unsubscribe = actor.subscribe(listener);
        return () => {
          unsubscribe();
          listeners.delete(listener);
          if (listeners.size === 0) this.snapshotListeners.delete(chatId);
          release();
        };
      },
      send: (event) => this.sendCompatibilityEvent(chatId, event),
    };
    this.refs.set(chatId, ref);
    return ref;
  }

  peek(chatId: number): RemoteChatRef | undefined {
    return this.refs.get(chatId);
  }

  getSnapshot(chatId: number): ChatStreamRemoteSnapshot {
    return this.projectOptimisticAdmission(
      chatId,
      this.actor(chatId).getSnapshot(),
    );
  }

  getIsStreaming(chatId: number): boolean {
    const phase = this.getSnapshot(chatId).phase;
    return (
      phase === "admitting" ||
      phase === "streaming" ||
      phase === "cancelling" ||
      phase === "finalizing"
    );
  }

  isIdle(chatId: number): boolean {
    const phase = this.getSnapshot(chatId).phase;
    return phase === "idle" || phase === "errored";
  }

  watchIdle(chatId: number, callback: () => void): () => void {
    let cancelled = false;
    let unsubscribe = IDLE_UNSUBSCRIBE;
    const deliver = () => {
      if (cancelled || !this.isIdle(chatId)) return;
      cancelled = true;
      unsubscribe();
      queueMicrotask(callback);
    };
    unsubscribe = this.ensure(chatId).subscribe(deliver);
    deliver();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }

  subscribeStreamFinished(
    listener: (event: StreamFinishedEvent) => void,
  ): () => void {
    this.streamFinishedListeners.add(listener);
    return () => this.streamFinishedListeners.delete(listener);
  }

  getPreviewSnapshot = this.previews.getSnapshot;
  subscribePreview = this.previews.subscribeKey;
  setPreview = (chatId: number, content: string): boolean =>
    this.previews.set(chatId, content);

  async dispatchQueueEvent(
    chatId: number,
    event: QueueMutationWithoutRevision,
    expectedQueueRevision?: number,
  ): Promise<void> {
    const actor = this.actor(chatId);
    // Preserve the revision that produced the mutation. Resync is only for
    // transport freshness; it must not silently rebase stale renderer intent.
    const mutationQueueRevision =
      expectedQueueRevision ?? actor.getSnapshot().queueRevision;
    const release = this.retainSubscription(chatId, actor);
    let releaseSettlement = IDLE_UNSUBSCRIBE;
    try {
      await actor.resync();
      const mutationId = this.ids.next("chat-queue");
      const settlement = new Promise<
        NonNullable<ChatStreamRemoteSnapshot["lastQueueMutation"]>
      >((resolve) => {
        const inspect = () => {
          const result = actor.getSnapshot().lastQueueMutation;
          if (result?.mutationId !== mutationId) return;
          releaseSettlement();
          resolve(result);
        };
        releaseSettlement = actor.subscribe(inspect);
        inspect();
      });
      const receipt = await actor.dispatch({
        ...event,
        mutationId,
        expectedQueueRevision: mutationQueueRevision,
      } as ChatStreamIntentEvent);
      if (receipt.kind === "rejected") {
        throw new Error(`Chat queue request rejected: ${receipt.reason}`);
      }
      if (receipt.kind === "ignored") {
        await actor.resync();
        throw new Error("Chat queue changed in another window");
      }
      const result = await settlement;
      if (result.outcome === "rejected") {
        throw new Error(result.error ?? "Chat queue mutation was rejected");
      }
    } finally {
      releaseSettlement();
      release();
    }
  }

  disposeKey = (chatId: number): void => {
    this.subscriptions.get(chatId)?.unsubscribe();
    this.subscriptions.delete(chatId);
    this.refs.delete(chatId);
    this.snapshotListeners.delete(chatId);
    this.optimisticSnapshots.delete(chatId);
    this.lastAcceptanceByChat.delete(chatId);
    this.lastCompletionByChat.delete(chatId);
    this.completionCursorInitialized.delete(chatId);
    for (const [intentId, pending] of this.pendingSubmissions) {
      if (pending.request.chatId === chatId)
        this.takePendingSubmission(intentId);
    }
    this.submissionTails.delete(chatId);
    this.previews.disposeKey(chatId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const subscription of this.subscriptions.values()) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();
    this.refs.clear();
    this.snapshotListeners.clear();
    this.optimisticSnapshots.clear();
    this.lastAcceptanceByChat.clear();
    this.lastCompletionByChat.clear();
    this.completionCursorInitialized.clear();
    for (const pending of this.pendingSubmissions.values()) {
      pending.releaseSubscription();
    }
    this.pendingSubmissions.clear();
    this.submissionTails.clear();
    this.streamFinishedListeners.clear();
    this.previews.dispose();
    this.client.dispose();
  }

  private actor(chatId: number) {
    return this.client.actor(chatStreamClientDefinition, chatStreamKey(chatId));
  }

  private sendCompatibilityEvent(chatId: number, event: StreamEvent): void {
    switch (event.type) {
      case "submit":
        this.submit(event.request);
        return;
      case "cancel": {
        const invocationRef = this.getSnapshot(chatId).invocationRef;
        if (!invocationRef) return;
        this.dispatchCompatibilityCommand(
          chatId,
          { type: "CANCEL", invocationRef },
          "cancel the chat",
        );
        return;
      }
      case "external-error":
        this.dispatchCompatibilityCommand(
          chatId,
          { type: "REPORT_ERROR", error: event.error },
          "report the chat error",
        );
        return;
    }
  }

  private dispatchCompatibilityCommand(
    chatId: number,
    event: ChatStreamIntentEvent,
    action: string,
  ): void {
    void this.actor(chatId)
      .dispatch(event)
      .then((receipt) => {
        if (receipt.kind !== "applied") {
          throw new Error(`Remote command was ${receipt.kind}`);
        }
      })
      .catch((error) => this.reportCompatibilityDispatchFailure(action, error));
  }

  private reportCompatibilityDispatchFailure(
    action: string,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[chat-stream] Failed to ${action}`, error);
    showWarning(`Failed to ${action}: ${message}`);
  }

  private submit(request: StreamRequest): void {
    this.start();
    const actor = this.actor(request.chatId);
    const release = this.retainSubscription(request.chatId, actor);
    const intentId =
      request.owner?.kind === "user-input-follow-up"
        ? request.owner.requestId
        : this.ids.next("chat-turn");
    const invocationRef = {
      kind: CHAT_STREAM_INVOCATION_KIND,
      entityKey: request.chatId,
      operationId: this.ids.next("chat-stream"),
    } as const;
    this.pendingSubmissions.set(intentId, {
      request,
      invocationRef,
      acceptanceDelivered: false,
      releaseSubscription: release,
    });
    this.notifySnapshotListeners(request.chatId);
    const previous = this.submissionTails.get(request.chatId);
    const submission = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() =>
        this.prepareAndDispatchSubmission(
          request,
          actor,
          intentId,
          invocationRef,
        ),
      );
    this.submissionTails.set(request.chatId, submission);
    void submission.finally(() => {
      if (this.submissionTails.get(request.chatId) === submission) {
        this.submissionTails.delete(request.chatId);
      }
    });
  }

  private async prepareAndDispatchSubmission(
    request: StreamRequest,
    actor: ReturnType<ChatStreamRemoteManager["actor"]>,
    intentId: string,
    invocationRef: NonNullable<ChatStreamRemoteSnapshot["invocationRef"]>,
  ): Promise<void> {
    try {
      if (this.disposed || !this.pendingSubmissions.has(intentId)) return;
      await this.subscriptions.get(request.chatId)?.bootstrap;
      if (this.disposed || !this.pendingSubmissions.has(intentId)) return;
      const attachments =
        request.attachments && request.attachments.length > 0
          ? await convertFileAttachmentsToChatAttachments(request.attachments)
          : undefined;
      const withoutHash = {
        schemaVersion: 1 as const,
        intentId,
        chatId: request.chatId,
        invocationRef,
        prompt: request.prompt,
        redo: request.redo,
        attachments,
        selectedComponents: request.selectedComponents ?? [],
        requestedChatMode: request.requestedChatMode,
        userInputRequestId: request.owner?.requestId,
        planAcceptInNewChat: request.planAcceptInNewChat,
        owner: request.owner,
      };
      const intent: SerializableChatTurnIntent = {
        ...withoutHash,
        payloadHash: await sha256Hex(
          serializeImmutableChatTurnPayload(withoutHash),
        ),
      };
      if (this.disposed || !this.pendingSubmissions.has(intentId)) return;
      const receipt = await actor.dispatch({ type: "SUBMIT", intent });
      if (receipt.kind === "rejected") {
        throw new Error(`Chat submission rejected: ${receipt.reason}`);
      }
    } catch (error) {
      const pending = this.takePendingSubmission(intentId);
      if (!pending) return;
      this.notifySnapshotListeners(request.chatId);
      pending.request.onAcceptanceError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      pending.request.onSettled?.({ success: false });
    }
  }

  private takePendingSubmission(
    intentId: string,
  ): PendingSubmission | undefined {
    const pending = this.pendingSubmissions.get(intentId);
    if (!pending) return undefined;
    this.pendingSubmissions.delete(intentId);
    pending.releaseSubscription();
    return pending;
  }

  private retainSubscription(
    chatId: number,
    actor: ReturnType<ChatStreamRemoteManager["actor"]>,
  ): () => void {
    this.start();
    const existing = this.subscriptions.get(chatId);
    if (existing) {
      existing.consumers += 1;
      if (existing.bootstrapFailed) {
        this.refreshBootstrap(existing, actor);
      }
      return this.releaseSubscription(chatId, existing);
    }
    const unsubscribe = actor.subscribe(() =>
      this.handleSnapshot(chatId, actor.getSnapshot()),
    );
    const subscription: RetainedSubscription = {
      consumers: 1,
      unsubscribe,
      bootstrap: Promise.resolve(),
      bootstrapFailed: false,
    };
    this.refreshBootstrap(subscription, actor);
    this.subscriptions.set(chatId, subscription);
    return this.releaseSubscription(chatId, subscription);
  }

  private refreshBootstrap(
    subscription: RetainedSubscription,
    actor: ReturnType<ChatStreamRemoteManager["actor"]>,
  ): void {
    const bootstrap = actor.resync();
    subscription.bootstrap = bootstrap;
    subscription.bootstrapFailed = false;
    void bootstrap.catch((error) => {
      if (subscription.bootstrap === bootstrap) {
        subscription.bootstrapFailed = true;
      }
      console.error("[chat-stream] Remote bootstrap failed", error);
    });
  }

  private releaseSubscription(
    chatId: number,
    subscription: RetainedSubscription,
  ): () => void {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.subscriptions.get(chatId) !== subscription) return;
      subscription.consumers -= 1;
      if (subscription.consumers > 0) return;
      queueMicrotask(() => {
        if (
          this.subscriptions.get(chatId) !== subscription ||
          subscription.consumers > 0
        ) {
          return;
        }
        subscription.unsubscribe();
        this.subscriptions.delete(chatId);
      });
    };
  }

  private handleSnapshot(
    chatId: number,
    snapshot: ChatStreamRemoteSnapshot,
  ): void {
    const acceptance = snapshot.lastAcceptance;
    if (
      acceptance &&
      this.lastAcceptanceByChat.get(chatId) !== acceptance.intentId
    ) {
      this.lastAcceptanceByChat.set(chatId, acceptance.intentId);
      const pending = this.pendingSubmissions.get(acceptance.intentId);
      if (pending) {
        pending.acceptanceDelivered = true;
        if (
          acceptance.acceptance === "message-accepted" ||
          acceptance.acceptance === "replayed"
        ) {
          pending.request.onAccepted?.();
          const replayedCompletion = snapshot.lastCompletion;
          if (
            acceptance.acceptance === "message-accepted" &&
            replayedCompletion?.intentId === acceptance.intentId &&
            this.lastCompletionByChat.get(chatId) === acceptance.intentId
          ) {
            pending.request.onSettled?.({
              success: replayedCompletion.outcome === "completed",
              pausedByStepLimit: replayedCompletion.pausePromptQueue,
            });
            this.takePendingSubmission(acceptance.intentId);
          }
        } else if (acceptance.acceptance === "queued") {
          pending.request.onSettled?.({ success: false, queued: true });
          this.takePendingSubmission(acceptance.intentId);
        } else {
          pending.request.onAcceptanceRejected?.(
            acceptance.error ?? "Chat submission rejected",
          );
          pending.request.onSettled?.({ success: false });
          this.takePendingSubmission(acceptance.intentId);
        }
      }
    }
    const completion = snapshot.lastCompletion;
    if (!this.completionCursorInitialized.has(chatId)) {
      this.completionCursorInitialized.add(chatId);
      if (completion && !this.pendingSubmissions.has(completion.intentId)) {
        this.lastCompletionByChat.set(chatId, completion.intentId);
        return;
      }
    }
    if (
      !completion ||
      this.lastCompletionByChat.get(chatId) === completion.intentId
    ) {
      return;
    }
    this.lastCompletionByChat.set(chatId, completion.intentId);
    this.previews.disposeKey(chatId);
    const pending = this.takePendingSubmission(completion.intentId);
    const targetAppId = completion.targetAppId;
    if (pending) {
      const result: StreamSettledResult = {
        success: completion.outcome === "completed",
        pausedByStepLimit: completion.pausePromptQueue,
      };
      pending.request.onSettled?.(result);
    }
    this.runtimeDeps?.queryClient.invalidateQueries({
      queryKey: queryKeys.chats.all,
    });
    this.runtimeDeps?.queryClient.invalidateQueries({
      queryKey: queryKeys.proposals.detail({ chatId }),
    });
    this.runtimeDeps?.queryClient.invalidateQueries({
      queryKey: queryKeys.tokenCount.all,
    });
    this.runtimeDeps?.queryClient.invalidateQueries({
      queryKey: queryKeys.userBudget.info,
    });
    this.runtimeDeps?.queryClient.invalidateQueries({
      queryKey: queryKeys.freeAgentQuota.status,
    });
    const settings = this.runtimeDeps?.getSettings();
    if (isFreeProModel(settings?.selectedModel)) {
      this.runtimeDeps?.queryClient.invalidateQueries({
        queryKey: queryKeys.freeModelQuota.status,
      });
    }
    if (targetAppId !== null) {
      this.runtimeDeps?.queryClient.invalidateQueries({
        queryKey: queryKeys.apps.detail({ appId: targetAppId }),
      });
      this.runtimeDeps?.queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId: targetAppId }),
      });
      this.runtimeDeps?.queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId: targetAppId }),
      });
    }
    for (const warningMessage of completion.warningMessages ?? []) {
      if (warningMessage.startsWith(PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX)) {
        if (
          !shouldShowPnpmMinimumReleaseAgeWarning(
            this.runtimeDeps?.getSettings(),
          )
        ) {
          continue;
        }
        if (targetAppId !== null) {
          this.runtimeDeps?.setPackageManagerWarning?.(targetAppId, {
            kind: "release-age",
            message: warningMessage,
          });
          continue;
        }
      }
      showWarning(warningMessage);
    }
    if (completion.extraFiles) {
      const posthog = this.runtimeDeps?.getPosthog();
      if (posthog) {
        showExtraFilesToast({
          files: completion.extraFiles,
          error: completion.extraFilesError,
          posthog,
        });
      }
    }
    if (this.runtimeDeps) {
      const completedInvocation = completion.invocationRef.operationId;
      void ipc.chat
        .getChat(chatId)
        .then((latestChat) => {
          const currentSnapshot = this.getSnapshot(chatId);
          if (
            (currentSnapshot.invocationRef?.operationId !== undefined &&
              currentSnapshot.invocationRef.operationId !==
                completedInvocation) ||
            (currentSnapshot.lastCompletion !== null &&
              currentSnapshot.lastCompletion.invocationRef.operationId !==
                completedInvocation)
          ) {
            return;
          }
          this.runtimeDeps?.queryClient.setQueryData(
            queryKeys.chats.detail({ chatId }),
            latestChat,
          );
          this.store.set(chatMessagesByIdAtom, (previous) => {
            const currentMessages = previous.get(chatId);
            if (
              currentMessages &&
              currentMessages.length > latestChat.messages.length
            ) {
              return previous;
            }
            const next = new Map(previous);
            next.set(
              chatId,
              currentMessages
                ? mergeResyncMessages(latestChat.messages, currentMessages)
                : latestChat.messages,
            );
            return next;
          });
        })
        .catch((error) => {
          console.error(
            "[chat-stream] Failed to refresh completed chat",
            error,
          );
        });
    }
    if (completion.updatedFiles && snapshot.chatId > 0) {
      if (settings?.autoExpandPreviewPanel) {
        // Permanent UI-side-effect keep: plans/claude-cleanup-machines.md.
        this.store.set(isPreviewOpenAtom, true);
      }
      if (targetAppId !== null) {
        this.runtimeDeps?.requestPreviewReload(targetAppId);
        this.runtimeDeps?.requestCapture(targetAppId, "stream");
      }
    }
    for (const listener of this.streamFinishedListeners) {
      listener({
        chatId,
        invocationRef: completion.invocationRef,
        outcome: completion.outcome,
        chatSummary: completion.chatSummary,
      });
    }
  }

  private projectOptimisticAdmission(
    chatId: number,
    snapshot: ChatStreamRemoteSnapshot,
  ): ChatStreamRemoteSnapshot {
    if (snapshot.phase !== "idle" && snapshot.phase !== "errored") {
      return snapshot;
    }
    const pendingEntry = [...this.pendingSubmissions.entries()].find(
      ([, submission]) =>
        submission.request.chatId === chatId && !submission.acceptanceDelivered,
    );
    if (!pendingEntry) {
      this.optimisticSnapshots.delete(chatId);
      return snapshot;
    }
    const [intentId, pending] = pendingEntry;
    const cached = this.optimisticSnapshots.get(chatId);
    if (cached?.base === snapshot && cached.intentId === intentId) {
      return cached.projected;
    }
    const projected: ChatStreamRemoteSnapshot = {
      ...snapshot,
      phase: "admitting",
      invocationRef: pending.invocationRef,
      error: null,
      capabilities: {
        ...snapshot.capabilities,
        canCancel: false,
      },
    };
    this.optimisticSnapshots.set(chatId, {
      base: snapshot,
      intentId,
      projected,
    });
    return projected;
  }

  private notifySnapshotListeners(chatId: number): void {
    for (const listener of this.snapshotListeners.get(chatId) ?? []) {
      listener();
    }
  }
}

export const NO_CHAT_STREAM_REMOTE_SNAPSHOT = unavailableChatStreamSnapshot(1);
