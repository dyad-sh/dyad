// @vitest-environment node
//
// Migrated from e2e-tests/dump_messages.spec.ts.
//
// Proves the server-dump / payload-snapshot path: the fake LLM writes the
// request body it received to disk, and the harness reads + normalizes it the
// same way the Playwright PageObject.snapshotServerDump does (system messages
// masked, tool-call ids stabilized, plus the harness-only tools[].description
// and body.model masks). The e2e used the default new-app scaffold; here we use
// the minimal fixture, so we snapshot the harness's own normalized output
// rather than reuse the e2e snapshot byte-for-byte.
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

describe("dump messages (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("sends the expected request payload to the LLM", async () => {
    await harness.streamChat("[dump]");

    const messagesDump = harness.getServerDump({ type: "all-messages" });

    // System prompt is masked; the codebase-priming user turn and the [dump]
    // prompt are present and deterministic.
    expect(messagesDump.text).toContain("role: system");
    expect(messagesDump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    expect(messagesDump.text).toContain("This is my codebase.");
    expect(messagesDump.text.trimEnd()).toMatch(
      /role: user\nmessage: \[dump\]$/,
    );

    // The normalized prettified transcript is stable across runs.
    expect(messagesDump.text).toMatchSnapshot("dump-messages-prettified");

    // The harness-only body.model mask is applied on the request view.
    const requestDump = harness.getServerDump({ type: "request" });
    expect(requestDump.parsed.body.model).toBe("[[MODEL]]");
  }, 30_000);
});
