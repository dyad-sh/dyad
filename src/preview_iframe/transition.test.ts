import { describe, expect, it } from "vitest";
import {
  assertAllCommandsProducible,
  assertAllStatesReachable,
  assertReferenceStability,
  commandsOf,
  exploreReachableStates,
  ignoreReasonOf,
} from "@/state_machines/testing";
import {
  INITIAL_PREVIEW_IFRAME_STATE,
  selectCanGoBack,
  selectCanGoForward,
  selectIframeSrc,
  type PreviewIframeEvent,
  type PreviewIframeCommand,
  type PreviewIframeState,
} from "./state";
import { transition } from "./transition";

const URL = "http://localhost:3000";
const EVENTS: readonly PreviewIframeEvent[] = [
  { type: "APP_URL_CHANGED", url: URL },
  { type: "NAVIGATE", path: `${URL}/settings` },
  { type: "NAVIGATED_IN_APP", kind: "pushState", url: `${URL}/profile` },
  {
    type: "NAVIGATED_IN_APP",
    kind: "replaceState",
    url: `${URL}/account`,
  },
  { type: "GO_BACK" },
  { type: "GO_FORWARD" },
  { type: "RUNTIME_RESTARTED" },
  { type: "RELOAD_REQUESTED" },
  { type: "IFRAME_REPLACED", reason: "external" },
  { type: "IFRAME_LOADED" },
  { type: "SELECTOR_READY" },
  { type: "PICKER_TOGGLED" },
  { type: "PICKER_DEACTIVATED" },
  { type: "SELECTION_RESTORE_QUEUED" },
  { type: "SELECTION_RESTORED" },
];
const ERROR_EVENTS: readonly PreviewIframeEvent[] = [
  { type: "IFRAME_ERROR", message: "iframe failed", source: "preview-app" },
  { type: "IFRAME_ERROR", message: "sandbox failed", source: "dyad-app" },
  { type: "SYNC_ERROR", message: "sync failed" },
  { type: "SYNC_RECOVERED" },
  { type: "APP_ERROR", message: "run failed" },
  { type: "APP_ERROR_CLEARED" },
  { type: "DISMISS" },
];
const ALL_EVENTS = [...EVENTS, ...ERROR_EVENTS];
type PreviewIframeStateKind =
  | "empty"
  | "navigated"
  | "selector-ready"
  | "picking"
  | "restore-queued";
const STATE_KINDS = [
  "empty",
  "navigated",
  "selector-ready",
  "picking",
  "restore-queued",
] as const satisfies readonly PreviewIframeStateKind[];
const COMMAND_KINDS = [
  "post-to-iframe",
] as const satisfies readonly PreviewIframeCommand["type"][];

function stateKind(state: PreviewIframeState): PreviewIframeStateKind {
  if (state.restoreQueued) return "restore-queued";
  if (state.picking) return "picking";
  if (state.selectorReady) return "selector-ready";
  if (state.currentUrl !== null) return "navigated";
  return "empty";
}

function boundedEvents(state: PreviewIframeState): PreviewIframeEvent[] {
  return EVENTS.filter(
    (event) =>
      ((event.type !== "NAVIGATE" &&
        !(event.type === "NAVIGATED_IN_APP" && event.kind === "pushState")) ||
        state.history.length < 3) &&
      (event.type !== "RELOAD_REQUESTED" || state.iframeEpoch < 2),
  );
}

