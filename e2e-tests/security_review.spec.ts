import { test, testSkipIfWindows } from "./helpers/test_helper";

// Skipping because snapshotting the security findings table is not
// consistent across platforms because different amounts of text
// get ellipsis'd out.
testSkipIfWindows("security review", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.selectPreviewMode("security");

  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.waitForChatCompletion();
  await po.snapshotServerDump("all-messages");
  await po.snapshotSecurityFindingsTable();

  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await po.waitForChatCompletion();
  await po.snapshotMessages();
});

test("security review - edit and use knowledge", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.selectPreviewMode("security");
  await po.page.getByRole("button", { name: "Edit Security Rules" }).click();
  await po.page
    .getByRole("textbox", { name: "# SECURITY_RULES.md\\n\\" })
    .click();
  await po.page
    .getByRole("textbox", { name: "# SECURITY_RULES.md\\n\\" })
    .fill("testing\nrules123");
  await po.page.getByRole("button", { name: "Save" }).click();

  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.waitForChatCompletion();
  await po.snapshotServerDump("all-messages");
});

test("security review - multi-select and fix issues", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.selectPreviewMode("security");

  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.waitForChatCompletion();

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
  await po.waitForChatCompletion();
  await po.snapshotMessages();
});
