import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import { ActorHost } from "@/distributed_machines/actor_host";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import { RemoteMachineTransport } from "@/distributed_machines/remote_transport";
import { FakeDuplexRemoteTransport } from "@/distributed_machines/testing";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import {
  cancelActiveStreamsForChat,
  type ChatStreamExecutionObserver,
} from "@/ipc/handlers/chat_stream_handlers";
import {
  beginChatActorDeletion,
  assertChatActorAdmissionOpen,
} from "@/ipc/services/chat_actor_deletion_fence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { ChatExecutionOutcome } from "@/ipc/services/chat_execution_types";
import { chatStreamDefinition } from "./definition";
import { initialChatStreamHostState } from "./host_transition";
import { markIntentTerminal } from "./persistence";
import { ChatStreamRemoteManager } from "./remote_manager";
import {
  chatStreamClientDefinition,
  chatStreamKey,
  type ChatQueueEntry,
  type SerializableChatTurnIntent,
} from "./transport";

const execution = vi.hoisted(() => ({
  observers: new Map<string, ChatStreamExecutionObserver>(),
  pendingCancellations: new Set<string>(),
  admissions: [] as string[],
  replayedQueuedIntentIds: new Set<string>(),
  claimFailures: 0,
  claimAttempts: 0,
  afterClaim: null as (() => Promise<void>) | null,
  claimedEntries: new Map<string, ChatQueueEntry>(),
  convertAttachments: vi.fn(async () => []),
}));
const review = vi.hoisted(() => ({
  runAutoReviewBarrier: vi.fn(),
  skipReviewAutoFix: vi.fn(),
}));

vi.mock(
  "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager",
  () => review,
);

vi.mock("@/lib/chatAttachmentConversion", () => ({
  convertFileAttachmentsToChatAttachments: execution.convertAttachments,
}));

const persisted = vi.hoisted(() => ({
  revision: 0,
  paused: false,
  pauseReason: null as "stop" | "manual" | "step-limit" | null,
  entries: [] as ChatQueueEntry[],
  intents: new Map<string, SerializableChatTurnIntent>(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => ({ id: 7, appId: 3 }),
        }),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  chats: { id: "id", appId: "appId" },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));

vi.mock("@/ipc/handlers/chat_stream_handlers", () => ({
  cancelActiveStreamsForChat: vi.fn(
    async (
      _chatId: number,
      _sender: unknown,
      invocationRef?: { operationId: string },
    ) => {
      const registered = [...execution.observers.values()].some(
        (observer) =>
          observer.intent.invocationRef?.operationId ===
          invocationRef?.operationId,
      );
      if (invocationRef && !registered) {
        execution.pendingCancellations.add(invocationRef.operationId);
      }
      return true;
    },
  ),
  clearPendingActorStreamCancellation: vi.fn(
    (invocationRef: { operationId: string }) => {
      execution.pendingCancellations.delete(invocationRef.operationId);
    },
  ),
  executeChatStreamFromActor: vi.fn(
    async (
      _sender: unknown,
      request: {
        chatId: number;
        intentId?: string;
        invocationRef?: { operationId: string };
      },
      observer: ChatStreamExecutionObserver,
    ): Promise<ChatExecutionOutcome> => {
      if (
        request.invocationRef &&
        execution.pendingCancellations.delete(request.invocationRef.operationId)
      ) {
        observer.onEnd?.({
          chatId: request.chatId,
          updatedFiles: false,
          wasCancelled: true,
        });
        return { kind: "cancelled" };
      }
      const intentId = observer.intent.intentId;
      return new Promise((resolve) => {
        execution.observers.set(intentId, {
          ...observer,
          onEnd: (response) => {
            observer.onEnd?.(response);
            resolve(
              response.wasCancelled
                ? { kind: "cancelled" }
                : { kind: "completed", response },
            );
          },
          onError: (error) => {
            observer.onError?.(error);
            resolve({ kind: "failed", error });
          },
        });
        observer.onAccepted?.(11);
      });
    },
  ),
}));

