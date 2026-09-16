import type { ChatStreamParams } from "../types/chat";
import { safeSend, type PresentationContext } from "../utils/safe_sender";
import { sendChatChunk } from "@/window_infrastructure/main/production_high_volume";
import type {
  ChatExecutionContext,
  ChatExecutionOutcome,
} from "./chat_execution_types";

const unavailableEndpoint: PresentationContext["sender"] = {
  id: Number.NaN,
  isDestroyed: () => true,
  send: () => undefined,
};

/** Electron delivery adapter. No presentation failure can settle a turn. */
export function createChatExecutionContext(
  sender: PresentationContext["sender"],
): ChatExecutionContext {
  const presentation: PresentationContext = {
    get sender() {
      // Keep real liveness semantics. A lost endpoint is simply absent from
      // presentation routing; it never needs to pretend to be alive so an
      // authoritative terminal callback can run.
      return sender.isDestroyed() || sender.isCrashed?.()
        ? unavailableEndpoint
        : sender;
    },
  };
  return {
    presentation,
    onProgress(progress) {
      switch (progress.type) {
        case "started":
          safeSend(presentation.sender, "chat:stream:start", progress.payload);
          break;
        case "chunk":
          sendChatChunk(presentation.sender, progress.payload);
          break;
      }
    },
  };
}

export function presentChatExecutionOutcome(
  sender: PresentationContext["sender"],
  outcome: ChatExecutionOutcome,
): void {
  if (outcome.kind === "completed") {
    safeSend(sender, "chat:response:end", outcome.response);
    safeSend(sender, "chat:stream:end", { chatId: outcome.response.chatId });
  } else if (outcome.kind === "failed") {
    safeSend(sender, "chat:response:error", outcome.error);
    safeSend(sender, "chat:stream:end", { chatId: outcome.error.chatId });
  }
  // Cancellation already projects its early terminal in cancelTrackedStreams;
  // the execution result is the later authoritative persistence/drain barrier.
}

export function cancelledChatResponse(request: ChatStreamParams) {
  return {
    chatId: request.chatId,
    invocationRef: request.invocationRef,
    streamId: request.streamId,
    updatedFiles: false,
    wasCancelled: true,
  } as const;
}
