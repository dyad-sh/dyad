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
}));

const persisted = vi.hoisted(() => ({
  revision: 0,
  paused: false,
  entries: [] as ChatQueueEntry[],
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
  cancelActiveStreamsForChat: vi.fn(async () => true),
  executeChatStreamFromActor: vi.fn(
    async (
      _sender: unknown,
      _request: { intentId?: string },
      observer: ChatStreamExecutionObserver,
    ) => {
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
  stageActiveIntent: vi.fn(() => null),
  isSessionQueuedIntent: vi.fn(() => false),
  completeSessionQueueAcceptance: vi.fn(),
  disposeSessionChatQueue: vi.fn(),
  persistSessionQueuedIntent: vi.fn(),
  persistQueuedIntent: vi.fn(
    (_database: unknown, intent: SerializableChatTurnIntent) => {
      const entry: ChatQueueEntry = {
        itemId: intent.intentId,
        intentId: intent.intentId,
        prompt: intent.prompt,
        persistence: "durable",
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
  peekQueueHead: vi.fn(() => null),
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
    persisted.revision = 0;
    persisted.paused = false;
    persisted.entries = [];
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
});
