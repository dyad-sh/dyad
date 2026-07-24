import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  assertAllCommandsProducible,
  assertAllStatesReachable,
  commandsOf,
  exploreReachableStates,
  ignoreReasonOf,
} from "@/state_machines/testing";
import type {
  FirstPromptEvent,
  FirstPromptCommand,
  FirstPromptPayload,
  FirstPromptState,
} from "./state";
import { transition } from "./transition";

const payload: FirstPromptPayload = {
  prompt: "Build a notes app",
  attachments: [],
  chatMode: "build",
  isChatModeExplicit: false,
};

const events: readonly FirstPromptEvent[] = [
  { type: "SUBMIT", payload },
  {
    type: "SUBMIT",
    payload: { ...payload, selectedApp: { id: 1, name: "Existing" } },
  },
  { type: "ARM_FOR_SETUP", payload },
  { type: "DISARM" },
  { type: "PROVIDERS_LOADED", anySetup: false },
  { type: "PROVIDERS_LOADED", anySetup: true },
  { type: "PROVIDER_CHECK_TIMED_OUT" },
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
  { type: "PREVIEW_DECISION_FAILED", message: "preview failed" },
  { type: "REFRESHED" },
  { type: "REFRESH_FAILED", message: "refresh failed" },
  { type: "RETRY" },
  { type: "RESET" },
];
const STATE_KINDS = [
  "idle",
  "checkingProviders",
  "awaitingProviderSetup",
  "creating",
  "postCreate",
  "dispatching",
  "navigating",
  "failed",
  "failedPartial",
] as const satisfies readonly FirstPromptState["type"][];
const COMMAND_KINDS = [
  "ScheduleProviderCheckTimeout",
  "CancelProviderCheckTimeout",
  "CreateApp",
  "CreateChat",
  "RunNeonTemplateHook",
  "ApplyTheme",
  "OpenPreviewIfSetupRequired",
  "SubmitPrompt",
  "ScheduleSettle",
  "RefreshQueries",
  "NavigateHome",
  "SelectChat",
  "ShowSetupDialog",
  "ClearEditingBuffer",
  "ShowError",
] as const satisfies readonly FirstPromptCommand["type"][];

describe("first-prompt transition", () => {
  it("reaches every state and produces every command kind", () => {
    const options = {
      initialState: { type: "idle" } as FirstPromptState,
      events,
      transition,
      stateKey: JSON.stringify,
    };
    assertAllStatesReachable({
      ...options,
      inventory: STATE_KINDS,
      stateKind: (state) => state.type,
    });
    assertAllCommandsProducible({
      ...options,
      inventory: COMMAND_KINDS,
      commandKind: (command) => command.type,
    });
  });

  it("explores every reachable phase, including failedPartial, and is total", () => {
    const graph = exploreReachableStates({
      initialState: { type: "idle" } as FirstPromptState,
      events,
      transition,
      stateKey: (state) => JSON.stringify(state),
    });
    const states = graph.nodes.map(({ state }) => state);

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
    expect(commandsOf(result)).toEqual([]);
    expect(ignoreReasonOf(result)).toBe("submission-in-flight");
  });

  it("ignores provider completion outside provider-check/setup states", () => {
    const idle: FirstPromptState = { type: "idle" };
    const result = transition(idle, { type: "PROVIDER_CONFIGURED" });

    expect(result.state).toBe(idle);
    expect(ignoreReasonOf(result)).toBe("not-awaiting-setup");
  });

  it.each(["checkingProviders", "awaitingProviderSetup"] as const)(
    "disarms an empty payload when provider setup completes from %s",
    (type) => {
      const emptyPayload: FirstPromptPayload = {
        prompt: "   ",
        attachments: [],
        isChatModeExplicit: false,
      };
      const state: FirstPromptState =
        type === "awaitingProviderSetup"
          ? { type, payload: emptyPayload, reason: "missing-provider" }
          : { type, payload: emptyPayload };

      const result = transition(state, { type: "PROVIDER_CONFIGURED" });

      expect(result).toEqual({
        kind: "applied",
        state: { type: "idle" },
        commands:
          type === "checkingProviders"
            ? [{ type: "CancelProviderCheckTimeout" }]
            : [],
      });
    },
  );

  it("recomputes an implicit chat mode when provider setup changes the default", () => {
    const state: FirstPromptState = {
      type: "awaitingProviderSetup",
      payload,
      reason: "missing-provider",
    };

    const result = transition(state, {
      type: "PROVIDER_CONFIGURED",
      defaultChatMode: "local-agent",
    });

    expect(result.state).toEqual({
      type: "creating",
      payload: { ...payload, chatMode: "local-agent" },
    });
    expect(commandsOf(result)).toEqual([
      { type: "NavigateHome" },
      {
        type: "CreateApp",
        payload: { ...payload, chatMode: "local-agent" },
      },
    ]);
  });

  it("preserves an explicitly selected chat mode after provider setup", () => {
    const explicitPayload: FirstPromptPayload = {
      ...payload,
      chatMode: "plan",
      isChatModeExplicit: true,
    };
    const state: FirstPromptState = {
      type: "awaitingProviderSetup",
      payload: explicitPayload,
      reason: "missing-provider",
    };

    const result = transition(state, {
      type: "PROVIDER_CONFIGURED",
      defaultChatMode: "local-agent",
    });

    expect(result.state).toEqual({
      type: "creating",
      payload: explicitPayload,
    });
  });

  it("falls back to provider setup when provider detection times out", () => {
    const state: FirstPromptState = { type: "checkingProviders", payload };

    expect(transition(state, { type: "PROVIDER_CHECK_TIMED_OUT" })).toEqual({
      kind: "applied",
      state: {
        type: "awaitingProviderSetup",
        payload,
        reason: "provider-check-timeout",
      },
      commands: [{ type: "ShowSetupDialog" }],
    });
  });

  it("starts fresh when a partial-failure resubmit targets another app", () => {
    const state: FirstPromptState = {
      type: "failedPartial",
      payload,
      appId: 1,
      appName: "Orphaned app",
      chatId: 2,
      message: "Theme failed",
      step: "theme",
    };
    const retargetedPayload: FirstPromptPayload = {
      ...payload,
      selectedApp: { id: 41, name: "Existing app" },
    };

    expect(
      transition(state, { type: "SUBMIT", payload: retargetedPayload }),
    ).toEqual({
      kind: "applied",
      state: { type: "checkingProviders", payload: retargetedPayload },
      commands: [{ type: "ScheduleProviderCheckTimeout" }],
    });
  });
});
