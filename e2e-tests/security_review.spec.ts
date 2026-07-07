import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

// Skipping because snapshotting the security findings table is not
// consistent across platforms because different amounts of text
// get ellipsis'd out.
testSkipIfWindows("security review", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");

  await po.securityReview.clickRunSecurityReview();
  await po.snapshotServerDump("all-messages");
  await po.securityReview.snapshotSecurityFindingsTable();

  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await po.chatActions.waitForChatCompletion();
  await expect(async () => {
    const text = await po.page.getByTestId("messages-list").textContent();
    expect(text).toMatch(
      /Please fix the following security issue[\s\S]*Version 2:/,
    );
  }).toPass({ timeout: Timeout.MEDIUM });
  await po.snapshotMessages({
    name: "security-review---fix-issue",
    replaceDumpPath: true,
  });
});

testSkipIfWindows(
  "security review - edit and use knowledge",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("tc=1");

    await po.previewPanel.selectPreviewMode("security");
    await po.page.getByRole("button", { name: "Edit Security Rules" }).click();
    await po.page
      .getByRole("textbox", { name: "# SECURITY_RULES.md\\n\\" })
      .click();
    await po.page
      .getByRole("textbox", { name: "# SECURITY_RULES.md\\n\\" })
      .fill("testing\nrules123");
    await po.page.getByRole("button", { name: "Save" }).click();

    await po.securityReview.clickRunSecurityReview();
    await po.snapshotServerDump("all-messages");
  },
);

// Multi-select fix prompt semantics and review/fix db effects are covered by
// the vitest hybrid suite (security_review.integration.test.ts); the two
// kept tests above remain the canonical SecurityPanel flows (the panel lives
// outside ChatPanel, and the Edit Security Rules dialog save path exists
// only here). Chat-tab creation chrome is covered by chat_tabs.spec.ts.
