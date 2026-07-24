import { describe, expect, it } from "vitest";
import type { IpcMainInvokeEvent, WebContents } from "electron";

import { streamTestResponse } from "./testing_chat_handlers";

describe("streamTestResponse", () => {
  it("echoes the full invocation ref on normal and final-flush chunks", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const sender = {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
      },
    } as unknown as WebContents;
    const invocationRef = {
      kind: "chat-stream",
      entityKey: 7,
      operationId: "canned-stream",
    } as const;

    await streamTestResponse(
      { sender } as IpcMainInvokeEvent,
      7,
      invocationRef,
      undefined,
      "x".repeat(1_201),
      new AbortController(),
      42,
    );

    const chunks = sent.filter(
      (message) => message.channel === "chat:response:chunk",
    );
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
