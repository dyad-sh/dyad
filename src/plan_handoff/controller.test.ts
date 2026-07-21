import { describe, expect, it, vi } from "vitest";

import {
  createHandoffController,
  type HandoffCommandRunner,
} from "./controller";
import type { HandoffCommand, HandoffEvent } from "./state";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let queued microtasks and 0ms timers run. */
async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const ACCEPT: HandoffEvent = {
  type: "PLAN_ACCEPTED",
  chatId: 1,
  appId: 10,
  acceptInNewChat: true,
};

interface FakeRunnerOptions {
  /** Commands whose execution should block until manually released. */
  blockers?: Partial<Record<HandoffCommand["type"], Promise<void>>>;
  /** When true, `watch-stream-idle` does not emit until `releaseStreamIdle`. */
  streamBusy?: boolean;
  /** When set, `persist-plan` fails with this error. */
  persistError?: string;
}

/**
 * A command runner that behaves like the production adapter (same completion
 * events) but with controllable timing and full command recording.
 */
function createFakeRunner(options: FakeRunnerOptions = {}) {
  const executed: HandoffCommand["type"][] = [];
  const log: string[] = [];
  let streamBusy = options.streamBusy ?? false;
  // Mirrors the production adapter: a busy stream registers a pending watcher
  // (keyed by chatId) that fires later; unwatch-stream-idle disposes it.
  const pendingWatchers = new Map<number, () => void>();

  const run: HandoffCommandRunner = async (command, emit) => {
    log.push(`start:${command.type}`);
    await options.blockers?.[command.type];
    executed.push(command.type);
    switch (command.type) {
      case "cancel-stream":
        emit({ type: "STREAM_CANCEL_FINISHED" });
        break;
      case "wait":
        emit({ type: "TRANSITION_DISPLAY_DONE" });
        break;
      case "persist-plan":
        if (options.persistError) {
          emit({ type: "PLAN_PERSIST_FAILED", error: options.persistError });
        } else {
          emit({ type: "PLAN_PERSISTED", planSlug: "slug" });
        }
        break;
      case "create-chat":
        emit({ type: "CHAT_READY", implementationChatId: 2 });
        break;
      case "switch-chat-mode":
        emit({ type: "CHAT_READY", implementationChatId: command.chatId });
        break;
      case "watch-stream-idle":
        if (streamBusy) {
          pendingWatchers.set(command.chatId, () =>
            emit({ type: "STREAM_BECAME_IDLE", chatId: command.chatId }),
          );
        } else {
          emit({ type: "STREAM_BECAME_IDLE", chatId: command.chatId });
        }
        break;
      case "unwatch-stream-idle":
        pendingWatchers.delete(command.chatId);
        break;
      case "start-implementation":
        emit({ type: "IMPLEMENTATION_STARTED" });
        break;
      default:
        break;
    }
    log.push(`end:${command.type}`);
  };

  return {
    run,
    executed,
    log,
    pendingWatchers,
    releaseStreamIdle: () => {
      streamBusy = false;
      const fire = [...pendingWatchers.values()];
      pendingWatchers.clear();
      for (const emitIdle of fire) {
        emitIdle();
      }
    },
    count: (type: HandoffCommand["type"]) =>
      executed.filter((t) => t === type).length,
  };
}

