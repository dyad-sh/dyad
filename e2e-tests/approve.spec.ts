import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("write to index, approve, check preview", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=write-index");
  await po.snapshotMessages();
  await po.approveProposal();

  // Should be slightly different from above, because it will say "approved"
  await po.snapshotMessages();

  // This can be pretty slow because it's waiting for the app to build.
  await expect(po.getPreviewIframeElement()).toBeVisible({
    timeout: Timeout.LONG,
  });
  await po.snapshotPreview();
});
