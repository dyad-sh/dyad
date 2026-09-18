// A local, per-mounted-chat actor. Layout updates coalesce into one frame;
// disposal cancels that frame and rejects any callback from the old scroller.
export type ChatScrollState =
  | { type: "following" }
  | { type: "reading"; hasLeftBottom: boolean };

export type ChatScrollEvent =
  | { type: "follow" }
  | { type: "user-away" }
  | { type: "position"; atBottom: boolean };
