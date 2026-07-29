import type { Chat, ComponentSelection, FileAttachment } from "@/ipc/types";
import type { UserInputFollowUpQueueOwner } from "@/state_machines/handoff_types";

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

/** Renderer facade event surface; main owns all lifecycle transitions. */
export type StreamEvent =
  | { type: "submit"; request: StreamRequest }
  | { type: "cancel" }
  | { type: "external-error"; error: string };
