import { test } from "./helpers/test_helper";

test("template - community", async ({ po }) => {
  await po.goToHubTab();
  // This is a community template, so we should see the consent dialog
  const beforeSettings1 = po.recordSettings();
  await po.selectTemplate("Angular");
  await po.page.getByRole("button", { name: "Cancel" }).click();
  po.snapshotSettingsDelta(beforeSettings1);

  const beforeSettings2 = po.recordSettings();
  await po.selectTemplate("Angular");
  await po.page.getByRole("button", { name: "Accept" }).click();
  await po.page
    .locator("section")
    .filter({ hasText: "Community" })
    .locator("div")
    .first()
    .click();
  po.snapshotSettingsDelta(beforeSettings2);
});
