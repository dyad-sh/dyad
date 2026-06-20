import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * Test for configuring max tool call steps setting
 */
testSkipIfWindows("max tool call steps setting", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");

  // Go to settings and change the max tool call steps
  await po.navigation.goToSettingsTab();
  const beforeSettings1 = po.settings.recordSettings();

  // Change to Low (25)
  await po.page
    .getByRole("combobox", { name: "Max Tool Calls (Agent)" })
    .click();
  await po.page.getByRole("option", { name: "Low (25)" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings1);

  // Verify the setting persists
  await po.page.getByText("Go Back").click();
  await po.navigation.goToSettingsTab();
  const beforeSettings2 = po.settings.recordSettings();

  // Change to High (200)
  await po.page
    .getByRole("combobox", { name: "Max Tool Calls (Agent)" })
    .click();
  await po.page.getByRole("option", { name: "High (200)" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings2);

  // Change back to Default
  await po.page.getByText("Go Back").click();
  await po.navigation.goToSettingsTab();
  const beforeSettings3 = po.settings.recordSettings();

  await po.page
    .getByRole("combobox", { name: "Max Tool Calls (Agent)" })
    .click();
  await po.page.getByRole("option", { name: "Default (100)" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings3);
});
