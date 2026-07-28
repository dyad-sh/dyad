import type { Chat, ComponentSelection, FileAttachment } from "@/ipc/types";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import type { UserInputFollowUpQueueOwner } from "@/state_machines/handoff_types";

export const CHAT_STREAM_INVOCATION_KIND = "chat-stream" as const;
export type ChatStreamInvocationRef = InvocationRef<
  typeof CHAT_STREAM_INVOCATION_KIND,
  number
>;

export interface StreamSettledResult {
  success: boolean;
  pausedByStepLimit?: boolean;
  queued?: boolean;
}

/**
 * A renderer submission. Callbacks are window-local receipts and never cross
 * the IPC boundary or enter main-owned lifecycle/queue state.
 */
export interface StreamRequest {
  prompt: string;
  chatId: number;
  appId?: number;
  redo?: boolean;
  attachments?: FileAttachment[];
  selectedComponents?: ComponentSelection[];
  requestedChatMode?: Chat["chatMode"] | null;
  planAcceptInNewChat?: boolean;
  owner?: UserInputFollowUpQueueOwner;
  onAccepted?: () => void;
  onAcceptanceError?: (error: Error) => void;
  onAcceptanceRejected?: (reason: string) => void | Promise<void>;
  onSettled?: (result: StreamSettledResult) => void;
}

/** Compatibility surface used by React callers; main owns all transitions. */
export type StreamEvent =
  | { type: "submit"; request: StreamRequest }
  | { type: "cancel" }
  | { type: "external-error"; error: string };
