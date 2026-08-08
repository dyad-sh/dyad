import { testWithConfig } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup("setup ai provider via settings", async ({ po }) => {
  await po.navigation.goToSettingsTab();

  await expect(
    po.page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  await po.page.getByRole("heading", { name: "Google" }).click();
  await expect(
    po.page.getByRole("heading", { name: "Configure Google" }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Go Back" }).click();

  await po.page.getByRole("heading", { name: "OpenRouter" }).click();
  await expect(
    po.page.getByRole("heading", { name: "Configure OpenRouter" }),
  ).toBeVisible();
});
