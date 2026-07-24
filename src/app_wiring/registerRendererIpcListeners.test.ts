import { describe, expect, it, vi } from "vitest";

import type { ChatStreamManager } from "@/chat_stream/manager";
import type { StreamRequest } from "@/chat_stream/state";

import {
  createUserInputChatStreamFacade,
  type RendererIpcClient,
} from "./registerRendererIpcListeners";

describe("user-input chat-stream composition facade", () => {
  it("claims rejection before awaiting owner settlement", async () => {
    let submitted!: StreamRequest;
    const chatStreamManager = {
      ensure: () => ({
        send: (event: { type: string; request: StreamRequest }) => {
          submitted = event.request;
        },
      }),
    } as unknown as ChatStreamManager;
    let settleRejection!: () => void;
    const rejectFollowUp = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleRejection = resolve;
        }),
    );
    const facade = createUserInputChatStreamFacade(
      {
        userInput: { rejectFollowUp },
      } as unknown as Pick<RendererIpcClient, "userInput">,
      chatStreamManager,
    );
    const submission = facade.submit({
      requestId: "integration:1",
      chatId: 1,
      prompt: "continue",
      selectedComponents: [],
      requestedChatMode: "local-agent",
    });

    const rejection = submitted.onAcceptanceRejected?.("removed from queue");
    submitted.onAccepted?.();
    submitted.onAcceptanceError?.(new Error("late stream error"));
    settleRejection();
    await rejection;

    await expect(submission).resolves.toEqual({ accepted: false });
    expect(rejectFollowUp).toHaveBeenCalledWith({
      requestId: "integration:1",
      reason: "removed from queue",
    });
  });

  it("propagates owner settlement failure to the queue and submitter", async () => {
    let submitted!: StreamRequest;
    const chatStreamManager = {
      ensure: () => ({
        send: (event: { type: string; request: StreamRequest }) => {
          submitted = event.request;
        },
      }),
    } as unknown as ChatStreamManager;
    const settlementError = new Error("reject IPC failed");
    const facade = createUserInputChatStreamFacade(
      {
        userInput: {
          rejectFollowUp: vi.fn(() => Promise.reject(settlementError)),
        },
      } as unknown as Pick<RendererIpcClient, "userInput">,
      chatStreamManager,
    );
    const submission = facade.submit({
      requestId: "integration:2",
      chatId: 1,
      prompt: "continue",
      selectedComponents: [],
      requestedChatMode: "local-agent",
    });

    const rejection = submitted.onAcceptanceRejected?.("removed from queue");

    await Promise.all([
      expect(rejection).rejects.toBe(settlementError),
      expect(submission).rejects.toBe(settlementError),
    ]);
  });
});
