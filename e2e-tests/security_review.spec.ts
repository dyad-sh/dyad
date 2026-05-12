import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
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
  await po.snapshotMessages();
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

test("security review - multi-select and fix issues", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");

  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.chatActions.waitForChatCompletion();

  // Select the first two issues using individual checkboxes
  const checkboxes = po.page.getByRole("checkbox");
  // Skip the first checkbox (select all)
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();

  // Wait for the "Fix X Issues" button to appear
  const fixSelectedButton = po.page.getByRole("button", {
    name: "Fix 2 Issues",
  });
  await fixSelectedButton.waitFor({ state: "visible" });

  // Click the fix selected button
  await fixSelectedButton.click();
  await po.chatActions.waitForChatCompletion();
  await po.snapshotMessages();
});

test("security review - creates chat tabs", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");

  // Initial tab count should be 1 (the first chat)
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Run security review creates a new chat
  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.chatActions.waitForChatCompletion();

  // Tab count should increase to 2
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(2);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Click Fix Issue creates another chat
  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await po.chatActions.waitForChatCompletion();

  // Tab count should increase to 3
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(3);
  }).toPass({ timeout: Timeout.MEDIUM });
});