describe("plan handoff controller", () => {
  it("runs the whole accept-while-idle handoff and fires the implementation exactly once", async () => {
    const runner = createFakeRunner();
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();

    expect(controller.getSnapshot()).toEqual({ type: "idle" });
    expect(runner.count("start-implementation")).toBe(1);
    expect(runner.executed).toEqual([
      "mark-plan-accepted",
      "cancel-stream",
      "wait",
      "set-preview-mode",
      "persist-plan",
      "create-chat",
      "navigate-to-chat",
      "refresh-chat-list",
      "watch-stream-idle",
      "start-implementation",
    ]);
  });

  it("waits for the stream to become idle before firing, then fires exactly once", async () => {
    const runner = createFakeRunner({ streamBusy: true });
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();

    expect(controller.getSnapshot().type).toBe("awaiting-stream-idle");
    expect(runner.count("start-implementation")).toBe(0);

    runner.releaseStreamIdle();
    await flush();

    expect(controller.getSnapshot()).toEqual({ type: "idle" });
    expect(runner.count("start-implementation")).toBe(1);
  });

  it("supersedes a stalled awaiting-stream-idle on re-accept, disposing the watcher", async () => {
    const runner = createFakeRunner({ streamBusy: true });
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();
    expect(controller.getSnapshot().type).toBe("awaiting-stream-idle");
    expect(runner.pendingWatchers.size).toBe(1);

    // Stream never goes idle; the user accepts the plan again. The stuck
    // watcher is disposed and a full fresh handoff runs.
    controller.send({ ...ACCEPT, acceptInNewChat: false });
    await flush();

    expect(runner.count("unwatch-stream-idle")).toBe(1);
    expect(runner.count("mark-plan-accepted")).toBe(2);
    expect(controller.getSnapshot().type).toBe("awaiting-stream-idle");
    // Only the new handoff's watcher remains.
    expect(runner.pendingWatchers.size).toBe(1);

    runner.releaseStreamIdle();
    await flush();

    expect(controller.getSnapshot()).toEqual({ type: "idle" });
    // The superseded handoff never fires; the new one fires exactly once.
    expect(runner.count("start-implementation")).toBe(1);
  });

  it("executes commands strictly serially", async () => {
    const gate = deferred();
    const runner = createFakeRunner({
      blockers: { "mark-plan-accepted": gate.promise },
    });
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();

    // The first command is still in flight; nothing later may have started.
    expect(runner.log).toEqual(["start:mark-plan-accepted"]);

    gate.resolve();
    await flush();

    // Every command completed before the next one started.
    for (let i = 0; i < runner.log.length; i += 2) {
      expect(runner.log[i]).toMatch(/^start:/);
      expect(runner.log[i + 1]).toBe(runner.log[i].replace("start:", "end:"));
    }
    expect(runner.count("start-implementation")).toBe(1);
  });

  it("stops queued work and ignores an in-flight completion after dispose", async () => {
    const gate = deferred();
    const runner = createFakeRunner({
      blockers: { "cancel-stream": gate.promise },
    });
    const controller = createHandoffController(runner.run);
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.send(ACCEPT);
    await flush();
    expect(runner.log.at(-1)).toBe("start:cancel-stream");
    expect(controller.getSnapshot().type).toBe("cancelling-stream");

    listener.mockClear();
    controller.dispose();
    gate.resolve();
    await flush();

    expect(controller.getSnapshot().type).toBe("cancelling-stream");
    expect(listener).not.toHaveBeenCalled();
    expect(runner.count("wait")).toBe(0);
    expect(runner.count("set-preview-mode")).toBe(0);
  });

  it("makes subscribe and send inert after dispose", () => {
    const runner = createFakeRunner();
    const controller = createHandoffController(runner.run);
    const idle = controller.getSnapshot();

    controller.dispose();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.send(ACCEPT);
    unsubscribe();

    expect(controller.getSnapshot()).toBe(idle);
    expect(listener).not.toHaveBeenCalled();
    expect(runner.executed).toEqual([]);
  });

  it("lets the wait command's completion drive the transition out of transitioning", async () => {
    const gate = deferred();
    const runner = createFakeRunner({ blockers: { wait: gate.promise } });
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();

    // Wait command in flight: the machine sits in `transitioning`.
    expect(controller.getSnapshot().type).toBe("transitioning");
    expect(runner.count("persist-plan")).toBe(0);

    gate.resolve();
    await flush();

    expect(runner.count("persist-plan")).toBe(1);
    expect(controller.getSnapshot()).toEqual({ type: "idle" });
  });

  it("ignores a second accept mid-saga instead of double-firing", async () => {
    const gate = deferred();
    const runner = createFakeRunner({ blockers: { wait: gate.promise } });
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();
    expect(controller.getSnapshot().type).toBe("transitioning");

    controller.send(ACCEPT);
    await flush();
    expect(controller.getSnapshot().type).toBe("transitioning");

    gate.resolve();
    await flush();

    expect(runner.count("start-implementation")).toBe(1);
    expect(runner.count("persist-plan")).toBe(1);
    expect(runner.count("mark-plan-accepted")).toBe(1);
  });

  it("completes the saga even after all subscribers unsubscribe (unmount mid-saga)", async () => {
    const gate = deferred();
    const runner = createFakeRunner({ blockers: { wait: gate.promise } });
    const controller = createHandoffController(runner.run);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.send(ACCEPT);
    await flush();
    expect(listener).toHaveBeenCalled();

    // "Unmount": nobody is watching anymore.
    unsubscribe();
    gate.resolve();
    await flush();

    expect(controller.getSnapshot()).toEqual({ type: "idle" });
    expect(runner.count("start-implementation")).toBe(1);
  });

  it("moves to failed on persist errors and reports it, then recovers on re-accept", async () => {
    const runner = createFakeRunner({ persistError: "disk full" });
    const controller = createHandoffController(runner.run);

    controller.send(ACCEPT);
    await flush();

    expect(controller.getSnapshot()).toMatchObject({
      type: "failed",
      failure: "persist-plan",
      error: "disk full",
    });
    expect(runner.count("notify-failure")).toBe(1);
    expect(runner.count("start-implementation")).toBe(0);

    // Legacy recovery semantics: accepting again restarts the whole handoff
    // from scratch (persist still fails here, so it reaches persist-plan
    // a second time and fails the same way).
    controller.send(ACCEPT);
    await flush();
    expect(runner.count("persist-plan")).toBe(2);
    expect(controller.getSnapshot()).toMatchObject({ type: "failed" });
  });

  it("keeps draining the queue when a command throws", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const runner = createFakeRunner();
      const throwingRun: HandoffCommandRunner = async (command, emit) => {
        if (command.type === "mark-plan-accepted") {
          throw new Error("atom exploded");
        }
        await runner.run(command, emit);
      };
      const controller = createHandoffController(throwingRun);

      controller.send(ACCEPT);
      await flush();

      expect(controller.getSnapshot()).toEqual({ type: "idle" });
      expect(runner.count("cancel-stream")).toBe(1);
      expect(runner.count("start-implementation")).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(
        '[plan-handoff] command "mark-plan-accepted" threw',
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps snapshots reference-stable and only notifies on real changes", async () => {
    const runner = createFakeRunner({ streamBusy: true });
    const controller = createHandoffController(runner.run);
    const listener = vi.fn();
    controller.subscribe(listener);

    const idle = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(idle);

    // Irrelevant event in idle: ignored, no notification, same reference.
    controller.send({ type: "TRANSITION_DISPLAY_DONE" });
    expect(listener).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(idle);

    controller.send(ACCEPT);
    await flush();
    const awaiting = controller.getSnapshot();
    expect(awaiting.type).toBe("awaiting-stream-idle");
    const callsSoFar = listener.mock.calls.length;

    // STREAM_BECAME_IDLE for an unrelated chat: ignored.
    controller.send({ type: "STREAM_BECAME_IDLE", chatId: 999 });
    expect(controller.getSnapshot()).toBe(awaiting);
    expect(listener).toHaveBeenCalledTimes(callsSoFar);
  });
});
