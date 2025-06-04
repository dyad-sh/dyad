import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("refresh app", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  // Drop the document.body inside the contentFrame to make
  // sure refresh works.
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .locator("body")
    .evaluate((body) => {
      body.remove();
    });

  await po.clickPreviewRefresh();
  await po.snapshotPreview();
});
