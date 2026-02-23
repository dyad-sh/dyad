import { testSkipIfWindows, test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("fix error with AI", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-error");

  await po.previewPanel.snapshotPreviewErrorBanner();

  await po.page.getByText("Error Line 6 error", { exact: true }).click();
  await po.previewPanel.snapshotPreviewErrorBanner();

  await po.previewPanel.clickFixErrorWithAI();
  await po.chatActions.waitForChatCompletion();
  await po.snapshotMessages();

  // The HMR update after an error fix may leave the iframe body empty
  // due to a Vite recovery-from-error race condition. If the body stays
  // empty, restart the app server to force a full reload.
  const iframeBody = po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .locator("body");
  try {
    await expect(iframeBody).not.toHaveText("", { timeout: 5_000 });
  } catch {
    await po.clickRestart();
  }

  await po.previewPanel.snapshotPreview();
});

testSkipIfWindows("copy error message from banner", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-error");

  await po.page.getByText("Error Line 6 error", { exact: true }).waitFor({
    state: "visible",
  });

  await po.previewPanel.clickCopyErrorMessage();

  const clipboardText = await po.getClipboardText();
  expect(clipboardText).toContain("Error Line 6 error");
  expect(clipboardText.length).toBeGreaterThan(0);

  await expect(po.page.getByRole("button", { name: "Copied" })).toBeVisible();

  await expect(po.page.getByRole("button", { name: "Copied" })).toBeHidden({
    timeout: 3000,
  });
});
test("fix all errors button", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-multiple-errors");

  await po.previewPanel.clickFixAllErrors();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotMessages();
});
