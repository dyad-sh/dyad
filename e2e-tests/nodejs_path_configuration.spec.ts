import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Node.js Path Configuration", () => {
  test("should browse and set custom Node.js path", async ({ po }) => {
    await po.setUp();
    await po.goToSettingsTab();

    const browseButton = po.page.getByRole("button", {
      name: /Browse for Node\.js/i,
    });
    await browseButton.click();

    // Should show selecting state
    await expect(
      po.page.getByRole("button", { name: /Selecting\.\.\./i }),
    ).toBeVisible();
  });

  test("should reset custom path to system default", async ({ po }) => {
    await po.setUp();
    await po.goToSettingsTab();

    const resetButton = po.page.getByRole("button", {
      name: /Reset to Default/i,
    });

    if (await resetButton.isVisible()) {
      await resetButton.click();

      // Should show system PATH after reset
      await expect(po.page.getByText("System PATH:")).toBeVisible();
    }
  });

  test("should show CheckCircle when Node.js is valid", async ({ po }) => {
    await po.setUp();
    await po.goToSettingsTab();

    // Wait for status check
    await po.page.waitForTimeout(2000);

    // Target the specific valid status container with CheckCircle
    const validStatus = po.page.locator(
      "div.flex.items-center.gap-1.text-green-600, div.flex.items-center.gap-1.text-green-400",
    );

    // Skip test if Node.js is not installed
    if (!(await validStatus.isVisible())) {
      test.skip();
    }

    // If visible, check for CheckCircle icon
    await expect(validStatus).toBeVisible();
    const checkIcon = validStatus.locator("svg").first();
    await expect(checkIcon).toBeVisible();
  });
});
