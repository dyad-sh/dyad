import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("reject", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=write-index");
  await po.snapshotMessages();
  await po.rejectProposal();

  // Should be slightly different from above, because it will say "rejected"
  await po.snapshotMessages();

  await expect(po.getPreviewIframeElement()).not.toBeVisible();
});
