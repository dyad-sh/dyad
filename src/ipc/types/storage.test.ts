import { describe, expect, it } from "vitest";

import { storageContracts } from "./storage";

describe("storage IPC contracts", () => {
  it("accepts a local vault sync with portable conversations", () => {
    expect(
      storageContracts.sync.input.safeParse({
        preferences: {
          destination: "local",
          localVaultPath: "/tmp/meta-human-vault",
          autoSync: true,
          syncConversations: true,
          syncGeneratedMedia: true,
          syncSystemNotes: true,
        },
        chatAgentConversations: [
          {
            id: "chat-1",
            title: "A useful chat",
            updatedAt: 123,
            messages: [{ role: "user", content: "Remember this" }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects unsupported storage destinations", () => {
    expect(
      storageContracts.sync.input.safeParse({
        preferences: {
          destination: "unrestricted-network-drive",
          autoSync: true,
          syncConversations: true,
          syncGeneratedMedia: true,
          syncSystemNotes: true,
        },
        chatAgentConversations: [],
      }).success,
    ).toBe(false);
  });
});