describe("preview iframe transition", () => {
  it("restores transferable browser history and navigates the recreated iframe", () => {
    const result = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "RESTORE_PRESENTATION",
      history: [URL, `${URL}/settings`],
      position: 1,
    });

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.state.history).toEqual([URL, `${URL}/settings`]);
    expect(result.state.currentUrl).toBe(`${URL}/settings`);
    expect(result.commands).toEqual([
      {
        type: "post-to-iframe",
        message: {
          type: "navigate",
          payload: { url: `${URL}/settings`, direction: undefined },
        },
      },
    ]);
  });
  it("reaches every state aspect and produces every command kind", () => {
    const options = {
      initialState: INITIAL_PREVIEW_IFRAME_STATE,
      events: boundedEvents,
      transition,
      stateKey: JSON.stringify,
      maxStates: 5_000,
    };
    assertAllStatesReachable({
      ...options,
      inventory: STATE_KINDS,
      stateKind,
    });
    assertAllCommandsProducible({
      ...options,
      inventory: COMMAND_KINDS,
      commandKind: (command) => command.type,
    });
  });

  it("is total across the reachable identity, picker, and restore graph", () => {
    const graph = exploreReachableStates({
      initialState: INITIAL_PREVIEW_IFRAME_STATE,
      events: boundedEvents,
      transition,
      stateKey: JSON.stringify,
      maxStates: 5_000,
    });
    const states = graph.nodes.map(({ state }) => state);

    expect(states.some((state) => state.selectorReady)).toBe(true);
    expect(states.some((state) => state.picking)).toBe(true);
    expect(states.some((state) => state.restoreQueued)).toBe(true);

    for (const state of states) {
      for (const event of ALL_EVENTS) {
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

  it("drops picking and readiness on reload until the selector is ready", () => {
    let state = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "APP_URL_CHANGED",
      url: URL,
    }).state;
    state = transition(state, { type: "SELECTOR_READY" }).state;
    state = transition(state, { type: "PICKER_TOGGLED" }).state;
    expect(state.picking).toBe(true);

    const reloaded = transition(state, { type: "RELOAD_REQUESTED" });
    expect(reloaded.state).toMatchObject({
      iframeEpoch: 1,
      selectorReady: false,
      picking: false,
    });
    const disabledToggle = transition(reloaded.state, {
      type: "PICKER_TOGGLED",
    });
    expect(disabledToggle.state).toBe(reloaded.state);
    expect(ignoreReasonOf(disabledToggle)).toBe("picker-not-ready");
  });

  it("returns to the fresh app root after a runtime restart", () => {
    let state = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "APP_URL_CHANGED",
      url: URL,
    }).state;
    state = transition(state, {
      type: "NAVIGATED_IN_APP",
      kind: "pushState",
      url: `${URL}/about`,
    }).state;

    const restarted = transition(state, { type: "RUNTIME_RESTARTED" });
    expect(restarted.state).toMatchObject({
      history: [],
      position: 0,
      currentUrl: null,
      preservedUrl: null,
      selectorReady: false,
      picking: false,
    });

    const ready = transition(restarted.state, {
      type: "APP_URL_CHANGED",
      url: URL,
    });
    expect(ready.state).toMatchObject({
      history: [URL],
      position: 0,
      currentUrl: URL,
      preservedUrl: URL,
    });
  });

  it("deactivates an active picker and ignores repeated deactivation", () => {
    let state = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "SELECTOR_READY",
    }).state;
    state = transition(state, { type: "PICKER_TOGGLED" }).state;

    const deactivated = transition(state, { type: "PICKER_DEACTIVATED" });
    expect(deactivated.state.picking).toBe(false);
    expect(commandsOf(deactivated)).toEqual([
      {
        type: "post-to-iframe",
        message: { type: "cleanup-all-text-editing" },
      },
      {
        type: "post-to-iframe",
        message: { type: "deactivate-dyad-component-selector" },
      },
    ]);

    const repeated = transition(deactivated.state, {
      type: "PICKER_DEACTIVATED",
    });
    expect(repeated.state).toBe(deactivated.state);
    expect(ignoreReasonOf(repeated)).toBe("picker-already-inactive");
  });

  it("queues one restore until readiness and clears only on completion", () => {
    const queued = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "SELECTION_RESTORE_QUEUED",
    });
    expect(queued.state.restoreQueued).toBe(true);
    expect(commandsOf(queued)).toEqual([]);

    const replaced = transition(queued.state, {
      type: "IFRAME_REPLACED",
      reason: "external",
    });
    expect(replaced.state.restoreQueued).toBe(true);

    const ready = transition(replaced.state, { type: "SELECTOR_READY" });
    expect(ready.state.restoreQueued).toBe(true);
    expect(commandsOf(ready)).toEqual([
      { type: "post-to-iframe", message: { type: "restore-overlays" } },
    ]);
    expect(
      transition(ready.state, { type: "IFRAME_LOADED" }).state.restoreQueued,
    ).toBe(true);
    expect(
      transition(ready.state, { type: "SELECTION_RESTORED" }).state
        .restoreQueued,
    ).toBe(false);
  });

  it("records an external replacement without replacing the new iframe again", () => {
    const state: PreviewIframeState = {
      ...INITIAL_PREVIEW_IFRAME_STATE,
      history: [URL, `${URL}/settings`],
      position: 1,
      currentUrl: `${URL}/settings`,
      preservedUrl: `${URL}/settings`,
      iframeEpoch: 4,
      selectorReady: true,
      picking: true,
    };

    const replaced = transition(state, {
      type: "IFRAME_REPLACED",
      reason: "external",
    });
    expect(replaced.state).toMatchObject({
      history: [`${URL}/settings`],
      position: 0,
      iframeEpoch: 4,
      selectorReady: false,
      picking: false,
    });
    const replayed = transition(replaced.state, {
      type: "IFRAME_REPLACED",
      reason: "external",
    });
    expect(replayed.state).toBe(replaced.state);
    expect(ignoreReasonOf(replayed)).toBe("already-replaced");
  });

  it("uses the trusted app URL when preserved navigation is cross-origin", () => {
    const state: PreviewIframeState = {
      ...INITIAL_PREVIEW_IFRAME_STATE,
      history: ["https://untrusted.example/path"],
      currentUrl: "https://untrusted.example/path",
      preservedUrl: "https://untrusted.example/path",
    };
    expect(selectIframeSrc(state, URL)).toBe(URL);
  });

  it("derives browser navigation availability from history and position", () => {
    const state: PreviewIframeState = {
      ...INITIAL_PREVIEW_IFRAME_STATE,
      history: [URL, `${URL}/one`, `${URL}/two`],
      position: 1,
    };
    expect(selectCanGoBack(state)).toBe(true);
    expect(selectCanGoForward(state)).toBe(true);
  });

  it("keeps higher-priority iframe and app errors ahead of sync errors", () => {
    for (const source of ["preview-app", "dyad-app"] as const) {
      const errored = transition(INITIAL_PREVIEW_IFRAME_STATE, {
        type: "IFRAME_ERROR",
        message: `${source} failed`,
        source,
      });
      const sync = transition(errored.state, {
        type: "SYNC_ERROR",
        message: "sync failed",
      });
      expect(sync.state).toBe(errored.state);
      expect(ignoreReasonOf(sync)).toBe("higher-priority-error");
    }
  });

  it("only clears sync-owned errors on recovery and dismisses any source", () => {
    const appError = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "APP_ERROR",
      message: "run failed",
    });
    expect(transition(appError.state, { type: "SYNC_RECOVERED" }).state).toBe(
      appError.state,
    );
    expect(transition(appError.state, { type: "DISMISS" }).state.error).toBe(
      undefined,
    );

    const syncError = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "SYNC_ERROR",
      message: "sync failed",
    });
    expect(
      transition(syncError.state, { type: "SYNC_RECOVERED" }).state.error,
    ).toBeUndefined();
  });

  it("serializes app-run sets and iframe clears by event arrival", () => {
    const clearedBeforeSet = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "IFRAME_LOADED",
    });
    const setAfterClear = transition(clearedBeforeSet.state, {
      type: "APP_ERROR",
      message: "late run failure",
    });
    expect(setAfterClear.state.error?.message).toBe("late run failure");

    const setBeforeClear = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "APP_ERROR",
      message: "early run failure",
    });
    expect(
      transition(setBeforeClear.state, { type: "IFRAME_LOADED" }).state.error,
    ).toBeUndefined();
  });
});
