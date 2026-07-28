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
import type { ChatStreamExecutionObserver } from "@/ipc/handlers/chat_stream_handlers";
import {
  beginChatActorDeletion,
  assertChatActorAdmissionOpen,
} from "@/ipc/services/chat_actor_deletion_fence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import { chatStreamDefinition } from "./definition";
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
  convertAttachments: vi.fn(async () => []),
}));

vi.mock("@/lib/chatAttachmentConversion", () => ({
  convertFileAttachmentsToChatAttachments: execution.convertAttachments,
}));

const persisted = vi.hoisted(() => ({
  revision: 0,
  paused: false,
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
    ) => {
      if (
        request.invocationRef &&
        execution.pendingCancellations.delete(request.invocationRef.operationId)
      ) {
        return request.chatId;
      }
      const intentId = observer.intent.intentId;
      execution.observers.set(intentId, observer);
      observer.onAccepted?.(11);
      return 7;
    },
  ),
}));

vi.mock("./persistence", () => ({
  loadChatQueue: vi.fn(() => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queue: [...persisted.entries],
  })),
  hydrateChatStreamPersistence: vi.fn(() => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queue: [...persisted.entries],
  })),
  stageActiveIntent: vi.fn(
    (_database: unknown, intent: SerializableChatTurnIntent) => {
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
    (_database: unknown, intent: SerializableChatTurnIntent) => {
      execution.admissions.push(intent.prompt);
      const entry: ChatQueueEntry = {
        itemId: intent.intentId,
        intentId: intent.intentId,
        prompt: intent.prompt,
        persistence: "main-session",
        editable: true,
        removable: true,
      };
      persisted.entries.push(entry);
      persisted.revision += 1;
      return {
        kind: "queued" as const,
        entry,
        queueRevision: persisted.revision,
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
      persisted.revision += 1;
      return {
        queueRevision: persisted.revision,
        queuePaused: persisted.paused,
        queue: [...persisted.entries],
      };
    },
  ),
  markIntentTerminal: vi.fn(() => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queue: [...persisted.entries],
  })),
  claimQueueHead: vi.fn(async () => {
    if (persisted.paused) return null;
    const entry = persisted.entries.shift();
    if (!entry) return null;
    const intent = persisted.intents.get(entry.intentId);
    if (!intent) return null;
    persisted.revision += 1;
    return {
      intent,
      queue: {
        queueRevision: persisted.revision,
        queuePaused: persisted.paused,
        queue: [...persisted.entries],
      },
    };
  }),
  restoreClaimedQueueHead: vi.fn(async () => ({
    queueRevision: persisted.revision,
    queuePaused: persisted.paused,
    queue: [...persisted.entries],
  })),
}));

function turn(intentId: string): SerializableChatTurnIntent {
  return {
    schemaVersion: 1,
    intentId,
    payloadHash: `hash-${intentId}`,
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
    execution.convertAttachments.mockReset();
    execution.convertAttachments.mockResolvedValue([]);
    persisted.revision = 0;
    persisted.paused = false;
    persisted.entries = [];
    persisted.intents.clear();
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
});
