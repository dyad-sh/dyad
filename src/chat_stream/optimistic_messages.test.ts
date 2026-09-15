import { afterEach, describe, expect, it, vi } from "vitest";
import { OptimisticChatMessages } from "./optimistic_messages";

describe("optimistic chat messages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retains identical prompts until their own accepted message arrives", () => {
    const messages = new OptimisticChatMessages();
    messages.add("first", { chatId: 1, prompt: "Hello" });
    messages.add("second", { chatId: 1, prompt: "Hello" });
    const original = messages.getSnapshot(1);
    const history = new Map([
      [1, [{ id: 10, role: "user" as const, content: "Hello" }]],
    ]);
    messages.reconcile(history);
    expect(messages.getSnapshot(1)).toBe(original);
    messages.accept(1, "first", 11);
    messages.reconcile(history);
    expect(messages.getSnapshot(1)).toHaveLength(2);
    history.get(1)!.push({ id: 11, role: "user", content: "Hello" });
    messages.reconcile(history);
    expect(messages.getSnapshot(1).map((entry) => entry.intentId)).toEqual([
      "second",
    ]);
    messages.dispose();
  });

  it("reconciles history that arrived before its acceptance receipt", () => {
    const messages = new OptimisticChatMessages();
    messages.add("first", { chatId: 1, prompt: "Hello" });
    const history = new Map([
      [
        1,
        [
          {
            id: 10,
            role: "user" as const,
            content: "Hello",
            chatTurnIntentId: "first",
          },
        ],
      ],
    ]);
    messages.reconcile(history);
    expect(messages.getSnapshot(1)).toHaveLength(0);
    messages.accept(1, "first", 10);
    messages.reconcile(history);
    expect(messages.getSnapshot(1)).toHaveLength(0);
    messages.dispose();
  });

  it("isolates rollback and deletion by chat and submission", () => {
    const messages = new OptimisticChatMessages();
    messages.add("first", { chatId: 1, prompt: "Hello" });
    messages.add("second", { chatId: 1, prompt: "Again" });
    messages.add("other-chat", { chatId: 2, prompt: "Elsewhere" });
    messages.remove(1, "first");
    expect(
      messages.getSnapshot(1).map((entry) => entry.message.content),
    ).toEqual(["Again"]);
    messages.disposeKey(1);
    expect(messages.getSnapshot(1)).toHaveLength(0);
    expect(messages.getSnapshot(2)).toHaveLength(1);
    messages.dispose();
    expect(messages.getSnapshot(2)).toHaveLength(0);
  });

  it("shows attachment-only submissions and releases preview URLs on rollback", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const messages = new OptimisticChatMessages();
    messages.add("image", {
      chatId: 1,
      prompt: "",
      attachments: [
        {
          file: new File(["image"], 'a"b.png', { type: "image/png" }),
          type: "chat-context",
        },
      ],
    });
    const [entry] = messages.getSnapshot(1);
    expect(entry.message.content).toContain('name="a&quot;b.png"');
    expect(entry.message.content).toContain('url="blob:preview"');
    messages.remove(1, "image");
    messages.dispose();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:preview");
  });
});
