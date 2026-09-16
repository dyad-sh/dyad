import type {
  ChatStreamChunkPayload,
  ChatStreamEndPayload,
  ChatStreamErrorPayload,
  ChatStreamStartPayload,
} from "@/chat_stream/protocol";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";
import type { PresentationContext } from "../utils/safe_sender";

/** Settles only after persistence, tool work, and execution cleanup finish. */
export type ChatExecutionOutcome =
  | { kind: "completed"; response: ChatStreamEndPayload }
  | { kind: "cancelled" }
  | { kind: "failed"; error: ChatStreamErrorPayload };

/** Progress is presentation, never proof that the execution has settled. */
export type ChatExecutionProgress =
  | { type: "started"; payload: ChatStreamStartPayload }
  | { type: "chunk"; payload: ChatStreamChunkPayload };

export interface ChatExecutionContext {
  /** Narrow presentation capability for tool UI and consent subscribers. */
  presentation: PresentationContext;
  onProgress(progress: ChatExecutionProgress): void;
  intent?: SerializableChatTurnIntent;
  /** Emitted only after the acceptance transaction commits. */
  onAccepted?(messageId: number): void;
}
