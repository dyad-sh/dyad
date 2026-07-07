// @vitest-environment node
//
// Migrated from e2e-tests/context_window.spec.ts.
//
// Verifies chat-history truncation in the LLM payload: with the default
// MAX_CHAT_TURNS_IN_CONTEXT (3, +1 for the current prompt) older turns fall
// out of the request once the history exceeds the limit, and raising
// maxChatTurnsInContext to 5 brings them back. The e2e asserted this via
// server-dump snapshots after each turn; we make the same payload assertions
// targeted (which turns are present) plus one masked snapshot of the final
// dump. The settings-page UI delta snapshot is covered by writing the setting
// through the app's own writeSettings.
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
import { readSettings, writeSettings } from "@/main/settings";

const userTurns = (text: string): string[] =>
  [...text.matchAll(/^message: (\[dump\] )?tc=\d+$/gm)].map((m) => m[0]);

describe("context window (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("limits chat turns in the payload and honors maxChatTurnsInContext", async () => {
    await harness.streamChat("tc=1");
    await harness.streamChat("tc=2");

    // Turn 3: history (5 messages) is under the default limit — all turns sent.
    await harness.streamChat("[dump] tc=3");
    const dump3 = harness.getServerDump();
    expect(userTurns(dump3.text)).toEqual([
      "message: tc=1",
      "message: tc=2",
      "message: [dump] tc=3",
    ]);

    // Turn 4: still within the limit (default 3 turns + current = 4).
    await harness.streamChat("[dump] tc=4");
    const dump4 = harness.getServerDump();
    expect(userTurns(dump4.text)).toEqual([
      "message: tc=1",
      "message: tc=2",
      "message: [dump] tc=3",
      "message: [dump] tc=4",
    ]);

    // Turn 5: exceeds the limit — the oldest turn (tc=1) is dropped.
    await harness.streamChat("[dump] tc=5");
    const dump5 = harness.getServerDump();
    expect(userTurns(dump5.text)).toEqual([
      "message: tc=2",
      "message: [dump] tc=3",
      "message: [dump] tc=4",
      "message: [dump] tc=5",
    ]);
    // The codebase-priming turn is always retained.
    expect(dump5.text).toContain("This is my codebase.");

    // Raise the limit to 5 turns (the e2e did this via the settings page).
    writeSettings({ maxChatTurnsInContext: 5 });
    expect(readSettings().maxChatTurnsInContext).toBe(5);

    // Turn 6: with 5 turns (+1 current) allowed, tc=1 is back in context.
    await harness.streamChat("[dump] tc=6");
    const dump6 = harness.getServerDump();
    expect(userTurns(dump6.text)).toEqual([
      "message: tc=1",
      "message: tc=2",
      "message: [dump] tc=3",
      "message: [dump] tc=4",
      "message: [dump] tc=5",
      "message: [dump] tc=6",
    ]);
    expect(dump6.text).toMatchSnapshot("context-window-final-dump");
  }, 60_000);
});