vi.mock("./persistence", () => ({
  loadChatQueue: vi.fn(() => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queuePauseReason: persisted.pauseReason,
    queue: [...persisted.entries],
  })),
  hydrateChatStreamPersistence: vi.fn(() => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queuePauseReason: persisted.pauseReason,
    queue: [...persisted.entries],
  })),
  stageActiveIntent: vi.fn(
    (_database: unknown, intent: SerializableChatTurnIntent) => {
      if (execution.replayedQueuedIntentIds.has(intent.intentId)) {
        return {
          kind: "replayed" as const,
          acceptance: "queued" as const,
        };
      }
      if (
        persisted.intents.has(intent.intentId) &&
        persisted.entries.some((entry) => entry.intentId === intent.intentId)
      ) {
        return {
          kind: "replayed" as const,
          acceptance: "queued" as const,
        };
      }
      execution.admissions.push(intent.prompt);
      persisted.intents.set(intent.intentId, intent);
      return null;
    },
  ),
  isSessionQueuedIntent: vi.fn(() => false),
  completeSessionQueueAcceptance: vi.fn(),
  disposeSessionChatQueue: vi.fn(),
  persistSessionQueuedIntent: vi.fn(),
  persistQueuedIntent: vi.fn(
    (
      _database: unknown,
      intent: SerializableChatTurnIntent,
      options?: { resumeQueue?: boolean },
    ) => {
      if (persisted.intents.has(intent.intentId)) {
        let queue:
          | {
              queueRevision: number;
              queuePaused: boolean;
              queue: ChatQueueEntry[];
            }
          | undefined;
        if (options?.resumeQueue) {
          if (persisted.paused) persisted.revision += 1;
          persisted.paused = false;
          persisted.pauseReason = null;
          queue = {
            queueRevision: persisted.revision,
            queuePaused: persisted.paused,
            queue: [...persisted.entries],
          };
        }
        return {
          kind: "replayed" as const,
          acceptance: "queued" as const,
          queue,
        };
      }
      execution.admissions.push(intent.prompt);
      const entry: ChatQueueEntry = {
        itemId: intent.intentId,
        intentId: intent.intentId,
        prompt: intent.prompt,
        persistence: "main-session",
        editable: true,
        removable: true,
      };
      persisted.intents.set(intent.intentId, intent);
      persisted.entries.push(entry);
      persisted.revision += 1;
      if (options?.resumeQueue) {
        persisted.paused = false;
        persisted.pauseReason = null;
      }
      return {
        kind: "queued" as const,
        entry,
        queueRevision: persisted.revision,
        queuePaused: persisted.paused,
      };
    },
  ),
  mutateChatQueue: vi.fn(
    async (
      _database: unknown,
      _chatId: number,
      command: { mutation: { type: string } },
    ) => {
      persisted.paused = command.mutation.type === "pause";
      persisted.pauseReason = persisted.paused ? "manual" : null;
      persisted.revision += 1;
      return {
        queueRevision: persisted.revision,
        queuePaused: persisted.paused,
        queue: [...persisted.entries],
      };
    },
  ),
  parkChatQueue: vi.fn(async () => {
    persisted.paused = true;
    persisted.pauseReason = "stop";
    persisted.revision += 1;
    return {
      queueRevision: persisted.revision,
      queuePaused: persisted.paused,
      queue: [...persisted.entries],
    };
  }),
  markIntentTerminal: vi.fn(() => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queue: [...persisted.entries],
  })),
  claimQueueHead: vi.fn(async () => {
    execution.claimAttempts += 1;
    if (execution.claimFailures > 0) {
      execution.claimFailures -= 1;
      throw new Error("temporary queue database failure");
    }
    if (persisted.paused) return null;
    const entry = persisted.entries.shift();
    if (!entry) return null;
    const intent = persisted.intents.get(entry.intentId);
    if (!intent) return null;
    persisted.revision += 1;
    execution.claimedEntries.set(entry.intentId, entry);
    await execution.afterClaim?.();
    return {
      intent,
      queue: {
        queueRevision: persisted.revision,
        queuePaused: persisted.paused,
        queue: [...persisted.entries],
      },
    };
  }),
  restoreClaimedQueueHead: vi.fn(async () => {
    const [intentId, entry] =
      execution.claimedEntries.entries().next().value ?? [];
    if (intentId && entry) {
      execution.claimedEntries.delete(intentId);
      persisted.entries.unshift(entry);
      persisted.revision += 1;
    }
    return {
      queueRevision: persisted.revision,
      queuePaused: persisted.paused,
      queue: [...persisted.entries],
    };
  }),
}));

