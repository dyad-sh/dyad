import type { ChatResponseEnd } from "@/ipc/types/chat";
import type { ChatStreamInvocationRef } from "./state";
import type { ChatQueueEntry, SerializableChatTurnIntent } from "./transport";

export interface ChatStreamHostState {
  readonly phase:
    | "idle"
    | "admitting"
    | "streaming"
    | "cancelling"
    | "finalizing"
    | "errored";
  readonly active: {
    readonly intent: SerializableChatTurnIntent;
    readonly invocationRef: ChatStreamInvocationRef;
    readonly targetAppId: number | null;
  } | null;
  readonly error: string | null;
  readonly queueRevision: number;
  readonly queuePaused: boolean;
  readonly queue: readonly ChatQueueEntry[];
  readonly lastAcceptance: {
    readonly intentId: string;
    readonly acceptance:
      | "queued"
      | "message-accepted"
      | "replayed"
      | "rejected";
    readonly acceptedMessageId?: number;
    readonly error?: string;
  } | null;
  readonly lastCompletion: {
    readonly intentId: string;
    readonly invocationRef: ChatStreamInvocationRef;
    readonly outcome: "completed" | "cancelled" | "errored";
    readonly chatSummary?: string;
    readonly pausePromptQueue?: boolean;
    readonly updatedFiles?: boolean;
    readonly extraFiles?: string[];
    readonly extraFilesError?: string;
    readonly warningMessages?: string[];
    readonly targetAppId: number | null;
    readonly error?: string;
  } | null;
  readonly pendingQueueMutationId: string | null;
  readonly lastQueueMutation: {
    readonly mutationId: string;
    readonly outcome: "applied" | "rejected";
    readonly error?: string;
  } | null;
}

export type ChatStreamHostCommand =
  | {
      readonly type: "admit-and-start";
      readonly intent: SerializableChatTurnIntent;
    }
  | {
      readonly type: "persist-queued";
      readonly intent: SerializableChatTurnIntent;
    }
  | {
      readonly type: "cancel-active";
      readonly invocationRef: ChatStreamInvocationRef;
    }
  | {
      readonly type: "mutate-queue";
      readonly mutation:
        | { type: "pause" }
        | { type: "resume" }
        | {
            type: "edit";
            itemId: string;
            prompt: string;
            attachments?: SerializableChatTurnIntent["attachments"];
            selectedComponents?: SerializableChatTurnIntent["selectedComponents"];
          }
        | { type: "reorder"; itemId: string; toIndex: number }
        | { type: "remove"; itemId: string }
        | { type: "clear" };
      readonly expectedQueueRevision: number;
      readonly mutationId: string;
    }
  | {
      readonly type: "finalize";
      readonly intentId: string;
      readonly response?: ChatResponseEnd;
      readonly error?: string;
    }
  | { readonly type: "dispatch-next" };
