import { describe, expect, it } from "vitest";
import { withChatQueueLock } from "./queue_lock";

describe("withChatQueueLock", () => {
  it("serializes work for the same chat without blocking other chats", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = withChatQueueLock(1, async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    });
    const second = withChatQueueLock(1, () => {
      order.push("second");
    });
    const otherChat = withChatQueueLock(2, () => {
      order.push("other-chat");
    });

    await otherChat;
    expect(order).toEqual(["first-start", "other-chat"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "other-chat", "first-end", "second"]);
  });

  it("continues queued work after a task fails", async () => {
    const failed = withChatQueueLock(1, () => {
      throw new Error("failed");
    });
    const next = withChatQueueLock(1, () => "completed");

    await expect(failed).rejects.toThrow("failed");
    await expect(next).resolves.toBe("completed");
  });
});
