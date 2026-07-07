// @vitest-environment node
//
// Migrated from e2e-tests/partial_response.spec.ts.
//
// The fake server streams an unclosed <dyad-write> (fixture partial-write.md).
// The chat stream handler detects the unclosed tag and issues a continuation
// request ("Your previous response did not finish completely..."); the fake
// server recognizes the [[STRING_TO_BE_FINISHED]] marker and finishes the file
// plus appends a [dump]. The merged response is written, auto-approved and
// committed.
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

describe("partial response (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      autoApprove: true,
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("partial message is resumed", async () => {
    const { result, messages, getServerDump } =
      await harness.streamChat("tc=partial-write");
    expect(result).toBe(harness.chatId);

    // The continuation request replayed the partial assistant output and asked
    // the model to continue (see chat_stream_handlers continuation prompt).
    const dump = getServerDump();
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    expect(dump.text).toContain('const a = "[[STRING_TO_BE_FINISHED]]');
    expect(dump.text).toContain(
      "Your previous response did not finish completely. Continue exactly where you left off without any preamble.",
    );
    expect(dump.text).toMatchSnapshot();

    // The db assistant message contains the merged (resumed) response.
    expect(messages).toHaveLength(2);
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain('const a = "[[STRING_TO_BE_FINISHED]]');
    expect(assistant.content).toContain('[[STRING_IS_FINISHED]]";');
    expect(assistant.content).toContain("</dyad-write>");
    expect(assistant.content).toContain("Finished writing file.");
    expect(assistant.approvalState).toBe("approved");
    expect(assistant.commitHash).toBeTruthy();

    // The partially-streamed file was completed and written.
    expect(harness.appFileExists("src/new-file.ts")).toBe(true);
    const fileContent = harness.readAppFile("src/new-file.ts");
    expect(fileContent).toContain('const a = "[[STRING_TO_BE_FINISHED]]');
    expect(fileContent).toContain('[[STRING_IS_FINISHED]]";');

    // The applied change was committed on top of the init commit.
    expect(harness.gitLog().length).toBeGreaterThan(1);
  }, 30_000);
});
