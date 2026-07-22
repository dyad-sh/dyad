import { describe, expect, it } from "vitest";

import type {
  HandoffCommand,
  HandoffEvent,
  HandoffSession,
  HandoffState,
  PersistedHandoffSession,
  ReadyHandoffSession,
} from "./state";
import { TRANSITION_DISPLAY_MS, transition } from "./transition";

const session: HandoffSession = { chatId: 1, appId: 10, acceptInNewChat: true };
const persistedSession: PersistedHandoffSession = {
  ...session,
  planSlug: "slug",
};
const readySession: ReadyHandoffSession = {
  ...persistedSession,
  implementationChatId: 2,
};

const STATE_TYPES = [
  "idle",
  "cancelling-stream",
  "transitioning",
  "persisting",
  "preparing-chat",
  "awaiting-stream-idle",
  "implementing",
  "failed",
] as const;

/** One representative instance per state type — the full state axis. */
const ALL_STATES: HandoffState[] = [
  { type: "idle" },
  { type: "cancelling-stream", session },
  { type: "transitioning", session },
  { type: "persisting", session },
  { type: "preparing-chat", session: persistedSession },
  { type: "awaiting-stream-idle", session: readySession },
  { type: "implementing", session: readySession },
  { type: "failed", session, failure: "persist-plan", error: "boom" },
];

/** One representative instance per event type — the full event axis. */
const ALL_EVENTS: HandoffEvent[] = [
  { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: true },
  { type: "STREAM_CANCEL_FINISHED" },
  { type: "TRANSITION_DISPLAY_DONE" },
  { type: "PLAN_PERSISTED", planSlug: "slug" },
  { type: "PLAN_DATA_MISSING" },
  { type: "PLAN_PERSIST_FAILED", error: "disk full" },
  { type: "CHAT_READY", implementationChatId: 2 },
  { type: "CHAT_PREPARE_FAILED", error: "create failed" },
  { type: "STREAM_BECAME_IDLE", chatId: 2 },
  { type: "STREAM_BECAME_IDLE", chatId: 99 },
  { type: "IMPLEMENTATION_STARTED" },
];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function sessionOf(
  state: HandoffState,
): (HandoffSession & Partial<ReadyHandoffSession>) | undefined {
  return state.type === "idle" ? undefined : state.session;
}

/** Run a scripted event sequence from idle, collecting every emitted command. */
function drive(events: HandoffEvent[]): {
  state: HandoffState;
  commands: HandoffCommand[];
} {
  let state: HandoffState = { type: "idle" };
  const commands: HandoffCommand[] = [];
  for (const event of events) {
    const result = transition(deepFreeze(state), deepFreeze(event));
    state = result.state;
    commands.push(...result.commands);
  }
  return { state, commands };
}

const NEW_CHAT_HAPPY_PATH: HandoffEvent[] = [
  { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: true },
  { type: "STREAM_CANCEL_FINISHED" },
  { type: "TRANSITION_DISPLAY_DONE" },
  { type: "PLAN_PERSISTED", planSlug: "slug" },
  { type: "CHAT_READY", implementationChatId: 2 },
  { type: "STREAM_BECAME_IDLE", chatId: 2 },
  { type: "IMPLEMENTATION_STARTED" },
];

