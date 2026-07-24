/** Typed identity for the memory-owned user-input → chat-stream handoff. */
export interface UserInputFollowUpQueueOwner {
  kind: "user-input-follow-up";
  requestId: string;
}
