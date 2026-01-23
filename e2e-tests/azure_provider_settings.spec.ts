import { expect } from "@playwright/test";
import { test as testWithPo } from "./helpers/test_helper";

testWithPo("Azure provider settings UI", async ({ po }) => {
  await po.setUp();
  await po.goToSettingsTab();

  // Look for Azure OpenAI in the provider list
  await expect(po.page.getByText("Azure OpenAI")).toBeVisible();

  // Navigate to Azure provider settings
  await po.page.getByText("Azure OpenAI").click();

  // Wait for Azure settings page to load
  await po.page.waitForSelector('h1:has-text("Configure Azure OpenAI")', {
    state: "visible",
    timeout: 5000,
  });

  // Confirm the new configuration form is rendered
  await expect(
    po.page.getByText("Azure OpenAI Configuration Required"),
  ).toBeVisible();
  await expect(po.page.getByLabel("Resource Name")).toBeVisible();
  await expect(po.page.getByLabel("API Key")).toBeVisible();
  await expect(
    po.page.getByRole("button", { name: "Save Settings" }),
  ).toBeVisible();

  // Environment variable helper section should still be available
  await expect(
    po.page.getByText("Environment Variables (optional)"),
  ).toBeVisible();

  // FIX: disambiguate text matches to avoid strict mode violation
  await expect(
    po.page.getByText("AZURE_API_KEY", { exact: true }),
  ).toBeVisible();
  await expect(
    po.page.getByText("AZURE_RESOURCE_NAME", { exact: true }),
  ).toBeVisible();

  // Since no env vars are configured in the test run, both should read "Not Set"
  await expect(
    po.page
      .getByTestId("azure-api-key-status")
      .getByText("Not Set", { exact: true }),
  ).toBeVisible();
  await expect(
    po.page
      .getByTestId("azure-resource-name-status")
      .getByText("Not Set", { exact: true }),
  ).toBeVisible();

  // The guidance text should explain precedence between saved settings and environment variables
  await expect(
    po.page.getByText(
      "Values saved in Settings take precedence over environment variables.",
    ),
  ).toBeVisible();
});
