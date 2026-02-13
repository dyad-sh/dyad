import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("capacitor upgrade and sync works", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");
  await po.appManagement.getTitleBarAppNameButton().click();
  await po.appManagement.clickAppUpgradeButton({ upgradeId: "capacitor" });
  await po.appManagement.expectNoAppUpgrades();
  await po.snapshotAppFiles({ name: "upgraded-capacitor" });

  await po.page.getByTestId("capacitor-controls").waitFor({ state: "visible" });

  // Helper to wait for sync operation to complete and dismiss error dialog if it appears
  // The sync operation may fail in E2E environment due to missing CocoaPods/Xcode
  const waitForSyncCompletionAndDismissErrorIfNeeded = async (
    buttonText: string,
  ) => {
    // Wait for either the button to return to idle state OR an error dialog to appear
    const idleButton = po.page.getByRole("button", {
      name: new RegExp(buttonText, "i"),
    });
    const errorDialog = po.page.getByRole("dialog");

    // Use Promise.race to wait for either condition
    await expect(async () => {
      const isButtonEnabled =
        (await idleButton.isVisible()) &&
        !(await idleButton.isDisabled()) &&
        (await idleButton.textContent())?.includes(buttonText);
      const isErrorDialogVisible = await errorDialog.isVisible();
      expect(isButtonEnabled || isErrorDialogVisible).toBe(true);
    }).toPass({ timeout: Timeout.EXTRA_LONG });

    // If error dialog appeared, dismiss it
    if (await errorDialog.isVisible()) {
      // Click the Close button within the dialog
      await errorDialog.getByRole("button", { name: "Close" }).first().click();
      // Wait for dialog to close
      await expect(errorDialog).toBeHidden({ timeout: Timeout.SHORT });
    }
  };

  // Test sync & open iOS functionality - the button contains "Sync & Open iOS"
  const iosButton = po.page.getByRole("button", { name: /Sync & Open iOS/i });
  await iosButton.click();

  // Wait for sync operation to complete and dismiss error dialog if needed
  await waitForSyncCompletionAndDismissErrorIfNeeded("Sync & Open iOS");

  // Verify the button is back to idle state
  await expect(
    po.page.getByRole("button", { name: /Sync & Open iOS/i }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  // Test sync & open Android functionality - the button contains "Sync & Open Android"
  const androidButton = po.page.getByRole("button", {
    name: /Sync & Open Android/i,
  });
  await androidButton.click();

  // Wait for sync operation to complete and dismiss error dialog if needed
  await waitForSyncCompletionAndDismissErrorIfNeeded("Sync & Open Android");

  // Verify the button is back to idle state
  await expect(
    po.page.getByRole("button", { name: /Sync & Open Android/i }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});
