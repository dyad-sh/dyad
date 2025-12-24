import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const runUndoTest = async (po: PageObject, nativeGit: boolean) => {
  await po.setUp({ autoApprove: true, nativeGit });
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
};

testSkipIfWindows("undo", async ({ po }) => {
  await runUndoTest(po, false);
});

testSkipIfWindows("undo with native git", async ({ po }) => {
  await runUndoTest(po, true);
});

testSkipIfWindows("undo after assistant with no code", async ({ po }) => {
  await po.setUp({ autoApprove: true, nativeGit: false });

  // First prompt - no code generated
  await po.sendPrompt("tc=no-code-response");

  // Second prompt - generates code
  await po.sendPrompt("tc=write-index");

  const iframe = po.getPreviewIframeElement();
  await expect(
    iframe.contentFrame().getByText("Testing:write-index!"),
  ).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Undo should work even though first assistant had no commit
  await po.clickUndo();

  await expect(
    iframe.contentFrame().getByText("Welcome to Your Blank App"),
  ).toBeVisible({
    timeout: Timeout.LONG,
  });
});