function turn(intentId: string): SerializableChatTurnIntent {
  return {
    schemaVersion: 1,
    intentId,
    payloadHash: "a".repeat(64),
    chatId: 7,
    appId: 3,
    invocationRef: {
      kind: "chat-stream",
      entityKey: 7,
      operationId: `operation-${intentId}`,
    },
    prompt: intentId,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("main-hosted chat stream actor", () => {
  beforeEach(() => {
    execution.observers.clear();
    execution.pendingCancellations.clear();
    execution.admissions = [];
    execution.replayedQueuedIntentIds.clear();
    execution.claimFailures = 0;
    execution.claimAttempts = 0;
    execution.afterClaim = null;
    execution.claimedEntries.clear();
    execution.convertAttachments.mockReset();
    execution.convertAttachments.mockResolvedValue([]);
    review.runAutoReviewBarrier.mockReset();
    review.runAutoReviewBarrier.mockResolvedValue({ outcome: "released" });
    review.skipReviewAutoFix.mockReset();
    review.skipReviewAutoFix.mockResolvedValue(undefined);
    persisted.revision = 0;
    persisted.paused = false;
    persisted.pauseReason = null;
    persisted.entries = [];
    persisted.intents.clear();
  });

  it("keeps a replayed durable intent in its recovered paused queue", async () => {
    const queued = turn("queued");
    persisted.paused = true;
    persisted.revision = 2;
    persisted.intents.set(queued.intentId, queued);
    persisted.entries = [
      {
        itemId: queued.intentId,
        intentId: queued.intentId,
        prompt: queued.prompt,
        persistence: "durable",
        editable: true,
        removable: true,
      },
    ];
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(chatStreamClientDefinition, chatStreamKey(7));
    const release = actor.subscribe(() => undefined);
    await actor.resync();

    await actor.dispatch({ type: "SUBMIT", intent: queued });
    await flush();

    expect(actor.getSnapshot()).toMatchObject({
      phase: "idle",
      queuePaused: true,
      queue: [{ intentId: "queued" }],
    });
    expect(execution.observers.has("queued")).toBe(false);

    release();
    client.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("resumes a recovered Stop-parked queue FIFO on the next send", async () => {
    const queued = turn("queued-before-restart");
    persisted.paused = true;
    persisted.pauseReason = "stop";
    persisted.revision = 2;
    persisted.intents.set(queued.intentId, queued);
    persisted.entries = [
      {
        itemId: queued.intentId,
        intentId: queued.intentId,
        prompt: queued.prompt,
        persistence: "durable",
        editable: true,
        removable: true,
      },
    ];
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(chatStreamClientDefinition, chatStreamKey(7));
    const release = actor.subscribe(() => undefined);
    await actor.resync();

    await actor.dispatch({
      type: "SUBMIT",
      intent: turn("sent-after-restart"),
      observedStopPolicyVersion: 0,
    });
    await flush();

    expect(actor.getSnapshot()).toMatchObject({
      phase: "streaming",
      queuePaused: false,
      queue: [{ intentId: "sent-after-restart" }],
    });
    expect(execution.observers.has("queued-before-restart")).toBe(true);
    expect(execution.observers.has("sent-after-restart")).toBe(false);

    release();
    client.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("retries a transient durable queue claim failure", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(chatStreamClientDefinition, chatStreamKey(7));
    const release = actor.subscribe(() => undefined);
    await actor.resync();

    await actor.dispatch({ type: "SUBMIT", intent: turn("first") });
    await flush();
    await actor.dispatch({ type: "SUBMIT", intent: turn("second") });
    await flush();
    execution.claimFailures = 1;
    execution.observers.get("first")?.onEnd?.({
      chatId: 7,
      invocationRef: turn("first").invocationRef,
      updatedFiles: false,
    });

    await vi.waitFor(() =>
      expect(execution.observers.has("second")).toBe(true),
    );
    expect(execution.claimAttempts).toBe(2);
    expect(actor.getSnapshot()).toMatchObject({
      phase: "streaming",
      queue: [],
    });

    release();
    client.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("restores a claimed queue head when the queue is parked before dispatch", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(chatStreamClientDefinition, chatStreamKey(7));
    const release = actor.subscribe(() => undefined);
    await actor.resync();

    await actor.dispatch({ type: "SUBMIT", intent: turn("first") });
    await flush();
    await actor.dispatch({ type: "SUBMIT", intent: turn("second") });
    await flush();
    execution.afterClaim = async () => {
      execution.afterClaim = null;
      await actor.dispatch({
        type: "PAUSE_QUEUE",
        expectedQueueRevision: actor.getSnapshot().queueRevision,
        mutationId: "park-after-claim",
      });
      await vi.waitFor(() =>
        expect(actor.getSnapshot().queuePaused).toBe(true),
      );
    };

    execution.observers.get("first")?.onEnd?.({
      chatId: 7,
      invocationRef: turn("first").invocationRef,
      updatedFiles: false,
    });

    await vi.waitFor(() =>
      expect(actor.getSnapshot()).toMatchObject({
        phase: "idle",
        queuePaused: true,
        queue: [{ intentId: "second" }],
      }),
    );
    expect(execution.observers.has("second")).toBe(false);

    release();
    client.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("shares lifecycle and queue authority across reload and two windows", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const connectionA = duplex.connect();
    const connectionB = duplex.connect();
    const clientA = new RemoteMachineClient(
      connectionA,
      createSequentialIdSource(),
    );
    const clientB = new RemoteMachineClient(
      connectionB,
      createSequentialIdSource(),
    );
    clientA.start();
    clientB.start();
    const actorA = clientA.actor(chatStreamClientDefinition, chatStreamKey(7));
    const actorB = clientB.actor(chatStreamClientDefinition, chatStreamKey(7));
    const releaseA = actorA.subscribe(() => undefined);
    const releaseB = actorB.subscribe(() => undefined);
    await actorA.resync();
    await actorB.resync();

    await actorA.dispatch({ type: "SUBMIT", intent: turn("first") });
    await flush();
    expect(actorB.getSnapshot()).toMatchObject({
      phase: "streaming",
      invocationRef: { operationId: "operation-first" },
      lastAcceptance: {
        intentId: "first",
        acceptance: "message-accepted",
      },
    });

    await actorB.dispatch({ type: "SUBMIT", intent: turn("second") });
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "streaming",
      queueRevision: 1,
      queue: [{ intentId: "second" }],
    });

    const pause = await actorB.dispatch({
      type: "PAUSE_QUEUE",
      mutationId: "pause-from-b",
      expectedQueueRevision: 1,
    });
    expect(pause.kind).toBe("applied");
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      queuePaused: true,
      queueRevision: 2,
      lastQueueMutation: {
        mutationId: "pause-from-b",
        outcome: "applied",
      },
    });

    releaseA();
    connectionA.disconnect();
    const replacement = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    replacement.start();
    const reloaded = replacement.actor(
      chatStreamClientDefinition,
      chatStreamKey(7),
    );
    const releaseReloaded = reloaded.subscribe(() => undefined);
    await reloaded.resync();
    expect(reloaded.getSnapshot()).toMatchObject({
      phase: "streaming",
      queue: [{ intentId: "second" }],
    });

    execution.observers.get("first")?.onEnd?.({
      chatId: 7,
      invocationRef: turn("first").invocationRef,
      updatedFiles: false,
    });
    await flush();
    expect(actorB.getSnapshot()).toMatchObject({
      phase: "idle",
      lastCompletion: { intentId: "first", outcome: "completed" },
    });

    releaseReloaded();
    releaseB();
    replacement.dispose();
    clientA.dispose();
    clientB.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("projects admission immediately while the main actor accepts a submission", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    const actor = manager.ensure(7);
    const release = actor.subscribe(() => undefined);
    await flush();

    actor.send({
      type: "submit",
      request: { chatId: 7, appId: 3, prompt: "continue" },
    });

    expect(actor.getSnapshot()).toMatchObject({
      phase: "admitting",
      capabilities: { canCancel: false },
    });

    release();
    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("stops a renderer-only optimistic admission and parks the queue", async () => {
    let releaseAttachment!: () => void;
    const attachmentGate = new Promise<void>((resolve) => {
      releaseAttachment = resolve;
    });
    execution.convertAttachments.mockImplementationOnce(async () => {
      await attachmentGate;
      return [];
    });
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    const onSettled = vi.fn();
    manager.start();
    const actor = manager.ensure(7);
    const release = actor.subscribe(() => undefined);
    await flush();

    actor.send({
      type: "submit",
      request: {
        chatId: 7,
        prompt: "cancel before serialization",
        attachments: [{ file: {} as File, type: "chat-context" }],
        onSettled,
      },
    });
    expect(actor.getSnapshot()).toMatchObject({
      phase: "admitting",
      capabilities: { canCancel: false },
    });

    actor.send({ type: "cancel" });

    await vi.waitFor(() => expect(persisted.paused).toBe(true));
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ success: false });
    expect(actor.getSnapshot().phase).toBe("idle");
    releaseAttachment();
    await flush();
    expect(execution.admissions).toEqual([]);

    release();
    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("parks pre-Stop tails and resumes them FIFO on a later Send", async () => {
    let releaseAttachment!: () => void;
    const attachmentGate = new Promise<void>((resolve) => {
      releaseAttachment = resolve;
    });
    execution.convertAttachments.mockImplementationOnce(async () => {
      await attachmentGate;
      return [];
    });
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    const actor = manager.ensure(7);
    const release = actor.subscribe(() => undefined);
    await flush();

    actor.send({
      type: "submit",
      request: { chatId: 7, prompt: "active before Stop" },
    });
    await vi.waitFor(() =>
      expect(
        [...execution.observers.values()].some(
          (observer) => observer.intent.prompt === "active before Stop",
        ),
      ).toBe(true),
    );
    actor.send({
      type: "submit",
      request: {
        chatId: 7,
        prompt: "keep this queued",
        attachments: [{ file: {} as File, type: "chat-context" }],
      },
    });
    actor.send({ type: "cancel" });

    await vi.waitFor(() => expect(persisted.paused).toBe(true));
    releaseAttachment();
    await vi.waitFor(() =>
      expect(persisted.entries).toEqual([
        expect.objectContaining({ prompt: "keep this queued" }),
      ]),
    );
    expect(
      [...execution.observers.values()].map(
        (observer) => observer.intent.prompt,
      ),
    ).not.toContain("keep this queued");
    expect(actor.getSnapshot()).toMatchObject({
      phase: "idle",
      queuePaused: true,
      queue: [expect.objectContaining({ prompt: "keep this queued" })],
    });

    actor.send({
      type: "submit",
      request: { chatId: 7, prompt: "send after Stop" },
    });

    await vi.waitFor(() =>
      expect(
        [...execution.observers.values()].map(
          (observer) => observer.intent.prompt,
        ),
      ).toContain("keep this queued"),
    );
    expect(
      [...execution.observers.values()].map(
        (observer) => observer.intent.prompt,
      ),
    ).not.toContain("send after Stop");
    expect(persisted.paused).toBe(false);
    expect(persisted.entries).toEqual([
      expect.objectContaining({ prompt: "send after Stop" }),
    ]);
    expect(actor.getSnapshot()).toMatchObject({
      phase: "streaming",
      queuePaused: false,
      queue: [expect.objectContaining({ prompt: "send after Stop" })],
    });

    release();
    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("keeps delayed cross-window submissions behind the authoritative Stop cutoff", async () => {
    let releaseAttachment!: () => void;
    const attachmentGate = new Promise<void>((resolve) => {
      releaseAttachment = resolve;
    });
    execution.convertAttachments.mockImplementationOnce(async () => {
      await attachmentGate;
      return [];
    });
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const [windowA, windowB] = windows.createPair();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const managerA = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(windowA),
    );
    const managerB = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(1_000),
      duplex.connect(windowB),
    );
    managerA.start();
    managerB.start();
    const actorA = managerA.ensure(7);
    const actorB = managerB.ensure(7);
    const releaseA = actorA.subscribe(() => undefined);
    const releaseB = actorB.subscribe(() => undefined);
    await flush();

    actorA.send({
      type: "submit",
      request: { chatId: 7, prompt: "active in window A" },
    });
    await vi.waitFor(() =>
      expect(
        [...execution.observers.values()].some(
          (observer) => observer.intent.prompt === "active in window A",
        ),
      ).toBe(true),
    );

    actorB.send({
      type: "submit",
      request: {
        chatId: 7,
        prompt: "serializing in window B",
        attachments: [{ file: {} as File, type: "chat-context" }],
      },
    });
    actorA.send({ type: "cancel" });
    expect(actorB.getSnapshot().stopPolicyVersion).toBe(0);
    actorB.send({
      type: "submit",
      request: { chatId: 7, prompt: "submitted just after Stop" },
    });

    await vi.waitFor(() => expect(persisted.paused).toBe(true));
    await vi.waitFor(() =>
      expect(actorB.getSnapshot().stopPolicyVersion).toBe(1),
    );
    releaseAttachment();
    await vi.waitFor(() =>
      expect(persisted.entries.map((entry) => entry.prompt)).toEqual([
        "serializing in window B",
        "submitted just after Stop",
      ]),
    );
    const observedPrompts = [...execution.observers.values()].map(
      (observer) => observer.intent.prompt,
    );
    expect(observedPrompts).not.toContain("serializing in window B");
    expect(observedPrompts).not.toContain("submitted just after Stop");
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "idle",
      queuePaused: true,
      stopPolicyVersion: 1,
    });

    releaseA();
    releaseB();
    managerA.dispose();
    managerB.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("bootstraps actor interest before dispatching a first submission", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    const acceptanceError = vi.fn();

    manager.start();
    manager.ensure(7).send({
      type: "submit",
      request: {
        chatId: 7,
        appId: 3,
        prompt: "first prompt",
        onAcceptanceError: acceptanceError,
      },
    });

    await vi.waitFor(() =>
      expect(execution.admissions).toEqual(["first prompt"]),
    );
    expect(acceptanceError).not.toHaveBeenCalled();

    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("seeds the completion cursor without replaying stale terminal effects", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const producer = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    producer.start();
    const actor = producer.actor(chatStreamClientDefinition, chatStreamKey(7));
    const releaseProducer = actor.subscribe(() => undefined);
    await actor.resync();
    await actor.dispatch({ type: "SUBMIT", intent: turn("completed") });
    await flush();
    execution.observers.get("completed")?.onEnd?.({
      chatId: 7,
      invocationRef: turn("completed").invocationRef,
      updatedFiles: false,
    });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().lastCompletion?.intentId).toBe("completed"),
    );

    const reloaded = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    const terminalEffect = vi.fn();
    reloaded.start();
    reloaded.subscribeStreamFinished(terminalEffect);
    const releaseReloaded = reloaded.ensure(7).subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(reloaded.getSnapshot(7).lastCompletion?.intentId).toBe(
        "completed",
      ),
    );

    expect(terminalEffect).not.toHaveBeenCalled();

    releaseReloaded();
    releaseProducer();
    reloaded.dispose();
    producer.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("settles a durable review barrier without renderer ownership", async () => {
    const { markIntentTerminal } = await import("./persistence");
    vi.mocked(markIntentTerminal).mockClear();
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const producer = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    producer.start();
    const actor = producer.actor(chatStreamClientDefinition, chatStreamKey(7));
    const releaseProducer = actor.subscribe(() => undefined);
    await actor.resync();
    await actor.dispatch({ type: "SUBMIT", intent: turn("review") });
    await flush();
    await actor.dispatch({ type: "SUBMIT", intent: turn("queued") });
    await flush();
    persisted.paused = true;
    execution.observers.get("review")?.onEnd?.({
      chatId: 7,
      invocationRef: turn("review").invocationRef,
      updatedFiles: true,
      pausePromptQueue: true,
      reviewBarrierRequested: true,
    });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().lastCompletion?.intentId).toBe("review");
      expect(review.runAutoReviewBarrier).toHaveBeenCalledWith({
        chatId: 7,
        verification: false,
        autoFix: true,
      });
      expect(actor.getSnapshot().queuePaused).toBe(false);
      expect(execution.admissions).toContain("queued");
    });
    expect(markIntentTerminal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ intentId: "review" }),
      true,
      false,
      "manual",
      "completed",
    );

    const reloaded = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    const terminalEffect = vi.fn();
    reloaded.start();
    reloaded.subscribeStreamFinished(terminalEffect);
    const releaseReloaded = reloaded.ensure(7).subscribe(() => undefined);

    await flush();
    expect(terminalEffect).not.toHaveBeenCalled();

    releaseReloaded();
    releaseProducer();
    reloaded.dispose();
    producer.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("runs review remediation and verification without a renderer callback", async () => {
    review.runAutoReviewBarrier
      .mockResolvedValueOnce({
        outcome: "fix_required",
        threadId: "review-thread",
        prompt: "fix reviewed findings",
      })
      .mockResolvedValueOnce({ outcome: "released" });
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const producer = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    producer.start();
    const actor = producer.actor(chatStreamClientDefinition, chatStreamKey(7));
    const release = actor.subscribe(() => undefined);
    await actor.resync();
    await actor.dispatch({ type: "SUBMIT", intent: turn("review") });
    await flush();
    await actor.dispatch({ type: "SUBMIT", intent: turn("queued") });
    await flush();
    persisted.paused = true;
    execution.observers.get("review")?.onEnd?.({
      chatId: 7,
      invocationRef: turn("review").invocationRef,
      updatedFiles: true,
      pausePromptQueue: true,
      reviewBarrierRequested: true,
    });

    let remediation: ChatStreamExecutionObserver | undefined;
    await vi.waitFor(() => {
      remediation = [...execution.observers.values()].find(
        (observer) => observer.intent.owner?.kind === "review-remediation",
      );
      expect(remediation?.intent.prompt).toBe("fix reviewed findings");
      expect(remediation?.intent.owner).toEqual({
        kind: "review-remediation",
        threadId: "review-thread",
      });
    });
    remediation?.onEnd?.({
      chatId: 7,
      invocationRef: remediation.intent.invocationRef,
      updatedFiles: true,
      pausePromptQueue: true,
      reviewBarrierRequested: true,
    });

    await vi.waitFor(() => {
      expect(review.runAutoReviewBarrier).toHaveBeenNthCalledWith(2, {
        chatId: 7,
        verification: true,
      });
      expect(actor.getSnapshot().queuePaused).toBe(false);
      expect(execution.admissions).toContain("queued");
    });

    release();
    producer.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("preserves submission order across asynchronous attachment preparation", async () => {
    let releaseAttachment!: () => void;
    const attachmentGate = new Promise<void>((resolve) => {
      releaseAttachment = resolve;
    });
    execution.convertAttachments.mockImplementationOnce(async () => {
      await attachmentGate;
      return [];
    });
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    const actor = manager.ensure(7);
    const release = actor.subscribe(() => undefined);
    await flush();

    actor.send({
      type: "submit",
      request: {
        chatId: 7,
        prompt: "first",
        attachments: [
          {
            file: {} as File,
            type: "chat-context",
          },
        ],
      },
    });
    actor.send({
      type: "submit",
      request: { chatId: 7, prompt: "second" },
    });
    await flush();

    expect(execution.admissions).toEqual([]);
    releaseAttachment();
    await vi.waitFor(() =>
      expect(execution.admissions).toEqual(["first", "second"]),
    );

    release();
    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("rejects renderer attempts to claim a main-owned queue owner", async () => {
    await expect(
      chatStreamDefinition.remote.authorizeDispatch({
        sender: {
          webContentsId: 1,
          windowSessionId: "renderer-window",
        },
        key: chatStreamKey(7),
        event: {
          type: "SUBMIT",
          intent: {
            ...turn("forged-plan"),
            owner: { kind: "plan-handoff", handoffId: "forged" },
          },
        },
        currentState: undefined,
      }),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects renderer attempts to claim a follow-up request identity", async () => {
    await expect(
      chatStreamDefinition.remote.authorizeDispatch({
        sender: {
          webContentsId: 1,
          windowSessionId: "renderer-window",
        },
        key: chatStreamKey(7),
        event: {
          type: "SUBMIT",
          intent: {
            ...turn("forged-follow-up"),
            userInputRequestId: "main-owned-request",
          },
        },
        currentState: undefined,
      }),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects renderer submissions for an app that does not own the chat", async () => {
    await expect(
      chatStreamDefinition.remote.authorizeDispatch({
        sender: {
          webContentsId: 1,
          windowSessionId: "renderer-window",
        },
        key: chatStreamKey(7),
        event: {
          type: "SUBMIT",
          intent: {
            ...turn("wrong-app"),
            appId: 4,
          },
        },
        currentState: undefined,
      }),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("keeps the renderer payload hash valid when main binds its window identity", async () => {
    const { payloadHash: _oldHash, ...withoutHash } = turn("bound-window");
    const event = {
      type: "SUBMIT" as const,
      intent: {
        ...withoutHash,
        payloadHash: computeChatTurnPayloadHash(withoutHash),
      },
    };

    await chatStreamDefinition.remote.authorizeDispatch({
      sender: {
        webContentsId: 1,
        windowSessionId: "renderer-window",
      },
      key: chatStreamKey(7),
      event,
      currentState: undefined,
    });

    const { payloadHash, ...authorizedPayload } = event.intent;
    expect(authorizedPayload.originWindowSessionId).toBe("renderer-window");
    expect(computeChatTurnPayloadHash(authorizedPayload)).toBe(payloadHash);
  });

  it("allows a stale cancellation intent to park the queue", async () => {
    await expect(
      chatStreamDefinition.remote.authorizeDispatch({
        sender: {
          webContentsId: 1,
          windowSessionId: "renderer-window",
        },
        key: chatStreamKey(7),
        event: {
          type: "CANCEL",
          invocationRef: turn("stale").invocationRef!,
          pauseQueue: true,
        },
        currentState: initialChatStreamHostState(),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a queue-parking cancellation routed from another chat", async () => {
    await expect(
      chatStreamDefinition.remote.authorizeDispatch({
        sender: {
          webContentsId: 1,
          windowSessionId: "renderer-window",
        },
        key: chatStreamKey(7),
        event: {
          type: "CANCEL",
          invocationRef: {
            ...turn("other-chat").invocationRef!,
            entityKey: 8,
          },
          pauseQueue: true,
        },
        currentState: initialChatStreamHostState(),
      }),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects subscriptions and dispatches while chat deletion is fenced", async () => {
    const releaseDeletion = beginChatActorDeletion(7);
    try {
      expect(() => assertChatActorAdmissionOpen(7)).toThrowError(
        expect.objectContaining({ kind: "precondition" }),
      );
      await expect(
        chatStreamDefinition.remote.authorizeSubscribe({
          sender: {
            webContentsId: 1,
            windowSessionId: "renderer-window",
          },
          key: chatStreamKey(7),
        }),
      ).rejects.toMatchObject({ kind: "auth" });
      await expect(
        chatStreamDefinition.remote.authorizeDispatch({
          sender: {
            webContentsId: 1,
            windowSessionId: "renderer-window",
          },
          key: chatStreamKey(7),
          event: { type: "SUBMIT", intent: turn("during-deletion") },
          currentState: undefined,
        }),
      ).rejects.toMatchObject({ kind: "auth" });
    } finally {
      releaseDeletion();
    }
  });

  it("retains a submission subscription until terminal settlement", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    const actor = manager.ensure(7);
    const release = actor.subscribe(() => undefined);
    const onSettled = vi.fn();

    actor.send({
      type: "submit",
      request: {
        chatId: 7,
        appId: 3,
        prompt: "continue",
        onSettled,
      },
    });
    await vi.waitFor(() => expect(execution.observers.size).toBe(1));
    release();

    const observer = [...execution.observers.values()][0]!;
    observer.onEnd?.({
      chatId: 7,
      invocationRef: observer.intent.invocationRef!,
      updatedFiles: false,
    });

    await vi.waitFor(() =>
      expect(onSettled).toHaveBeenCalledWith({
        success: true,
        pausedByStepLimit: undefined,
      }),
    );

    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("keeps a main-accepted submission pending across a second Stop", async () => {
    let resolveFirstCancel!: (cancelled: boolean) => void;
    vi.mocked(cancelActiveStreamsForChat).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstCancel = resolve;
        }),
    );
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    const actor = manager.ensure(7);
    const release = actor.subscribe(() => undefined);
    const onSettled = vi.fn();

    actor.send({
      type: "submit",
      request: { chatId: 7, prompt: "stop twice", onSettled },
    });
    await vi.waitFor(() => expect(actor.getSnapshot().phase).toBe("streaming"));

    actor.send({ type: "cancel" });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().phase).toBe("cancelling"),
    );
    actor.send({ type: "cancel" });

    await flush();
    expect(onSettled).not.toHaveBeenCalled();
    resolveFirstCancel(true);
    await vi.waitFor(() =>
      expect(onSettled).toHaveBeenCalledExactlyOnceWith({
        success: false,
        pausedByStepLimit: undefined,
      }),
    );
    await flush();
    expect(onSettled).toHaveBeenCalledTimes(1);

    release();
    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("keeps Stop precedence when a cancelled turn requests review", async () => {
    let resolveCancel!: (cancelled: boolean) => void;
    vi.mocked(cancelActiveStreamsForChat).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve;
        }),
    );
    vi.mocked(markIntentTerminal).mockClear();
    const host = new ActorHost({
      placement: "main",
      clock: createFakeClock(),
      ids: createSequentialIdSource(),
    });
    host.register(chatStreamDefinition);
    const actor = host.ensure(chatStreamDefinition, chatStreamKey(7));
    const activeIntent = turn("stopped-review");

    actor.enqueue({ type: "SUBMIT", intent: activeIntent });
    await vi.waitFor(() =>
      expect(execution.observers.has(activeIntent.intentId)).toBe(true),
    );
    actor.enqueue({
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
      observedStopPolicyVersion: 0,
    });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().phase).toBe("cancelling"),
    );

    execution.observers.get(activeIntent.intentId)?.onEnd?.({
      chatId: 7,
      invocationRef: activeIntent.invocationRef!,
      updatedFiles: true,
      wasCancelled: true,
      pausePromptQueue: true,
      reviewBarrierRequested: true,
    });

    await vi.waitFor(() =>
      expect(markIntentTerminal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ intentId: activeIntent.intentId }),
        true,
        true,
        "stop",
        "cancelled",
      ),
    );
    resolveCancel(true);
    await host.dispose();
  });

  it("routes cancellation completion back into the main actor", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(chatStreamClientDefinition, chatStreamKey(7));
    const release = actor.subscribe(() => undefined);
    await actor.resync();
    await actor.dispatch({ type: "SUBMIT", intent: turn("cancel-me") });
    await vi.waitFor(() => expect(actor.getSnapshot().phase).toBe("streaming"));

    await actor.dispatch({
      type: "CANCEL",
      invocationRef: turn("cancel-me").invocationRef!,
    });

    await vi.waitFor(() =>
      expect(actor.getSnapshot()).toMatchObject({
        phase: "idle",
        lastCompletion: {
          intentId: "cancel-me",
          outcome: "cancelled",
        },
      }),
    );

    release();
    client.dispose();
    await transport.dispose();
    await host.dispose();
  });

  it("does not drain queued work after destructive cancellation", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    host.register(chatStreamDefinition);
    const actor = host.ensure(chatStreamDefinition, chatStreamKey(7));
    const queued = turn("queued-after-cancel");

    actor.enqueue({ type: "SUBMIT", intent: turn("cancel-before-mutation") });
    await vi.waitFor(() =>
      expect(execution.observers.has("cancel-before-mutation")).toBe(true),
    );
    persisted.entries = [
      {
        itemId: queued.intentId,
        intentId: queued.intentId,
        prompt: queued.prompt,
        persistence: "main-session",
        editable: true,
        removable: true,
      },
    ];
    persisted.intents.set(queued.intentId, queued);

    const releaseDeletion = beginChatActorDeletion(7);
    try {
      actor.enqueue({
        type: "CANCEL",
        invocationRef: turn("cancel-before-mutation").invocationRef!,
      });
      await vi.waitFor(() => expect(actor.getSnapshot().phase).toBe("idle"));
      await flush();

      expect(persisted.entries).toMatchObject([
        { intentId: "queued-after-cancel" },
      ]);
      expect(actor.getSnapshot().active).toBeNull();
    } finally {
      releaseDeletion();
    }

    await host.dispose();
  });

  it("settles cancellation that arrives before stream registration", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    host.register(chatStreamDefinition);
    const actor = host.ensure(chatStreamDefinition, chatStreamKey(7));

    actor.enqueue({ type: "SUBMIT", intent: turn("cancel-during-admission") });
    actor.enqueue({
      type: "CANCEL",
      invocationRef: turn("cancel-during-admission").invocationRef!,
    });

    await vi.waitFor(() =>
      expect(actor.getSnapshot()).toMatchObject({
        phase: "idle",
        lastCompletion: {
          intentId: "cancel-during-admission",
          outcome: "cancelled",
        },
      }),
    );
    expect(execution.observers.has("cancel-during-admission")).toBe(false);

    await host.dispose();
  });

  it("mutates a queue without requiring an already-mounted chat subscriber", async () => {
    const clock = createFakeClock();
    const host = new ActorHost({
      placement: "main",
      clock,
      ids: createSequentialIdSource(),
    });
    const manifest = createRemoteMachineManifest([chatStreamDefinition]);
    const windows = new TwoWindowHarness();
    const transport = new RemoteMachineTransport({
      host,
      manifest,
      windows: windows.registry,
      clock,
    });
    const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    await manager.dispatchQueueEvent(7, { type: "PAUSE_QUEUE" });

    expect(persisted).toMatchObject({ paused: true, revision: 1 });

    manager.dispose();
    await transport.dispose();
    await host.dispose();
  });
});
