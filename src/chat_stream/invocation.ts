import type { InvocationRef } from "@/state_machines/invocation_ref";

export const CHAT_STREAM_INVOCATION_KIND = "chat-stream" as const;
export type ChatStreamInvocationRef = InvocationRef<
  typeof CHAT_STREAM_INVOCATION_KIND,
  number
>;
