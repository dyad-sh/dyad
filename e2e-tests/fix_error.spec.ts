import { testSkipIfWindows, test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("fix error with AI", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-error");

  await po.snapshotPreviewErrorBanner();

  await po.page.getByText("Error Line 6 error", { exact: true }).click();
  await po.snapshotPreviewErrorBanner();

  await po.clickFixErrorWithAI();
  await po.waitForChatCompletion();
  await po.snapshotMessages();

  // TODO: this is an actual bug where the error banner should not
  // be shown, however there's some kind of race condition and
  // we don't reliably detect when the HMR update has completed.
  // await po.locatePreviewErrorBanner().waitFor({ state: "hidden" });
  await po.snapshotPreview();
});

testSkipIfWindows("copy error message from banner", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=create-error");

  await po.page.getByText("Error Line 6 error", { exact: true }).waitFor({
    state: "visible",
  });

  await po.clickCopyErrorMessage();

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

  await po.clickFixAllErrors();
  await po.waitForChatCompletion();

  await po.snapshotMessages();
});
