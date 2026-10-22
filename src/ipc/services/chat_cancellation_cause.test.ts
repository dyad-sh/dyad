import { describe, expect, it } from "vitest";
import { CancellationReason } from "@/shared/cancellation_reason";
import {
  beginChatCancellationCause,
  chatCancellationReason,
} from "./chat_cancellation_cause";

describe("chat cancellation cause", () => {
  it("falls back to the user's Stop outside any scope", () => {
    const reason = chatCancellationReason(101);
    expect(reason).toBeInstanceOf(CancellationReason);
    expect(reason.name).toBe("AbortError");
    expect(reason.kind).toBe("chat-stop");
    expect(chatCancellationReason(101, "chat-deleted").kind).toBe(
      "chat-deleted",
    );
  });

  it("reports the scoped cause only for its chat while the scope is held", () => {
    const release = beginChatCancellationCause(102, "chat-deleted");
    expect(chatCancellationReason(102).kind).toBe("chat-deleted");
    expect(chatCancellationReason(103).kind).toBe("chat-stop");
    release();
    expect(chatCancellationReason(102).kind).toBe("chat-stop");
  });

  it("uses the earliest scope and releases each entry exactly once", () => {
    // The earlier canceller's CANCEL is the one the actor acts on.
    const releaseFirst = beginChatCancellationCause(104, "version-restored");
    const releaseSecond = beginChatCancellationCause(104, "app-deleted");
    expect(chatCancellationReason(104).kind).toBe("version-restored");

    releaseFirst();
    expect(chatCancellationReason(104).kind).toBe("app-deleted");
    releaseFirst();
    expect(chatCancellationReason(104).kind).toBe("app-deleted");

    releaseSecond();
    expect(chatCancellationReason(104).kind).toBe("chat-stop");
  });
});
