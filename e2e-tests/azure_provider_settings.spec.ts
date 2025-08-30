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

  // Check that Azure-specific UI is displayed
  await expect(po.page.getByText("Azure OpenAI Configuration")).toBeVisible();
  await expect(po.page.getByText("AZURE_API_KEY")).toBeVisible();
  await expect(po.page.getByText("AZURE_RESOURCE_NAME")).toBeVisible();

  // Check environment variable status indicators exist
  await expect(
    po.page.getByText("Environment Variables Configuration"),
  ).toBeVisible();

  // Check setup instructions are present
  await expect(po.page.getByText("How to configure:")).toBeVisible();
  await expect(
    po.page.getByText("Get your API key from the Azure portal"),
  ).toBeVisible();
  await expect(po.page.getByText("Find your resource name")).toBeVisible();
  await expect(
    po.page.getByText("Set these environment variables before starting Dyad"),
  ).toBeVisible();

  // Check that status indicators show "Not Set" (since no env vars are configured in test)
  const statusElements = po.page.locator(".bg-red-100, .bg-red-800\\/20");
  await expect(statusElements.first()).toBeVisible();
});
