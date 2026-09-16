import { describe, expect, it } from "vitest";
import type { ChatExecutionProgress } from "../services/chat_execution_types";

import { streamTestResponse } from "./testing_chat_handlers";

describe("streamTestResponse", () => {
  it("echoes the full invocation ref on normal and final-flush chunks", async () => {
    const progress: ChatExecutionProgress[] = [];
    const invocationRef = {
      kind: "chat-stream",
      entityKey: 7,
      operationId: "canned-stream",
    } as const;

    await streamTestResponse(
      (event) => progress.push(event),
      7,
      invocationRef,
      undefined,
      "x".repeat(1_201),
      new AbortController(),
      42,
    );

    const chunks = progress.filter((event) => event.type === "chunk");
    expect(chunks).toHaveLength(3);
    expect(
      chunks.every(
        (message) =>
          (message.payload as { invocationRef?: unknown }).invocationRef ===
          invocationRef,
      ),
    ).toBe(true);
  });
});
