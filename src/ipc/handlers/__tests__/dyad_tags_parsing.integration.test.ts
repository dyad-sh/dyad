// @vitest-environment node
//
// Migrated from e2e-tests/dyad_tags_parsing.spec.ts.
//
// Verifies that a <dyad-write> whose description attribute contains nested
// angle-bracket tags (`<a>`, `<b>`) is parsed correctly and the file body is
// written verbatim. The original e2e snapshotted the whole app tree; here we
// assert the written file directly (the meaningful signal) plus the commit.
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

describe("dyad tags parsing (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("handles nested < tags inside a dyad-write description", async () => {
    const { result } = await harness.streamChat("tc=dyad-write-angle");
    expect(result).toBe(harness.chatId);

    // The <dyad-write path="src/foo/bar.tsx"> body is written verbatim, even
    // though its description contains nested <a>/<b> tags.
    expect(harness.appFileExists("src/foo/bar.tsx")).toBe(true);
    expect(harness.readAppFile("src/foo/bar.tsx").trim()).toBe(
      "// BEGINNING OF FILE",
    );

    // The change was auto-approved and committed.
    expect(harness.gitLog().length).toBeGreaterThan(1);
  }, 30_000);
});
