import { describe, it, expect, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../db/schema", () => ({ mcpToolConsents: {} }));

import {
  waitForConsent,
  resolveConsent,
  clearPendingMcpConsentsForChat,
} from "./mcp_consent";

describe("clearPendingMcpConsentsForChat", () => {
  it("resolves pending consents for the chat as declined", async () => {
    const pending = waitForConsent("r1", 42);
    clearPendingMcpConsentsForChat(42);
    await expect(pending).resolves.toBe("decline");
  });

  it("leaves consents for other chats pending", async () => {
    const pending = waitForConsent("r2", 99);
    clearPendingMcpConsentsForChat(42);
    // Not cleared; still resolvable normally.
    resolveConsent("r2", "accept-once");
    await expect(pending).resolves.toBe("accept-once");
  });
});
