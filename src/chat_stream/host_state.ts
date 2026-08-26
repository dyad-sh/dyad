import type { ChatResponseEnd } from "@/ipc/types/chat";
import type { ChatStreamInvocationRef } from "./invocation";
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
    readonly pauseQueueOnCancel?: boolean;
    readonly queueResumedAfterCancel?: boolean;
  } | null;
  readonly error: string | null;
  readonly queueRevision: number;
  readonly queuePaused: boolean;
  readonly queuePauseReason: "stop" | "manual" | "step-limit" | null;
  readonly queue: readonly ChatQueueEntry[];
  readonly stopPolicyVersion: number;
  readonly lastStopId: string | null;
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
    readonly reviewBarrierRequested?: boolean;
    readonly suppressAutoReview?: boolean;
    readonly updatedFiles?: boolean;
    readonly extraFiles?: string[];
    readonly extraFilesError?: string;
    readonly warningMessages?: string[];
    readonly targetAppId: number | null;
    readonly error?: string;
  } | null;
  readonly pendingQueueMutationId: string | null;
  readonly pendingQueuePauseMutationId: string | null;
  readonly pendingQueueResumeMutationId: string | null;
  readonly lastQueueMutation: {
    readonly mutationId: string;
    readonly outcome: "applied" | "rejected";
    readonly error?: string;
  } | null;
  readonly reviewBarrier: {
    readonly phase:
      | "idle"
      | "reviewing"
      | "remediating"
      | "awaiting-continuation"
      | "verifying";
    readonly threadId: string | null;
    /** Whether the review barrier, rather than the user, paused the queue. */
    readonly resumeQueueOnRelease: boolean;
  };
}

export type ChatStreamHostCommand =
  | {
      readonly type: "admit-and-start";
      readonly intent: SerializableChatTurnIntent;
    }
  | {
      readonly type: "persist-queued";
      readonly intent: SerializableChatTurnIntent;
      readonly resumeQueue: boolean;
      readonly observedStopPolicyVersion?: number;
    }
  | {
      readonly type: "cancel-active";
      readonly invocationRef: ChatStreamInvocationRef;
    }
  | { readonly type: "park-queue" }
  | {
      readonly type: "mutate-queue";
      readonly mutation:
        | { type: "pause" }
        | { type: "resume"; preserveStopPause?: boolean }
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
      readonly observedStopPolicyVersion?: number;
    }
  | {
      readonly type: "finalize";
      readonly intentId: string;
      readonly response?: ChatResponseEnd;
      readonly error?: string;
    }
  | {
      readonly type: "run-review-barrier";
      readonly verification: boolean;
      readonly autoFixPolicy?: "queued-override" | "user-setting";
    }
  | {
      readonly type: "submit-review-remediation";
      readonly threadId: string;
      readonly prompt: string;
      readonly observedStopPolicyVersion: number;
    }
  | {
      readonly type: "fail-review-remediation";
      readonly threadId: string;
    }
  | { readonly type: "resume-after-review" }
  | { readonly type: "dispatch-next" };
