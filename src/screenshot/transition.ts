import { ignore, type TransitionResult } from "@/state_machines/types";
import type {
  ScreenshotCaptureSource,
  ScreenshotCommand,
  ScreenshotEvent,
  ScreenshotIgnoreReason,
  ScreenshotState,
} from "./state";

type Result = TransitionResult<
  ScreenshotState,
  ScreenshotCommand,
  ScreenshotIgnoreReason
>;

function transitionTo(
  state: ScreenshotState,
  commands: readonly ScreenshotCommand[] = [],
): Result {
  return { state, commands };
}

function startSettling(
  state: ScreenshotState,
  source: ScreenshotCaptureSource,
): Result {
  return transitionTo(
    {
      ...state,
      status: "settling",
      source,
      queuedSource: null,
    },
    [{ type: "schedule-settle" }],
  );
}

function waitForIframe(
  state: ScreenshotState,
  source: ScreenshotCaptureSource,
): Result {
  const iframeLoaded = state.iframeLoaded;
  return transitionTo(
    {
      ...state,
      status: iframeLoaded ? "waitingSelectorReady" : "pending",
      source,
      queuedSource: null,
    },
    iframeLoaded ? [{ type: "schedule-settle" }] : [],
  );
}

function finishCapture(state: ScreenshotState): Result {
  const source = state.queuedSource;
  if (source !== null) {
    return state.selectorReady
      ? startSettling(state, source)
      : waitForIframe(state, source);
  }
  return transitionTo({
    status: "idle",
    fallbackChecked: state.fallbackChecked,
    iframeLoaded: state.iframeLoaded,
    selectorReady: state.selectorReady,
    queuedSource: null,
  });
}

function captureRequested(
  state: ScreenshotState,
  source: ScreenshotCaptureSource,
): Result {
  switch (state.status) {
    case "idle":
      return state.selectorReady
        ? startSettling(state, source)
        : waitForIframe(state, source);
    case "pending":
      if (
        !state.selectorReady &&
        state.source === source &&
        state.queuedSource === null
      ) {
        return ignore(state, "request-already-current");
      }
      return state.selectorReady
        ? startSettling(state, source)
        : waitForIframe(state, source);
    case "waitingSelectorReady":
      if (state.source === source) {
        return ignore(state, "request-already-current");
      }
      return transitionTo({ ...state, source });
    case "settling":
      if (state.source === source) {
        return ignore(state, "request-already-current");
      }
      return transitionTo({ ...state, source });
    case "resolvingCommit":
    case "awaitingResponse":
    case "saving":
      if (state.queuedSource === source) {
        return ignore(state, "request-already-current");
      }
      return transitionTo({ ...state, queuedSource: source });
    default:
      return assertNever(state);
  }
}

function iframeLoaded(state: ScreenshotState): Result {
  switch (state.status) {
    case "idle":
      if (state.iframeLoaded && !state.selectorReady) {
        return ignore(state, "already-loaded");
      }
      return transitionTo({
        ...state,
        iframeLoaded: true,
        selectorReady: false,
      });
    case "pending":
      return transitionTo(
        {
          ...state,
          status: "waitingSelectorReady",
          iframeLoaded: true,
          selectorReady: false,
        },
        [{ type: "schedule-settle" }],
      );
    case "waitingSelectorReady":
      if (state.iframeLoaded && !state.selectorReady) {
        return ignore(state, "already-loaded");
      }
      return transitionTo(
        {
          ...state,
          status: "waitingSelectorReady",
          iframeLoaded: true,
          selectorReady: false,
        },
        [{ type: "schedule-settle" }],
      );
    case "settling":
      return transitionTo(
        {
          ...state,
          status: "waitingSelectorReady",
          iframeLoaded: true,
          selectorReady: false,
        },
        [{ type: "schedule-settle" }],
      );
    case "resolvingCommit":
    case "awaitingResponse":
      return transitionTo(
        {
          ...state,
          status: "waitingSelectorReady",
          source: state.queuedSource ?? state.source,
          queuedSource: null,
          iframeLoaded: true,
          selectorReady: false,
        },
        [{ type: "schedule-settle" }],
      );
    case "saving":
      if (state.iframeLoaded && !state.selectorReady) {
        return ignore(state, "already-loaded");
      }
      return transitionTo({
        ...state,
        iframeLoaded: true,
        selectorReady: false,
      });
    default:
      return assertNever(state);
  }
}

