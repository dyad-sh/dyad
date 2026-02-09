import { test } from "./helpers/test_helper";

test("template - community", async ({ po }) => {
  await po.navigation.goToHubTab();
  // This is a community template, so we should see the consent dialog
  const beforeSettings1 = po.settings.recordSettings();
  await po.navigation.selectTemplate("Angular");
  await po.page.getByRole("button", { name: "Cancel" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings1);

  const beforeSettings2 = po.settings.recordSettings();
  await po.navigation.selectTemplate("Angular");
  await po.page.getByRole("button", { name: "Accept" }).click();
  await po.page
    .locator("section")
    .filter({ hasText: "Community" })
    .locator("div")
    .first()
    .click();
  po.settings.snapshotSettingsDelta(beforeSettings2);
});
