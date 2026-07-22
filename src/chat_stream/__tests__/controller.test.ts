import { describe, expect, it, vi } from "vitest";

import type { ChatResponseEnd } from "@/ipc/types";
import type { TransitionObserver } from "@/state_machines/types";

import type { ChatStreamCommands } from "../commands";
import { createChatStreamController } from "../controller";
import type {
  ChatStreamIgnoreReason,
  StreamCommand,
  StreamEvent,
  StreamRequest,
  StreamState,
} from "../state";

const CHAT_ID = 42;

function makeRequest(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return { prompt: "hello", chatId: CHAT_ID, ...overrides };
}

function endResponse(wasCancelled?: boolean): ChatResponseEnd {
  return {
    chatId: CHAT_ID,
    updatedFiles: false,
    ...(wasCancelled === undefined ? {} : { wasCancelled }),
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks / controller drain steps run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/**
 * Fake ChatStreamCommands built on manually resolved deferred promises, plus
 * an ordered call log for serialization assertions.
 */
function createFakeCommands() {
  const log: string[] = [];
  const startDeferreds: Deferred[] = [];
  const endDeferreds: Deferred[] = [];

  const commands: ChatStreamCommands = {
    startStream: vi.fn(async ({ streamId }) => {
      log.push(`startStream:${streamId}`);
      const d = deferred();
      startDeferreds.push(d);
      return d.promise;
    }),
    enqueueMessage: vi.fn(({ request }) => {
      log.push(`enqueue:${request.prompt}`);
    }),
    requestAbort: vi.fn(() => {
      log.push("requestAbort");
    }),
    releaseTransport: vi.fn(({ streamId }) => {
      log.push(`releaseTransport:${streamId}`);
    }),
    runEndSideEffects: vi.fn(({ streamId }) => {
      log.push(`runEnd:${streamId}`);
      const d = deferred();
      endDeferreds.push(d);
      return d.promise;
    }),
    runErrorSideEffects: vi.fn(({ error }) => {
      log.push(`runError:${error}`);
    }),
    dispatchNextQueued: vi.fn(() => {
      log.push("dispatchNextQueued");
    }),
    syncProjection: vi.fn(),
  };

  return { commands, log, startDeferreds, endDeferreds };
}

function createController(
  fake = createFakeCommands(),
  observer?: TransitionObserver<
    StreamState,
    StreamEvent,
    StreamCommand,
    ChatStreamIgnoreReason
  >,
) {
  const controller = createChatStreamController({
    chatId: CHAT_ID,
    getCommands: () => fake.commands,
    observer,
  });
  return { controller, ...fake };
}

describe("chat stream controller", () => {
  it("reports applied and ignored events without conflating command-only transitions", () => {
    const observer = {
      onTransitionApplied: vi.fn(),
      onEventIgnored: vi.fn(),
    } satisfies TransitionObserver<
      StreamState,
      StreamEvent,
      StreamCommand,
      ChatStreamIgnoreReason
    >;
    const { controller } = createController(createFakeCommands(), observer);

    controller.send({ type: "cancel" });
    expect(observer.onEventIgnored).toHaveBeenCalledExactlyOnceWith({
      state: { type: "idle", lastStreamId: 0 },
      event: { type: "cancel" },
      reason: "no-active-stream",
    });

    controller.send({ type: "submit", request: makeRequest() });
    controller.send({
      type: "submit",
      request: makeRequest({ prompt: "queued" }),
    });
    expect(observer.onTransitionApplied).toHaveBeenCalledTimes(2);
    expect(observer.onTransitionApplied).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previous: expect.objectContaining({ type: "starting" }),
        state: expect.objectContaining({ type: "starting" }),
        commands: [expect.objectContaining({ type: "enqueue-message" })],
      }),
    );
  });

  it("disposes an active stream exactly once and observes later events as ignored", async () => {
    const onSettled = vi.fn();
    const observer = {
      onEventIgnored: vi.fn(),
    } satisfies TransitionObserver<
      StreamState,
      StreamEvent,
      StreamCommand,
      ChatStreamIgnoreReason
    >;
    const { controller, commands, startDeferreds } = createController(
      createFakeCommands(),
      observer,
    );

    controller.send({
      type: "submit",
      request: makeRequest({ onSettled }),
    });
    await flush();
    controller.dispose();
    controller.dispose();

    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ success: false });
    expect(commands.syncProjection).toHaveBeenLastCalledWith({
      chatId: CHAT_ID,
      state: { type: "idle", lastStreamId: 1 },
    });
    expect(commands.releaseTransport).toHaveBeenCalledExactlyOnceWith({
      chatId: CHAT_ID,
      streamId: 1,
    });

    controller.send({ type: "registered" });
    expect(observer.onEventIgnored).toHaveBeenLastCalledWith({
      state: expect.objectContaining({ type: "starting", streamId: 1 }),
      event: { type: "registered" },
      reason: "no-active-stream",
    });

    startDeferreds[0].resolve();
    await flush();
    expect(commands.releaseTransport).toHaveBeenCalledTimes(2);
    expect(commands.releaseTransport).toHaveBeenLastCalledWith({
      chatId: CHAT_ID,
      streamId: 1,
    });
  });

  it("runs the happy path and dispatches the queue exactly once per finalization", async () => {
    const { controller, commands, startDeferreds, endDeferreds } =
      createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    expect(commands.startStream).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().type).toBe("starting");

    startDeferreds[0].resolve();
    controller.send({ type: "registered" });
    expect(controller.getSnapshot().type).toBe("streaming");

    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    await flush();
    expect(controller.getSnapshot().type).toBe("finalizing");
    expect(commands.runEndSideEffects).toHaveBeenCalledTimes(1);
    expect(commands.dispatchNextQueued).not.toHaveBeenCalled();

    endDeferreds[0].resolve();
    await flush();
    expect(controller.getSnapshot()).toEqual({ type: "idle", lastStreamId: 1 });
    expect(commands.dispatchNextQueued).toHaveBeenCalledTimes(1);
    expect(controller.isSettled()).toBe(true);
  });

  it("exposes generation-aware staleness to stream recovery commands", async () => {
    const { controller, commands } = createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    const firstStart = vi.mocked(commands.startStream).mock.calls[0][0];
    expect(firstStart.isStale()).toBe(false);

    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    controller.send({ type: "finalize-complete", streamId: 1, ok: true });
    expect(firstStart.isStale()).toBe(false);

    controller.send({ type: "submit", request: makeRequest() });
    expect(firstStart.isStale()).toBe(true);

    controller.dispose();
    expect(firstStart.isStale()).toBe(true);
  });

  it("never overlaps streams for a chat: a submit during an active stream is enqueued", async () => {
    const { controller, commands, startDeferreds } = createController();

    controller.send({ type: "submit", request: makeRequest() });
    // Second submit lands while the first is still starting (attachment
    // conversion in flight): must queue, never drop, never double-start.
    controller.send({
      type: "submit",
      request: makeRequest({ prompt: "second" }),
    });
    await flush();
    startDeferreds[0]?.resolve();
    await flush();

    expect(commands.startStream).toHaveBeenCalledTimes(1);
    expect(commands.enqueueMessage).toHaveBeenCalledTimes(1);
    expect(commands.enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID,
        request: expect.objectContaining({ prompt: "second" }),
      }),
    );
  });

  it("drops stale completions structurally", async () => {
    const { controller, commands, startDeferreds, endDeferreds } =
      createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();
    controller.send({ type: "registered" });

    // Stale events from a different generation never advance the machine.
    controller.send({
      type: "stream-ended",
      streamId: 999,
      response: endResponse(),
    });
    controller.send({ type: "stream-errored", streamId: 999, error: "old" });
    await flush();
    expect(controller.getSnapshot().type).toBe("streaming");
    expect(commands.runEndSideEffects).not.toHaveBeenCalled();
    expect(commands.runErrorSideEffects).not.toHaveBeenCalled();

    // Complete for real, then replay the same terminal event: ignored.
    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    await flush();
    endDeferreds[0].resolve();
    await flush();
    expect(controller.getSnapshot().type).toBe("idle");

    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    await flush();
    expect(commands.runEndSideEffects).toHaveBeenCalledTimes(1);
    expect(commands.dispatchNextQueued).toHaveBeenCalledTimes(1);
  });

  it("finalizes a cancel-before-registration on the sole wasCancelled end", async () => {
    const { controller, commands, startDeferreds, endDeferreds } =
      createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();

    controller.send({ type: "cancel" });
    await flush();
    expect(commands.requestAbort).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().type).toBe("cancelling");

    // Main tracked the AbortController synchronously, aborted the stream
    // pre-admission, and sent the SOLE terminal end — chat:stream:start will
    // never arrive. The machine must finalize now (waiting for registration
    // would deadlock it in `cancelling`); no queue dispatch after a
    // cancelled turn.
    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(true),
    });
    await flush();
    expect(commands.runEndSideEffects).toHaveBeenCalledTimes(1);
    endDeferreds[0].resolve();
    await flush();
    expect(controller.getSnapshot()).toEqual({ type: "idle", lastStreamId: 1 });
    expect(commands.dispatchNextQueued).not.toHaveBeenCalled();
  });

  it("re-issues the abort on registration when the cancel raced ahead of the stream request", async () => {
    const { controller, commands, startDeferreds, endDeferreds } =
      createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();

    controller.send({ type: "cancel" });
    await flush();
    expect(commands.requestAbort).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().type).toBe("cancelling");

    // The abort reached main before `chat:stream` did (found nothing, sent
    // nothing). Registration arrives: the abort is re-issued.
    controller.send({ type: "registered" });
    await flush();
    expect(commands.requestAbort).toHaveBeenCalledTimes(2);

    // The terminal event of the now-aborted stream finalizes exactly once.
    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(true),
    });
    await flush();
    expect(commands.runEndSideEffects).toHaveBeenCalledTimes(1);
    endDeferreds[0].resolve();
    await flush();
    expect(controller.getSnapshot()).toEqual({ type: "idle", lastStreamId: 1 });
    expect(commands.dispatchNextQueued).not.toHaveBeenCalled();
  });

  it("executes commands serially: work queued during finalization runs after it", async () => {
    const { controller, log, startDeferreds, endDeferreds } =
      createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();
    controller.send({ type: "registered" });
    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    await flush();

    // Finalization is in flight (deferred unresolved). A submit arriving now
    // must be enqueued only AFTER the end side effects complete.
    controller.send({
      type: "submit",
      request: makeRequest({ prompt: "during-finalize" }),
    });
    await flush();
    expect(log).not.toContain("enqueue:during-finalize");

    endDeferreds[0].resolve();
    await flush();
    const runEndIndex = log.indexOf("runEnd:1");
    const enqueueIndex = log.indexOf("enqueue:during-finalize");
    expect(runEndIndex).toBeGreaterThanOrEqual(0);
    expect(enqueueIndex).toBeGreaterThan(runEndIndex);
  });

  it("returns to idle without dispatching when finalization fails", async () => {
    const { controller, commands, startDeferreds, endDeferreds } =
      createController();

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();
    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    await flush();
    endDeferreds[0].reject(new Error("finalize exploded"));
    await flush();

    expect(controller.getSnapshot()).toEqual({ type: "idle", lastStreamId: 1 });
    expect(commands.dispatchNextQueued).not.toHaveBeenCalled();
  });

  it("converts startStream setup failures into the errored state", async () => {
    const fake = createFakeCommands();
    fake.commands.startStream = vi.fn(async () => {
      throw new Error("attachment conversion failed");
    });
    const { controller, commands } = createController(fake);

    controller.send({ type: "submit", request: makeRequest() });
    await flush();

    expect(controller.getSnapshot()).toMatchObject({
      type: "errored",
      error: "attachment conversion failed",
    });
    expect(commands.runErrorSideEffects).toHaveBeenCalledTimes(1);
  });

  it("a queue dispatch that re-submits starts the next stream with a fresh generation", async () => {
    const fake = createFakeCommands();
    let dispatched = 0;
    fake.commands.dispatchNextQueued = vi.fn(({ emit }) => {
      fake.log.push("dispatchNextQueued");
      dispatched += 1;
      if (dispatched === 1) {
        emit({
          type: "submit",
          request: makeRequest({ prompt: "from-queue" }),
        });
      }
    });
    const { controller, commands, startDeferreds, endDeferreds } =
      createController(fake);

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();
    controller.send({
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    await flush();
    endDeferreds[0].resolve();
    await flush();

    expect(commands.dispatchNextQueued).toHaveBeenCalledTimes(1);
    expect(commands.startStream).toHaveBeenCalledTimes(2);
    expect(commands.startStream).toHaveBeenLastCalledWith(
      expect.objectContaining({
        streamId: 2,
        request: expect.objectContaining({ prompt: "from-queue" }),
      }),
    );
    expect(controller.getSnapshot().type).toBe("starting");
  });

  it("notifies subscribers with immutable snapshots (useSyncExternalStore contract)", async () => {
    const { controller, startDeferreds } = createController();
    const seen: string[] = [];
    const snapshotBefore = controller.getSnapshot();
    const unsubscribe = controller.subscribe(() => {
      seen.push(controller.getSnapshot().type);
    });

    controller.send({ type: "submit", request: makeRequest() });
    await flush();
    startDeferreds[0].resolve();
    controller.send({ type: "registered" });

    expect(seen).toEqual(["starting", "streaming"]);
    // Old snapshots are never mutated in place.
    expect(snapshotBefore).toEqual({ type: "idle", lastStreamId: 0 });

    unsubscribe();
    controller.send({ type: "cancel" });
    expect(seen).toEqual(["starting", "streaming"]);
  });
});
