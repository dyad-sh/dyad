import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("context window", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("tc=1");
  await po.chatActions.sendPrompt("tc=2");
  await po.chatActions.sendPrompt("[dump] tc=3");
  await po.snapshotServerDump();
  await po.chatActions.sendPrompt("[dump] tc=4");
  await po.snapshotServerDump();
  await po.chatActions.sendPrompt("[dump] tc=5");
  await po.snapshotServerDump();

  await po.navigation.goToSettingsTab();
  const beforeSettings = po.settings.recordSettings();
  await po.page
    .getByRole("combobox", { name: "Maximum number of chat turns" })
    .click();
  await po.page.getByRole("option", { name: "Plus (5)" }).click();

  // close combobox
  //   await po.page.keyboard.press("Escape");
  po.settings.snapshotSettingsDelta(beforeSettings);
  await po.page.getByText("Go Back").click();

  await po.chatActions.sendPrompt("[dump] tc=6");
  await po.snapshotServerDump();
});
