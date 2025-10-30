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
