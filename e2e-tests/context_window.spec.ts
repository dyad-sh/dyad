import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("context window", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=1");
  await po.sendPrompt("tc=2");
  await po.sendPrompt("[dump] tc=3");
  await po.snapshotServerDump();
  await po.sendPrompt("[dump] tc=4");
  await po.snapshotServerDump();
  await po.sendPrompt("[dump] tc=5");
  await po.snapshotServerDump();

  await po.goToSettingsTab();
  await po.page
    .getByRole("combobox", { name: "Maximum number of chat turns" })
    .click();
  await po.page.getByRole("option", { name: "Plus (5)" }).click();

  // close combobox
  //   await po.page.keyboard.press("Escape");
  await po.snapshotSettings();
  await po.page.getByText("Go Back").click();

  await po.sendPrompt("[dump] tc=6");
  await po.snapshotServerDump();
});
