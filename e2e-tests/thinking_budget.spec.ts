import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("thinking budget", async ({ po }) => {
  await po.setUpConeyPro();
  await po.modelPicker.selectModel({
    provider: "Google",
    model: "Gemini 2.5 Pro",
  });
  await po.sendPrompt("tc=1");

  // Low
  await po.navigation.goToSettingsTab();
  const beforeSettings1 = po.settings.recordSettings();
  await po.page.getByRole("combobox", { name: "Thinking Budget" }).click();
  await po.page.getByRole("option", { name: "Low" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings1);
  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] hi");
  await po.snapshotServerDump("request");

  // Medium
  await po.navigation.goToSettingsTab();
  const beforeSettings2 = po.settings.recordSettings();
  await po.page.getByRole("combobox", { name: "Thinking Budget" }).click();
  await po.page.getByRole("option", { name: "Medium (default)" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings2);
  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] hi");
  await po.snapshotServerDump("request");

  // High
  await po.navigation.goToSettingsTab();
  const beforeSettings3 = po.settings.recordSettings();
  await po.page.getByRole("combobox", { name: "Thinking Budget" }).click();
  await po.page.getByRole("option", { name: "High" }).click();
  po.settings.snapshotSettingsDelta(beforeSettings3);
  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] hi");
  await po.snapshotServerDump("request");
});
