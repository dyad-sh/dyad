/** Typed identity for the durable user-input → chat-stream pilot handoff. */
export interface UserInputFollowUpQueueOwner {
  kind: "user-input-follow-up";
  requestId: string;
}