describe("plan handoff transition — totality over state × event", () => {
  it("handles every state/event pair without throwing or mutating inputs", () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        // deepFreeze turns any mutation attempt into a TypeError.
        const result = transition(deepFreeze(state), deepFreeze(event));
        expect(STATE_TYPES).toContain(result.state.type);
        expect(Array.isArray(result.commands)).toBe(true);
      }
    }
  });

  it("returns the same state reference with no commands when ignoring", () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const result = transition(state, event);
        if (result.state === state) {
          expect(result.commands).toEqual([]);
          expect(result.ignoredReason).toBeTruthy();
        }
      }
    }
  });

  it("never fires start-implementation outside awaiting-stream-idle + matching STREAM_BECAME_IDLE", () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const result = transition(state, event);
        const fires = result.commands.some(
          (c) => c.type === "start-implementation",
        );
        if (fires) {
          expect(state.type).toBe("awaiting-stream-idle");
          expect(event).toMatchObject({
            type: "STREAM_BECAME_IDLE",
            chatId: sessionOf(state)?.implementationChatId,
          });
        }
      }
    }
  });

  it("keeps the session chatId immutable across every transition", () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const result = transition(state, event);
        const before = sessionOf(state);
        const after = sessionOf(result.state);
        // A session may be replaced by a fresh accept (from idle/failed, or
        // superseding a stalled awaiting-stream-idle), but an in-flight
        // session's chatId never changes otherwise.
        if (
          before &&
          after &&
          state.type !== "idle" &&
          state.type !== "failed" &&
          event.type !== "PLAN_ACCEPTED"
        ) {
          expect(after.chatId).toBe(before.chatId);
          if (before.implementationChatId !== undefined) {
            expect(after.implementationChatId).toBe(
              before.implementationChatId,
            );
          }
        }
      }
    }
  });

  it("fires the implementation at most once per accepted plan (fuzzed walks)", () => {
    // Deterministic PRNG (mulberry32) so failures are reproducible.
    const rand = (seed: number) => () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let seed = 1; seed <= 200; seed++) {
      const next = rand(seed);
      let state: HandoffState = { type: "idle" };
      let accepts = 0;
      let starts = 0;
      for (let i = 0; i < 60; i++) {
        const event = ALL_EVENTS[Math.floor(next() * ALL_EVENTS.length)];
        const result = transition(state, event);
        if (
          result.state.type === "cancelling-stream" &&
          state.type !== "cancelling-stream"
        ) {
          accepts++;
        }
        starts += result.commands.filter(
          (c) => c.type === "start-implementation",
        ).length;
        state = result.state;
      }
      expect(starts).toBeLessThanOrEqual(accepts);
    }
  });
});

