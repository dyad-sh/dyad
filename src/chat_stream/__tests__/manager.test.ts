import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { resolveAppIdForChat } from "@/lib/chatUtils";

import { ChatStreamManager } from "../manager";

vi.mock("@/lib/chatUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatUtils")>()),
  resolveAppIdForChat: vi.fn(),
}));

const CHAT_ID = 17;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatStreamManager", () => {
  it("owns one controller per chat and releases unobserved terminal controllers", () => {
    const manager = new ChatStreamManager(createStore());
    const controller = manager.ensure(CHAT_ID);

    expect(manager.ensure(CHAT_ID)).toBe(controller);
    const unsubscribe = controller.subscribe(() => undefined);
    unsubscribe();

    expect(manager.peek(CHAT_ID)).toBeUndefined();
  });

  it("does not create a controller for registration-only notifications", () => {
    const manager = new ChatStreamManager(createStore());

    manager.notifyStreamRegistered(CHAT_ID);

    expect(manager.peek(CHAT_ID)).toBeUndefined();
  });

  it("disposes the controller and clears all stream residue for a deleted chat", () => {
    const store = createStore();
    const manager = new ChatStreamManager(store);
    manager.ensure(CHAT_ID);
    store.set(queuedMessagesByIdAtom, new Map([[CHAT_ID, []]]));
    store.set(queuePausedByIdAtom, new Map([[CHAT_ID, true]]));
    store.set(chatErrorByIdAtom, new Map([[CHAT_ID, "boom"]]));
    store.set(isStreamingByIdAtom, new Map([[CHAT_ID, false]]));

    manager.disposeChat(CHAT_ID);

    expect(manager.peek(CHAT_ID)).toBeUndefined();
    expect(store.get(queuedMessagesByIdAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(queuePausedByIdAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(chatErrorByIdAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(isStreamingByIdAtom).has(CHAT_ID)).toBe(false);
  });

  it("retains runtime deps until a late stream registration can be released", async () => {
    let resolveAppId!: (appId: number) => void;
    vi.mocked(resolveAppIdForChat).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAppId = resolve;
      }),
    );
    vi.spyOn(ipc.chatStream, "start").mockReturnValue(1);
    const release = vi.spyOn(ipc.chatStream, "release");
    const store = createStore();
    const manager = new ChatStreamManager(store);
    manager.registerRuntimeDeps({
      store,
      queryClient: new QueryClient(),
      getSettings: () => undefined,
      getPosthog: () => null,
    });
    const controller = manager.ensure(CHAT_ID);

    controller.send({
      type: "submit",
      request: { chatId: CHAT_ID, prompt: "hello" },
    });
    await flush();

    manager.dispose();
    expect(release).toHaveBeenCalledOnce();

    resolveAppId(4);
    await flush();

    expect(ipc.chatStream.start).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenLastCalledWith(CHAT_ID, 1);
  });
});
