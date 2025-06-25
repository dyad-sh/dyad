import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("thinking budget", async ({ po }) => {
  await po.setUpDyadPro();
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Pro" });
  await po.sendPrompt("tc=1");

  // Low
  await po.goToSettingsTab();
  await po.page.getByRole("combobox", { name: "Thinking Budget" }).click();
  await po.page.getByRole("option", { name: "Low" }).click();
  await po.snapshotSettings();
  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] hi");
  await po.snapshotServerDump("request");

  // Medium
  await po.goToSettingsTab();
  await po.page.getByRole("combobox", { name: "Thinking Budget" }).click();
  await po.page.getByRole("option", { name: "Medium (default)" }).click();
  await po.snapshotSettings();
  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] hi");
  await po.snapshotServerDump("request");

  // High
  await po.goToSettingsTab();
  await po.page.getByRole("combobox", { name: "Thinking Budget" }).click();
  await po.page.getByRole("option", { name: "High" }).click();
  await po.snapshotSettings();
  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] hi");
  await po.snapshotServerDump("request");
});
