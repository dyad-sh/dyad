import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";

import { createProductionChatStreamCommands } from "../commands";
import { makeChatStreamRef } from "./test_refs";

const ref = (index: number) => makeChatStreamRef(index, 9);

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
        invocationRef: ref(1),
        request: { chatId: 9, appId: 4, prompt: "first" },
        emit: vi.fn(),
        isStale: () => false,
      }),
      second.startStream({
        chatId: 9,
        invocationRef: ref(1),
        request: { chatId: 9, appId: 4, prompt: "second" },
        emit: vi.fn(),
        isStale: () => false,
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

  it("reports machine follow-up acceptance only after main confirms its durable request id", async () => {
    const onAccepted = vi.fn();
    const deps = {
      store: createStore(),
      queryClient: new QueryClient(),
      getSettings: () => undefined,
      getPosthog: () => null,
    };
    vi.spyOn(ipc.chatStream, "start").mockImplementation(
      ({ chatId, userInputRequestId }, callbacks) => {
        expect(userInputRequestId).toBe("integration:durable");
        expect(onAccepted).not.toHaveBeenCalled();
        callbacks.onChunk({
          chatId,
          acceptedUserInputRequestId: "integration:durable",
        });
        return 1;
      },
    );

    await createProductionChatStreamCommands(() => deps).startStream({
      chatId: 9,
      invocationRef: ref(1),
      request: {
        chatId: 9,
        appId: 4,
        prompt: "continue",
        userInputRequestId: "integration:durable",
        onAccepted,
      },
      emit: vi.fn(),
      isStale: () => false,
    });

    expect(onAccepted).toHaveBeenCalledOnce();
  });

  it("replaces transient content after the cancelled handler unwinds", async () => {
    let resolveCancellation!: (cancelled: boolean) => void;
    const cancellation = new Promise<boolean>((resolve) => {
      resolveCancellation = resolve;
    });
    vi.spyOn(ipc.chat, "cancelStream").mockReturnValue(cancellation);
    vi.spyOn(ipc.chatStream, "release").mockImplementation(() => {});

    const transientMessage = {
      id: 1,
      chatId: 9,
      role: "assistant" as const,
      content:
        '<dyad-compaction title="Compacting conversation">partial</dyad-compaction>',
    };
    const persistedMessage = {
      ...transientMessage,
      content: "Response cancelled by user.",
    };
    const getChat = vi.spyOn(ipc.chat, "getChat").mockResolvedValue({
      id: 9,
      messages: [persistedMessage],
    } as never);
    const deps = {
      store: createStore(),
      queryClient: new QueryClient(),
      getSettings: () => undefined,
      getPosthog: () => null,
    };
    deps.store.set(
      chatMessagesByIdAtom,
      new Map([[9, [transientMessage as never]]]),
    );
    const commands = createProductionChatStreamCommands(() => deps);

    commands.requestAbort({ chatId: 9 });
    await commands.runEndSideEffects({
      chatId: 9,
      invocationRef: ref(1),
      request: { chatId: 9, appId: 4, prompt: "cancel me" },
      targetAppId: 4,
      response: { chatId: 9, updatedFiles: false, wasCancelled: true },
    });
    expect(getChat).not.toHaveBeenCalled();

    resolveCancellation(true);
    await vi.waitFor(() => expect(getChat).toHaveBeenCalledWith(9));
    await vi.waitFor(() =>
      expect(deps.store.get(chatMessagesByIdAtom).get(9)).toEqual([
        persistedMessage,
      ]),
    );
  });
});
