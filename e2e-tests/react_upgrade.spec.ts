import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "react upgrade button shown for older react version",
  async ({ po }) => {
    await po.setUp();
    await po.importApp("react-upgrade");
    await po.getTitleBarAppNameButton().click();

    // Verify the React upgrade button is visible for an app with React 18.2.0
    await expect(
      po.locateAppUpgradeButton({ upgradeId: "react-upgrade" }),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Click the upgrade button
    await po.clickAppUpgradeButton({ upgradeId: "react-upgrade" });

    // Verify the button becomes disabled during upgrade
    await expect(
      po.locateAppUpgradeButton({ upgradeId: "react-upgrade" }),
    ).toBeDisabled({
      timeout: Timeout.MEDIUM,
    });

    // Verify the upgrade completes and button becomes hidden
    await po.expectAppUpgradeButtonIsNotVisible({ upgradeId: "react-upgrade" });
  },
);
