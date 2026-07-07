// @vitest-environment node
//
// Migrated from e2e-tests/main.spec.ts.
//
// The e2e spec sent two prompts and snapshotted the rendered messages list
// (aria snapshots). The behavior under test is the round trip: prompt in, fake
// LLM response streamed back, db messages recorded, dyad tags applied. We
// assert that directly on the db rows + written files.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("main chat flow (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("simple message to custom test model", async () => {
    const { result, messages, eventsFor } = await harness.streamChat("hi");
    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    // A plain prompt gets the fake server's canned <dyad-write> response.
    expect(messages).toHaveLength(2);
    const [userMessage, assistantMessage] = messages;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("hi");
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toContain('<dyad-write path="file1.txt">');
    expect(assistantMessage.content).toContain("EOM");

    // The dyad-write was applied and committed (auto-approve).
    expect(harness.readAppFile("file1.txt").trim()).toBe("A file (2)");
    expect(assistantMessage.approvalState).toBe("approved");
    expect(assistantMessage.commitHash).toBeTruthy();
  }, 30_000);

  it("basic message to custom test model", async () => {
    const { result, messages, eventsFor } =
      await harness.streamChat("tc=basic");
    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    // Second turn appends to the same chat.
    expect(messages).toHaveLength(4);
    const userMessage = messages[2];
    const assistantMessage = messages[3];
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("tc=basic");
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content.trim()).toBe(
      "This is a simple basic response",
    );
  }, 30_000);
});
