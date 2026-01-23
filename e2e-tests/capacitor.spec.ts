import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("capacitor upgrade and sync works", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");
  await po.getTitleBarAppNameButton().click();
  await po.clickAppUpgradeButton({ upgradeId: "capacitor" });
  await po.expectNoAppUpgrades();
  await po.snapshotAppFiles({ name: "upgraded-capacitor" });

  await po.page.getByTestId("capacitor-controls").waitFor({ state: "visible" });

  // Test sync & open iOS functionality - the button contains "Sync & Open iOS"
  const iosButton = po.page.getByRole("button", { name: /Sync & Open iOS/i });
  await iosButton.click();

  // In test mode, this should complete without error and return to idle state
  // Wait for the button to be enabled again (not in loading state)
  await po.page
    .getByText("Sync & Open iOS")
    .waitFor({ state: "visible", timeout: Timeout.LONG });

  // Test sync & open Android functionality - the button contains "Sync & Open Android"
  const androidButton = po.page.getByRole("button", {
    name: /Sync & Open Android/i,
  });
  await androidButton.click();

  // In test mode, this should complete without error and return to idle state
  // Wait for the button to be enabled again (not in loading state)
  await po.page
    .getByText("Sync & Open Android")
    .waitFor({ state: "visible", timeout: Timeout.LONG });
});
