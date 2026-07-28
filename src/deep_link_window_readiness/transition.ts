import { change, ignore } from "@/state_machines/types";
import type {
  DeepLinkWindowReadinessEvent,
  DeepLinkWindowReadinessState,
  DeepLinkWindowReadinessTransitionResult,
} from "./state";

export function transition(
  state: DeepLinkWindowReadinessState,
  event: DeepLinkWindowReadinessEvent,
): DeepLinkWindowReadinessTransitionResult {
  switch (event.type) {
    case "TARGET_CHANGED": {
      if (state.target === event.target) {
        return ignore(state, "target-unchanged");
      }
      return change(
        { ...state, target: event.target },
        event.target && state.readyWindows.includes(event.target)
          ? [{ type: "MarkQueueReady" }]
          : [{ type: "MarkQueueNotReady" }],
      );
    }
    case "WINDOW_READY": {
      if (state.readyWindows.includes(event.window)) {
        return ignore(state, "window-already-ready");
      }
      return change(
        {
          ...state,
          readyWindows: [...state.readyWindows, event.window],
        },
        event.window === state.target ? [{ type: "MarkQueueReady" }] : [],
      );
    }
    case "WINDOW_NOT_READY": {
      if (!state.readyWindows.includes(event.window)) {
        return ignore(state, "window-already-not-ready");
      }
      return change(
        {
          ...state,
          readyWindows: state.readyWindows.filter(
            (window) => window !== event.window,
          ),
        },
        event.window === state.target ? [{ type: "MarkQueueNotReady" }] : [],
      );
    }
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled deep-link window readiness event: ${String(value)}`,
  );
}
