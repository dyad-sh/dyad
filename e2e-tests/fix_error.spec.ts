import { testSkipIfWindows } from "./helpers/test_helper";

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