describe("plan handoff transition — scenarios", () => {
  it("keeps the legacy 2.5s transition display duration", () => {
    expect(TRANSITION_DISPLAY_MS).toBe(2500);
  });

  it("runs the accept-in-new-chat path in the legacy order", () => {
    const { state, commands } = drive(NEW_CHAT_HAPPY_PATH);
    expect(state).toEqual({ type: "idle" });
    expect(commands.map((c) => c.type)).toEqual([
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
    expect(commands).toContainEqual({
      type: "navigate-to-chat",
      chatId: 2,
      appId: 10,
    });
    expect(commands).toContainEqual({
      type: "start-implementation",
      chatId: 2,
      planSlug: "slug",
    });
    expect(commands).toContainEqual({
      type: "wait",
      ms: TRANSITION_DISPLAY_MS,
    });
  });

  it("runs the continue-in-current-chat path without creating or navigating", () => {
    const { state, commands } = drive([
      { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: false },
      { type: "STREAM_CANCEL_FINISHED" },
      { type: "TRANSITION_DISPLAY_DONE" },
      { type: "PLAN_PERSISTED", planSlug: "slug" },
      { type: "CHAT_READY", implementationChatId: 1 },
      { type: "STREAM_BECAME_IDLE", chatId: 1 },
      { type: "IMPLEMENTATION_STARTED" },
    ]);
    expect(state).toEqual({ type: "idle" });
    const types = commands.map((c) => c.type);
    expect(types).toContain("switch-chat-mode");
    expect(types).not.toContain("create-chat");
    expect(types).not.toContain("navigate-to-chat");
    expect(commands).toContainEqual({
      type: "start-implementation",
      chatId: 1,
      planSlug: "slug",
    });
  });

  it("ignores a second PLAN_ACCEPTED in every bounded pipeline state", () => {
    for (let cut = 1; cut < NEW_CHAT_HAPPY_PATH.length; cut++) {
      let state: HandoffState = { type: "idle" };
      for (const event of NEW_CHAT_HAPPY_PATH.slice(0, cut)) {
        state = transition(state, event).state;
      }
      if (state.type === "awaiting-stream-idle") {
        // Unbounded wait on an external condition: a fresh accept supersedes
        // it instead (covered by the dedicated test below).
        continue;
      }
      const result = transition(state, {
        type: "PLAN_ACCEPTED",
        chatId: 1,
        appId: 10,
        acceptInNewChat: true,
      });
      expect(result.state).toBe(state);
      expect(result.commands).toEqual([]);
    }
  });

  it("lets a fresh PLAN_ACCEPTED supersede a stalled awaiting-stream-idle, disposing the watcher", () => {
    const state: HandoffState = {
      type: "awaiting-stream-idle",
      session: readySession,
    };
    const result = transition(state, {
      type: "PLAN_ACCEPTED",
      chatId: 1,
      appId: 10,
      acceptInNewChat: false,
    });
    expect(result.state).toMatchObject({
      type: "cancelling-stream",
      session: { chatId: 1, appId: 10, acceptInNewChat: false },
    });
    // The stuck watcher is disposed before the new handoff starts.
    expect(result.commands.map((c) => c.type)).toEqual([
      "unwatch-stream-idle",
      "mark-plan-accepted",
      "cancel-stream",
    ]);
    expect(result.commands[0]).toEqual({
      type: "unwatch-stream-idle",
      chatId: readySession.implementationChatId,
    });
  });

  it("ignores STREAM_BECAME_IDLE for other chats while awaiting idle", () => {
    const state: HandoffState = {
      type: "awaiting-stream-idle",
      session: readySession,
    };
    const result = transition(state, {
      type: "STREAM_BECAME_IDLE",
      chatId: 99,
    });
    expect(result.state).toBe(state);
    expect(result.commands).toEqual([]);
  });

  it("fails like the legacy saga when the plan cannot be persisted", () => {
    const { state, commands } = drive([
      { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: true },
      { type: "STREAM_CANCEL_FINISHED" },
      { type: "TRANSITION_DISPLAY_DONE" },
      { type: "PLAN_PERSIST_FAILED", error: "disk full" },
    ]);
    expect(state).toMatchObject({
      type: "failed",
      failure: "persist-plan",
      error: "disk full",
    });
    expect(commands).toContainEqual({
      type: "notify-failure",
      failure: "persist-plan",
      error: "disk full",
    });
    // The preview mode was already restored before the failure, as in legacy.
    expect(commands.map((c) => c.type)).toContain("set-preview-mode");
  });

  it("fails silently-but-logged when plan data is missing", () => {
    const { state, commands } = drive([
      { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: true },
      { type: "STREAM_CANCEL_FINISHED" },
      { type: "TRANSITION_DISPLAY_DONE" },
      { type: "PLAN_DATA_MISSING" },
    ]);
    expect(state).toMatchObject({
      type: "failed",
      failure: "missing-plan-data",
    });
    expect(commands).toContainEqual({
      type: "notify-failure",
      failure: "missing-plan-data",
    });
  });

  it("fails when the implementation chat cannot be prepared", () => {
    const { state, commands } = drive([
      { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: true },
      { type: "STREAM_CANCEL_FINISHED" },
      { type: "TRANSITION_DISPLAY_DONE" },
      { type: "PLAN_PERSISTED", planSlug: "slug" },
      { type: "CHAT_PREPARE_FAILED", error: "create failed" },
    ]);
    expect(state).toMatchObject({ type: "failed", failure: "prepare-chat" });
    expect(commands).toContainEqual({
      type: "notify-failure",
      failure: "prepare-chat",
      error: "create failed",
    });
    expect(commands.map((c) => c.type)).not.toContain("start-implementation");
  });

  it("recovers from failed on a fresh PLAN_ACCEPTED", () => {
    const failed = drive([
      { type: "PLAN_ACCEPTED", chatId: 1, appId: 10, acceptInNewChat: true },
      { type: "STREAM_CANCEL_FINISHED" },
      { type: "TRANSITION_DISPLAY_DONE" },
      { type: "PLAN_PERSIST_FAILED", error: "disk full" },
    ]).state;
    const result = transition(failed, {
      type: "PLAN_ACCEPTED",
      chatId: 1,
      appId: 10,
      acceptInNewChat: false,
    });
    expect(result.state).toMatchObject({
      type: "cancelling-stream",
      session: { chatId: 1, appId: 10, acceptInNewChat: false },
    });
    expect(result.commands.map((c) => c.type)).toEqual([
      "mark-plan-accepted",
      "cancel-stream",
    ]);
  });
});
