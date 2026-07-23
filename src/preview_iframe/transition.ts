import { ignore, type TransitionResult } from "@/state_machines/types";
import type {
  PreviewIframeCommand,
  PreviewIframeEvent,
  PreviewIframeIgnoreReason,
  PreviewIframeState,
} from "./state";

export type PreviewIframeTransitionResult = TransitionResult<
  PreviewIframeState,
  PreviewIframeCommand,
  PreviewIframeIgnoreReason
>;

const applied = (
  state: PreviewIframeState,
  commands: readonly PreviewIframeCommand[] = [],
): PreviewIframeTransitionResult => ({ state, commands });

const navigateCommand = (
  url: string,
  direction?: "backward" | "forward",
): PreviewIframeCommand => ({
  type: "post-to-iframe",
  message: { type: "navigate", payload: { url, direction } },
});

export function transition(
  state: PreviewIframeState,
  event: PreviewIframeEvent,
): PreviewIframeTransitionResult {
  switch (event.type) {
    case "APP_URL_CHANGED": {
      if (!event.url) return ignore(state, "empty-url");
      if (
        event.url === state.currentUrl ||
        (state.currentUrl !== null && sameOrigin(event.url, state.currentUrl))
      ) {
        return ignore(state, "already-current-app-url");
      }
      return applied({
        ...state,
        history: [event.url],
        position: 0,
        currentUrl: event.url,
        preservedUrl: event.url,
      });
    }
    case "NAVIGATE": {
      if (!event.path) return ignore(state, "empty-url");
      const history = [
        ...state.history.slice(0, state.position + 1),
        event.path,
      ];
      return applied(
        {
          ...state,
          history,
          position: history.length - 1,
          currentUrl: event.path,
          preservedUrl: event.path,
        },
        [navigateCommand(event.path)],
      );
    }
    case "NAVIGATED_IN_APP": {
      if (!event.url) return ignore(state, "empty-url");
      if (event.kind === "pushState") {
        const history = [
          ...state.history.slice(0, state.position + 1),
          event.url,
        ];
        return applied({
          ...state,
          history,
          position: history.length - 1,
          currentUrl: event.url,
          preservedUrl: event.url,
        });
      }
      if (event.url === state.currentUrl) {
        return ignore(state, "already-current-url");
      }
      const history = [...state.history];
      if (history.length === 0) {
        history.push(event.url);
      } else {
        history[state.position] = event.url;
      }
      return applied({
        ...state,
        history,
        position: history.length === 1 ? 0 : state.position,
        currentUrl: event.url,
        preservedUrl: event.url,
      });
    }
    case "GO_BACK": {
      if (state.position <= 0) return ignore(state, "history-boundary");
      const position = state.position - 1;
      const currentUrl = state.history[position];
      if (!currentUrl) return ignore(state, "history-boundary");
      return applied(
        { ...state, position, currentUrl, preservedUrl: currentUrl },
        [navigateCommand(currentUrl, "backward")],
      );
    }
    case "GO_FORWARD": {
      if (state.position >= state.history.length - 1) {
        return ignore(state, "history-boundary");
      }
      const position = state.position + 1;
      const currentUrl = state.history[position];
      if (!currentUrl) return ignore(state, "history-boundary");
      return applied(
        { ...state, position, currentUrl, preservedUrl: currentUrl },
        [navigateCommand(currentUrl, "forward")],
      );
    }
    case "RELOAD_REQUESTED":
      return applied(
        {
          ...state,
          iframeEpoch: state.iframeEpoch + 1,
          selectorReady: false,
          picking: false,
        },
        [{ type: "clear-preview-error" }],
      );
    case "IFRAME_REPLACED": {
      const history = state.currentUrl ? [state.currentUrl] : [];
      if (
        state.history.length === history.length &&
        state.history[0] === history[0] &&
        state.position === 0 &&
        state.preservedUrl === state.currentUrl &&
        !state.selectorReady &&
        !state.picking
      ) {
        return ignore(state, "already-replaced");
      }
      return applied({
        ...state,
        history,
        position: 0,
        preservedUrl: state.currentUrl,
        selectorReady: false,
        picking: false,
      });
    }
    case "IFRAME_LOADED":
      return applied(state, [{ type: "clear-preview-error" }]);
    case "SELECTOR_READY":
      if (state.selectorReady) {
        return ignore(state, "already-selector-ready");
      }
      return applied(
        { ...state, selectorReady: true },
        state.restoreQueued
          ? [
              {
                type: "post-to-iframe",
                message: { type: "restore-overlays" },
              },
            ]
          : [],
      );
    case "PICKER_TOGGLED": {
      if (!state.selectorReady) return ignore(state, "picker-not-ready");
      const picking = !state.picking;
      const commands: PreviewIframeCommand[] = [];
      if (!picking) {
        commands.push({
          type: "post-to-iframe",
          message: { type: "cleanup-all-text-editing" },
        });
      }
      commands.push({
        type: "post-to-iframe",
        message: {
          type: picking
            ? "activate-dyad-component-selector"
            : "deactivate-dyad-component-selector",
        },
      });
      return applied({ ...state, picking }, commands);
    }
    case "PICKER_DEACTIVATED":
      if (!state.picking) return ignore(state, "picker-already-inactive");
      return applied({ ...state, picking: false }, [
        {
          type: "post-to-iframe",
          message: { type: "cleanup-all-text-editing" },
        },
        {
          type: "post-to-iframe",
          message: { type: "deactivate-dyad-component-selector" },
        },
      ]);
    case "SELECTION_RESTORE_QUEUED":
      if (state.restoreQueued) {
        return ignore(state, "restore-already-queued");
      }
      return applied(
        { ...state, restoreQueued: true },
        state.selectorReady
          ? [
              {
                type: "post-to-iframe",
                message: { type: "restore-overlays" },
              },
            ]
          : [],
      );
    case "SELECTION_RESTORED":
      if (!state.restoreQueued) return ignore(state, "restore-not-queued");
      return applied({ ...state, restoreQueued: false });
    default:
      return assertNever(event);
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function assertNever(event: never): never {
  throw new Error(`Unhandled preview iframe event: ${JSON.stringify(event)}`);
}
