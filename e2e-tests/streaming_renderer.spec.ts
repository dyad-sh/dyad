import { expect } from "@playwright/test";

import { test } from "./helpers/test_helper";

// These tests exercise the incremental streaming renderer in DyadMarkdownParser.
// The fake LLM server streams responses character-by-character (32 chars / 10ms),
// so the renderer sees many incremental chunks and the parser must build up the
// block list piece-by-piece. The tests assert user-visible behavior; performance
// properties (memo cache hit rates, closed-block ref stability, etc.) are
// covered by unit tests on the parser and renderer.

test("closed dyad-write blocks remain mounted while later blocks are still streaming", async ({
  po,
}) => {
  await po.setUp();

  await po.sendPrompt("tc=streaming-render-multi-write", {
    skipWaitForCompletion: true,
  });

  const messagesList = po.page.getByTestId("messages-list");

  const blockA = messagesList.getByText("StreamingRenderBlockA.tsx", {
    exact: true,
  });
  const blockE = messagesList.getByText("StreamingRenderBlockE.tsx", {
    exact: true,
  });

  // Block A is the first dyad-write in the fixture; it closes early in the
  // stream. Wait for it to appear in the rendered output.
  await expect(blockA).toBeVisible({ timeout: 15_000 });

  // Block E is the last dyad-write; by the time it appears all earlier blocks
  // must already be closed. This is the critical assertion: if the renderer
  // were re-keying or unmounting closed blocks across chunks, block A would
  // disappear by the time block E was rendered.
  await expect(blockE).toBeVisible({ timeout: 15_000 });
  await expect(blockA).toBeVisible();

  // Wait for stream completion before final assertions.
  await po.chatActions.waitForChatCompletion();

  // All five blocks visible at the end of the stream.
  for (const name of [
    "StreamingRenderBlockA.tsx",
    "StreamingRenderBlockB.tsx",
    "StreamingRenderBlockC.tsx",
    "StreamingRenderBlockD.tsx",
    "StreamingRenderBlockE.tsx",
  ]) {
    await expect(messagesList.getByText(name, { exact: true })).toBeVisible();
  }
});

test("in-progress dyad-write block surfaces path attribute and pending indicator before close tag arrives", async ({
  po,
}) => {
  await po.setUp();

  await po.sendPrompt("tc=streaming-render-large-block", {
    skipWaitForCompletion: true,
  });

  const messagesList = po.page.getByTestId("messages-list");

  // Wait for the pending indicator first. It only renders while the custom-tag
  // block is in progress (state === "pending"); once the closing tag arrives
  // the block transitions to "finished" and this indicator disappears. The
  // fixture is sized so that the open-tag window is several seconds long,
  // giving Playwright a comfortable window to observe it.
  await expect(messagesList.getByText("Writing...")).toBeVisible({
    timeout: 10_000,
  });

  // Path attribute is surfaced in the open-tag header as soon as the parser
  // sees the opening `<dyad-write path="..." ...>` and emits a pending block.
  // The pending indicator visible above implies the open block is rendered,
  // so the path must be visible too.
  await expect(
    messagesList.getByText("StreamingRenderLargeBlock.tsx", { exact: true }),
  ).toBeVisible();

  await po.chatActions.waitForChatCompletion();

  // After completion, the pending indicator is gone and the file path remains.
  await expect(
    messagesList.getByText("StreamingRenderLargeBlock.tsx", { exact: true }),
  ).toBeVisible();
  await expect(messagesList.getByText("Writing...")).not.toBeVisible();
});
