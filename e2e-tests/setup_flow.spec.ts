import { testWithConfig, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup.describe("Setup Flow", () => {
  testSetup(
    "home page shows build UI without setup accordion",
    async ({ po }) => {
      await po.page.waitForLoadState("domcontentloaded");

      await expect(
        po.page.getByTestId("home-chat-input-container"),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await expect(
        po.page.getByText("Setup Meta Human OS", { exact: true }),
      ).not.toBeVisible();
      await expect(
        po.page.getByText("1. Install Node.js (App Runtime)"),
      ).not.toBeVisible();
      await expect(po.page.getByText("2. Setup AI Access")).not.toBeVisible();
    },
  );

  testSetup("ai provider setup via settings", async ({ po }) => {
    await po.navigation.goToSettingsTab();

    await expect(
      po.page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();

    const laterButton = po.page.getByRole("button", { name: "Later" });
    if (await laterButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await laterButton.click();
    }

    await po.settings.setUpTestProvider();
    await po.page.getByRole("heading", { name: "test-provider" }).click();
    await po.settings.setUpTestProviderApiKey();
    await po.settings.setUpTestModel();

    await po.navigation.goToAppsTab();

    await expect(
      po.page.getByTestId("home-chat-input-container"),
    ).toBeVisible();
    await expect(
      po.page.getByText("Setup Meta Human OS", { exact: true }),
    ).not.toBeVisible();
  });
});
