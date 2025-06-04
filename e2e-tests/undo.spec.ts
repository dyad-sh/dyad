import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("undo", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");
  await po.sendPrompt("tc=write-index-2");

  const iframe = po.getPreviewIframeElement();
  await expect(
    iframe.contentFrame().getByText("Testing:write-index(2)!"),
  ).toBeVisible({
    // This can be pretty slow because it's waiting for the app to build.
    timeout: Timeout.LONG,
  });

  await po.clickUndo();

  await expect(
    iframe.contentFrame().getByText("Testing:write-index!"),
  ).toBeVisible({
    // Also, could be slow.
    timeout: Timeout.LONG,
  });

  await po.clickUndo();

  await expect(
    iframe.contentFrame().getByText("Welcome to Your Blank App"),
  ).toBeVisible({
    // Also, could be slow.
    timeout: Timeout.LONG,
  });
});
