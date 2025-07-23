import { test } from "./helpers/test_helper";

test("template - community", async ({ po }) => {
  await po.goToHubTab();
  // This is a community template, so we should see the consent dialog
  await po.selectTemplate("Angular");
  await po.page.getByRole("button", { name: "Cancel" }).click();
  await po.snapshotSettings();

  await po.selectTemplate("Angular");
  await po.page.getByRole("button", { name: "Accept" }).click();
  await po.page
    .locator("section")
    .filter({ hasText: "Community" })
    .locator("div")
    .first()
    .click();
  await po.snapshotSettings();
});
