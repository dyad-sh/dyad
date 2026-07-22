import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  exploreReachableStates,
} from "@/state_machines/testing";
import type {
  FirstPromptEvent,
  FirstPromptPayload,
  FirstPromptState,
} from "./state";
import { transition } from "./transition";

const payload: FirstPromptPayload = {
  prompt: "Build a notes app",
  attachments: [],
  chatMode: "build",
};

const events: readonly FirstPromptEvent[] = [
  { type: "SUBMIT", payload },
  { type: "ARM_FOR_SETUP", payload },
  { type: "DISARM" },
  { type: "PROVIDERS_LOADED", anySetup: false },
  { type: "PROVIDERS_LOADED", anySetup: true },
  { type: "PROVIDER_CONFIGURED" },
  { type: "SETUP_DISMISSED" },
  { type: "APP_CREATED", appId: 1, appName: "Notes", chatId: 2 },
  { type: "CHAT_CREATED", chatId: 2 },
  { type: "CREATE_FAILED", message: "create failed" },
  { type: "NEON_HOOK_DONE" },
  { type: "POST_CREATE_DONE" },
  { type: "POST_CREATE_FAILED", message: "hook failed" },
  { type: "SETTLED" },
  { type: "PREVIEW_DECISION", opened: false },
  { type: "REFRESHED" },
  { type: "RETRY" },
  { type: "RESET" },
];

describe("first-prompt transition", () => {
  it("explores every reachable phase, including failedPartial, and is total", () => {
    const states = exploreReachableStates({
      initialState: { type: "idle" } as FirstPromptState,
      events,
      transition,
      stateKey: (state) => JSON.stringify(state),
    });

    expect([...new Set(states.map((state) => state.type))].sort()).toEqual(
      [
        "awaitingProviderSetup",
        "checkingProviders",
        "creating",
        "dispatching",
        "failed",
        "failedPartial",
        "idle",
        "navigating",
        "postCreate",
      ].sort(),
    );

    for (const state of states) {
      for (const event of events) {
        const result = transition(state, event);
        expect(result).toBeDefined();
        assertReferenceStability(
          state,
          result,
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );
      }
    }
  });

  it("ignores a second submission while one is in flight", () => {
    const checking: FirstPromptState = { type: "checkingProviders", payload };
    const result = transition(checking, { type: "SUBMIT", payload });

    expect(result.state).toBe(checking);
    expect(result.commands).toEqual([]);
    expect(result.ignoredReason).toBe("submission-in-flight");
  });

  it("ignores provider completion outside provider-check/setup states", () => {
    const idle: FirstPromptState = { type: "idle" };
    const result = transition(idle, { type: "PROVIDER_CONFIGURED" });

    expect(result.state).toBe(idle);
    expect(result.ignoredReason).toBe("not-awaiting-setup");
  });
});
