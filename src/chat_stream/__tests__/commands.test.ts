import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ipc } from "@/ipc/types";

import { createProductionChatStreamCommands } from "../commands";

describe("chat stream command adapter instances", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps acknowledgement throttles isolated between constructed adapters", async () => {
    vi.useFakeTimers();
    const responseAck = vi
      .spyOn(ipc.chat, "responseAck")
      .mockResolvedValue(undefined);
    vi.spyOn(ipc.chatStream, "start").mockImplementation(
      ({ chatId }, callbacks) => {
        callbacks.onChunk({ chatId, chunkSeq: 3 });
        return 1;
      },
    );

    const createAdapter = () => {
      const deps = {
        store: createStore(),
        queryClient: new QueryClient(),
        getSettings: () => undefined,
        getPosthog: () => null,
      };
      return createProductionChatStreamCommands(() => deps);
    };
    const first = createAdapter();
    const second = createAdapter();

    await Promise.all([
      first.startStream({
        chatId: 9,
        streamId: 1,
        request: { chatId: 9, appId: 4, prompt: "first" },
        emit: vi.fn(),
      }),
      second.startStream({
        chatId: 9,
        streamId: 1,
        request: { chatId: 9, appId: 4, prompt: "second" },
        emit: vi.fn(),
      }),
    ]);
    await vi.advanceTimersByTimeAsync(250);

    expect(responseAck).toHaveBeenCalledTimes(2);
    expect(responseAck).toHaveBeenNthCalledWith(1, {
      chatId: 9,
      lastSeq: 3,
    });
    expect(responseAck).toHaveBeenNthCalledWith(2, {
      chatId: 9,
      lastSeq: 3,
    });
  });
});