function selectorReady(state: ScreenshotState): Result {
  switch (state.status) {
    case "idle":
      if (state.selectorReady && state.fallbackChecked) {
        return ignore(state, "already-ready");
      }
      return transitionTo(
        {
          ...state,
          iframeLoaded: true,
          selectorReady: true,
          fallbackChecked: true,
        },
        state.fallbackChecked ? [] : [{ type: "check-existing-screenshots" }],
      );
    case "pending":
      return startSettling(
        { ...state, iframeLoaded: true, selectorReady: true },
        state.source,
      );
    case "waitingSelectorReady":
      return transitionTo({
        ...state,
        status: "settling",
        iframeLoaded: true,
        selectorReady: true,
      });
    case "settling":
    case "resolvingCommit":
    case "awaitingResponse":
    case "saving":
      if (state.selectorReady) return ignore(state, "already-ready");
      return transitionTo({
        ...state,
        iframeLoaded: true,
        selectorReady: true,
      });
    default:
      return assertNever(state);
  }
}

function appHidden(state: ScreenshotState): Result {
  switch (state.status) {
    case "idle":
      if (!state.iframeLoaded && !state.selectorReady) {
        return ignore(state, "already-hidden");
      }
      return transitionTo({
        ...state,
        iframeLoaded: false,
        selectorReady: false,
      });
    case "pending":
      if (!state.iframeLoaded && !state.selectorReady) {
        return ignore(state, "already-hidden");
      }
      return transitionTo({
        ...state,
        status: "pending",
        iframeLoaded: false,
        selectorReady: false,
      });
    case "waitingSelectorReady":
      return transitionTo(
        {
          ...state,
          status: "pending",
          iframeLoaded: false,
          selectorReady: false,
        },
        [{ type: "cancel-settle" }],
      );
    case "settling":
      return transitionTo(
        {
          ...state,
          status: "pending",
          iframeLoaded: false,
          selectorReady: false,
        },
        [{ type: "cancel-settle" }],
      );
    case "resolvingCommit":
    case "awaitingResponse":
      return transitionTo({
        ...state,
        status: "pending",
        source: state.queuedSource ?? state.source,
        queuedSource: null,
        iframeLoaded: false,
        selectorReady: false,
      });
    case "saving":
      return transitionTo({
        ...state,
        iframeLoaded: false,
        selectorReady: false,
      });
    default:
      return assertNever(state);
  }
}

export function transition(
  state: ScreenshotState,
  event: ScreenshotEvent,
): Result {
  switch (event.type) {
    case "CAPTURE_REQUESTED":
      return captureRequested(state, event.source);
    case "IFRAME_LOADED":
      return iframeLoaded(state);
    case "SELECTOR_READY":
      return selectorReady(state);
    case "APP_HIDDEN":
      return appHidden(state);
    case "SETTLE_ELAPSED":
      if (
        state.status !== "waitingSelectorReady" &&
        state.status !== "settling"
      ) {
        return ignore(state, "capture-not-active");
      }
      return transitionTo(
        {
          ...state,
          status: "resolvingCommit",
          requestId: event.requestId,
        },
        [
          {
            type: "resolve-commit-hash",
            requestId: event.requestId,
          },
        ],
      );
    case "COMMIT_RESOLVED":
      if (
        state.status !== "resolvingCommit" ||
        event.requestId !== state.requestId
      ) {
        return ignore(state, "stale-request");
      }
      return transitionTo(
        {
          ...state,
          status: "awaitingResponse",
          requestId: event.requestId,
          commitHash: event.hash,
        },
        [
          {
            type: "post-capture-request",
            requestId: event.requestId,
          },
        ],
      );
    case "RESPONSE":
      if (
        state.status !== "awaitingResponse" ||
        event.requestId !== state.requestId
      ) {
        return ignore(state, "stale-request");
      }
      if (!event.ok || !event.dataUrl) return finishCapture(state);
      return transitionTo(
        {
          ...state,
          status: "saving",
          dataUrl: event.dataUrl,
        },
        [
          {
            type: "save-screenshot",
            commitHash: state.commitHash,
            dataUrl: event.dataUrl,
          },
        ],
      );
    case "SAVED":
      return state.status === "saving"
        ? finishCapture(state)
        : ignore(state, "not-saving");
    case "SAVE_FAILED":
      if (event.requestId !== undefined) {
        if (
          (state.status !== "resolvingCommit" &&
            state.status !== "awaitingResponse") ||
          event.requestId !== state.requestId
        ) {
          return ignore(state, "stale-request");
        }
        return finishCapture(state);
      }
      return state.status === "settling" ||
        state.status === "resolvingCommit" ||
        state.status === "awaitingResponse" ||
        state.status === "saving"
        ? finishCapture(state)
        : ignore(state, "capture-not-active");
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected screenshot machine value: ${JSON.stringify(value)}`,
  );
}
