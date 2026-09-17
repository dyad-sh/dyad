import type { ChatScrollEvent, ChatScrollState } from "./state";

function ignore(state: ChatScrollState, _reason: string): ChatScrollState {
  return state;
}

export function transition(
  state: ChatScrollState,
  event: ChatScrollEvent,
): ChatScrollState {
  switch (event.type) {
    case "follow":
      return state.type === "following"
        ? ignore(state, "already following")
        : { type: "following" };
    case "user-away":
      return state.type === "reading"
        ? ignore(state, "already reading")
        : { type: "reading", hasLeftBottom: false };
    case "position":
      if (state.type === "following")
        return ignore(state, "growth is not user intent");
      if (event.atBottom) {
        // A queued scroll event from our last write can arrive BEFORE the
        // browser applies the wheel gesture. Do not immediately undo the pause.
        return state.hasLeftBottom
          ? { type: "following" }
          : ignore(state, "awaiting user movement");
      }
      return state.hasLeftBottom
        ? ignore(state, "still reading")
        : { type: "reading", hasLeftBottom: true };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
