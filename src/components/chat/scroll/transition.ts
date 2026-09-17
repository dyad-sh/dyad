import type { ChatScrollEvent, ChatScrollState } from "./state";
import { change, ignore, type TransitionResult } from "@/state_machines/types";

export function transition(
  state: ChatScrollState,
  event: ChatScrollEvent,
): TransitionResult<ChatScrollState, never> {
  switch (event.type) {
    case "follow":
      return state.type === "following"
        ? ignore(state, "already following")
        : change({ type: "following" });
    case "user-away":
      return state.type === "reading"
        ? ignore(state, "already reading")
        : change({ type: "reading", hasLeftBottom: false });
    case "position":
      if (state.type === "following")
        return ignore(state, "growth is not user intent");
      if (event.atBottom) {
        // A queued scroll event from our last write can arrive BEFORE the
        // browser applies the wheel gesture. Do not immediately undo the pause.
        return state.hasLeftBottom
          ? change({ type: "following" })
          : ignore(state, "awaiting user movement");
      }
      return state.hasLeftBottom
        ? ignore(state, "still reading")
        : change({ type: "reading", hasLeftBottom: true });
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
