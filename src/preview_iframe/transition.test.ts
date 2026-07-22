import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  exploreReachableStates,
} from "@/state_machines/testing";
import {
  INITIAL_PREVIEW_IFRAME_STATE,
  selectCanGoBack,
  selectCanGoForward,
  selectIframeSrc,
  type PreviewIframeEvent,
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
  { type: "RELOAD_REQUESTED" },
  { type: "IFRAME_REPLACED", reason: "external" },
  { type: "IFRAME_LOADED" },
  { type: "SELECTOR_READY" },
  { type: "PICKER_TOGGLED" },
  { type: "PICKER_DEACTIVATED" },
  { type: "SELECTION_RESTORE_QUEUED" },
  { type: "SELECTION_RESTORED" },
];

describe("preview iframe transition", () => {
  it("is total across the reachable identity, picker, and restore graph", () => {
    const states = exploreReachableStates({
      initialState: INITIAL_PREVIEW_IFRAME_STATE,
      events: (state) =>
        EVENTS.filter(
          (event) =>
            ((event.type !== "NAVIGATE" &&
              !(
                event.type === "NAVIGATED_IN_APP" && event.kind === "pushState"
              )) ||
              state.history.length < 3) &&
            (event.type !== "RELOAD_REQUESTED" || state.iframeEpoch < 2),
        ),
      transition,
      stateKey: JSON.stringify,
      maxStates: 5_000,
    });

    expect(states.some((state) => state.selectorReady)).toBe(true);
    expect(states.some((state) => state.picking)).toBe(true);
    expect(states.some((state) => state.restoreQueued)).toBe(true);

    for (const state of states) {
      for (const event of EVENTS) {
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
    expect(disabledToggle.ignoredReason).toBe("picker-not-ready");
  });

  it("deactivates an active picker and ignores repeated deactivation", () => {
    let state = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "SELECTOR_READY",
    }).state;
    state = transition(state, { type: "PICKER_TOGGLED" }).state;

    const deactivated = transition(state, { type: "PICKER_DEACTIVATED" });
    expect(deactivated.state.picking).toBe(false);
    expect(deactivated.commands).toEqual([
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
    expect(repeated.ignoredReason).toBe("picker-already-inactive");
  });

  it("queues one restore until readiness and clears only on completion", () => {
    const queued = transition(INITIAL_PREVIEW_IFRAME_STATE, {
      type: "SELECTION_RESTORE_QUEUED",
    });
    expect(queued.state.restoreQueued).toBe(true);
    expect(queued.commands).toEqual([]);

    const replaced = transition(queued.state, {
      type: "IFRAME_REPLACED",
      reason: "external",
    });
    expect(replaced.state.restoreQueued).toBe(true);

    const ready = transition(replaced.state, { type: "SELECTOR_READY" });
    expect(ready.state.restoreQueued).toBe(true);
    expect(ready.commands).toEqual([
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
    expect(replayed.ignoredReason).toBe("already-replaced");
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
});
