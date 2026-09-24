import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("attach pdf - chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("basic");

  await po.chatActions
    .getChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Attach files" }).click();

  const chatContextItem = po.page.getByText("Attach file as chat context");
  await expect(chatContextItem).toBeVisible();

  // Set up file chooser listener BEFORE clicking the menu item
  const fileChooserPromise = po.page.waitForEvent("filechooser");
  await chatContextItem.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("e2e-tests/fixtures/documents/sample.pdf");

  await po.sendPrompt("[dump]");
  // The PDF should reach the model as an inline file part, not as an
  // on-disk attachment the model has to read.
  await po.snapshotServerDump("last-message");
  await po.snapshotMessages({ replaceDumpPath: true });
});
