// @vitest-environment node
//
// Migrated from e2e-tests/astro.spec.ts.
//
// The e2e imported the "astro" fixture app (which contains src/foo.astro),
// which triggered the renderer's automatic "Generate an AI_RULES.md ..."
// prompt (the fixture has no AI_RULES.md), then sent "[dump] hi" and
// snapshotted the LLM payload. The key behavior: .astro files are included in
// the codebase extraction sent to the LLM. We reproduce the same two chat
// turns against the astro fixture and snapshot the masked payload.
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

// Same prompt the renderer (ImportAppDialog) sends after importing an app
// without AI_RULES.md.
const AI_RULES_PROMPT =
  "Generate an AI_RULES.md file for this app. Describe the tech stack in 5-10 bullet points and describe clear rules about what libraries to use for what.";

describe("astro app (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      fixtureApp: "astro",
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("includes .astro files in the codebase payload sent to the LLM", async () => {
    // Mirror the e2e flow: post-import AI_RULES generation turn first...
    await harness.streamChat(AI_RULES_PROMPT);
    // ...then the dumped turn.
    await harness.streamChat("[dump] hi");

    const dump = harness.getServerDump({ type: "all-messages" });

    // The .astro file's contents are part of the codebase context.
    expect(dump.text).toContain('<dyad-file path="src/foo.astro">');
    expect(dump.text).toContain("Welcome to Astro!");

    // The prior AI_RULES turn is present in the history.
    expect(dump.text).toContain("Generate an AI_RULES.md file for this app.");
    expect(dump.text.trimEnd()).toMatch(/role: user\nmessage: \[dump\] hi$/);

    // Stable masked transcript (equivalent of the e2e snapshotServerDump).
    expect(dump.text).toMatchSnapshot("astro-all-messages");
  }, 30_000);
});
