import { testSkipIfWindows, test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("fix error with AI", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-error");

  await po.previewPanel.snapshotPreviewErrorBanner({
    name: "fix-error-with-AI-1.aria.yml",
  });

  await expect(
    po.page.getByText("Error Line 6 error", { exact: true }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page.getByText("Error Line 6 error", { exact: true }).click();
  await po.previewPanel.snapshotPreviewErrorBanner({
    name: "fix-error-with-AI-2.aria.yml",
  });

  await po.previewPanel.clickFixErrorWithAI();
  await po.chatActions.waitForChatCompletion();
  await po.snapshotMessages({ name: "fix-error-with-AI-3" });

  // TODO: this is an actual bug where the error banner should not
  // be shown, however there's some kind of race condition and
  // we don't reliably detect when the HMR update has completed.
  // await po.previewPanel.locatePreviewErrorBanner().waitFor({ state: "hidden" });
  await po.previewPanel.snapshotPreview({
    name: "fix-error-with-AI-4.aria.yml",
  });
});

testSkipIfWindows("copy error message from banner", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-error");

  await expect(
    po.page.getByText("Error Line 6 error", { exact: true }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  await po.previewPanel.clickCopyErrorMessage();

  const clipboardText = await po.getClipboardText();
  expect(clipboardText).toContain("Error Line 6 error");
  expect(clipboardText.length).toBeGreaterThan(0);

  await expect(po.page.getByRole("button", { name: "Copied" })).toBeVisible();

  await expect(po.page.getByRole("button", { name: "Copied" })).toBeHidden({
    timeout: Timeout.SHORT,
  });
});
test("fix all errors button", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-multiple-errors");

  await expect(
    po.page.getByRole("button", { name: /Fix All Errors/ }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.previewPanel.clickFixAllErrors();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotMessages();
});
