import { testWithConfig } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup("setup ai provider", async ({ po }) => {
  await po.page
    .getByRole("button", { name: "Setup Google Gemini API Key" })
    .click();
  await expect(
    po.page.getByRole("heading", { name: "Configure Google" }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await po.page
    .getByRole("button", { name: "Setup OpenRouter API Key Free" })
    .click();
  await expect(
    po.page.getByRole("heading", { name: "Configure OpenRouter" }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await po.page
    .getByRole("button", { name: "Setup other AI providers" })
    .click();
});
