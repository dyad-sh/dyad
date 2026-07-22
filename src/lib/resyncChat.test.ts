import { afterEach, describe, expect, it, vi } from "vitest";

import { ipc } from "@/ipc/types";

import { triggerResync } from "./resyncChat";

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("triggerResync", () => {
  it("skips a fetched snapshot when the owning stream generation is stale", async () => {
    vi.spyOn(ipc.chat, "getChat").mockResolvedValue({
      id: 17,
      appId: 1,
      title: "Chat",
      chatMode: null,
      messages: [],
    });
    const setMessagesById = vi.fn();

    triggerResync(17, setMessagesById, () => true);
    await flush();

    expect(setMessagesById).not.toHaveBeenCalled();
  });

  it("applies a fetched snapshot while the owning generation is current", async () => {
    vi.spyOn(ipc.chat, "getChat").mockResolvedValue({
      id: 18,
      appId: 1,
      title: "Chat",
      chatMode: null,
      messages: [],
    });
    const setMessagesById = vi.fn();

    triggerResync(18, setMessagesById, () => false);
    await flush();

    expect(setMessagesById).toHaveBeenCalledOnce();
  });
});
