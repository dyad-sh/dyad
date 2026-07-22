import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { isStreamingByIdAtom } from "@/atoms/chatAtoms";

import {
  createPlanHandoffCommandRunner,
  type PlanHandoffDeps,
} from "./commands";
import type { HandoffEvent } from "./state";

/**
 * Exercises the real `watch-stream-idle` / `unwatch-stream-idle` adapter
 * against a vanilla Jotai store: the watcher must emit at most once, dispose
 * itself when it fires, and be fully disposed by `unwatch-stream-idle` so a
 * superseded handoff cannot leak a subscription or emit later.
 */
function setup() {
  const store = createStore();
  const deps: PlanHandoffDeps = {
    store,
    queryClient: {
      invalidateQueries: vi.fn(),
    } as unknown as PlanHandoffDeps["queryClient"],
    navigate: vi.fn(),
    chatStream: { submit: vi.fn() },
  };
  const run = createPlanHandoffCommandRunner(() => deps);
  const events: HandoffEvent[] = [];
  const emit = (event: HandoffEvent) => {
    events.push(event);
  };
  const setStreaming = (chatId: number, value: boolean) => {
    store.set(isStreamingByIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(chatId, value);
      return next;
    });
  };
  return { run, deps, events, emit, setStreaming };
}

describe("plan handoff commands — stream idle watcher", () => {
  it("submits implementation through the injected chat-stream facade", async () => {
    const { run, deps, events, emit } = setup();
    await run(
      { type: "start-implementation", chatId: 7, planSlug: "my-plan" },
      emit,
    );
    expect(deps.chatStream.submit).toHaveBeenCalledWith({
      chatId: 7,
      prompt: "/implement-plan=my-plan",
      selectedComponents: [],
    });
    expect(events).toContainEqual({ type: "IMPLEMENTATION_STARTED" });
  });

  it("emits immediately when the stream is already idle", async () => {
    const { run, events, emit } = setup();
    await run({ type: "watch-stream-idle", chatId: 7 }, emit);
    expect(events).toEqual([{ type: "STREAM_BECAME_IDLE", chatId: 7 }]);
  });

  it("emits once when the stream goes idle, then self-disposes", async () => {
    const { run, events, emit, setStreaming } = setup();
    setStreaming(7, true);

    await run({ type: "watch-stream-idle", chatId: 7 }, emit);
    expect(events).toEqual([]);

    setStreaming(7, false);
    expect(events).toEqual([{ type: "STREAM_BECAME_IDLE", chatId: 7 }]);

    // The watcher disposed itself: later idle flips emit nothing.
    setStreaming(7, true);
    setStreaming(7, false);
    expect(events).toHaveLength(1);
  });

  it("never emits after unwatch-stream-idle disposes the watcher", async () => {
    const { run, events, emit, setStreaming } = setup();
    setStreaming(7, true);

    await run({ type: "watch-stream-idle", chatId: 7 }, emit);
    await run({ type: "unwatch-stream-idle", chatId: 7 }, emit);

    setStreaming(7, false);
    expect(events).toEqual([]);
  });

  it("replaces an existing watcher for the same chat instead of stacking", async () => {
    const { run, events, emit, setStreaming } = setup();
    setStreaming(7, true);

    await run({ type: "watch-stream-idle", chatId: 7 }, emit);
    await run({ type: "watch-stream-idle", chatId: 7 }, emit);

    setStreaming(7, false);
    expect(events).toEqual([{ type: "STREAM_BECAME_IDLE", chatId: 7 }]);
  });

  it("only reacts to the watched chat's stream", async () => {
    const { run, events, emit, setStreaming } = setup();
    setStreaming(7, true);

    await run({ type: "watch-stream-idle", chatId: 7 }, emit);
    setStreaming(8, true);
    setStreaming(8, false);
    expect(events).toEqual([]);

    setStreaming(7, false);
    expect(events).toEqual([{ type: "STREAM_BECAME_IDLE", chatId: 7 }]);
  });
});
