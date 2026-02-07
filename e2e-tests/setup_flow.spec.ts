import { testWithConfig } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup.describe("Setup Flow", () => {
  testSetup(
    "setup banner shows correct state when node.js is installed",
    async ({ po }) => {
      // Verify the "Setup Dyad" heading is visible
      await expect(
        po.page.getByText("Setup Dyad", { exact: true }),
      ).toBeVisible();

      // Verify both accordion sections are visible
      await expect(
        po.page.getByText("1. Install Node.js (App Runtime)"),
      ).toBeVisible();
      await expect(po.page.getByText("2. Setup AI Access")).toBeVisible();

      // Expand Node.js section and verify completed state
      await po.page.getByText("1. Install Node.js (App Runtime)").click();
      await expect(
        po.page.getByText(/Node\.js \(v[\d.]+\) installed/),
      ).toBeVisible();

      // AI provider section should show warning state (needs action)
      await expect(
        po.page.getByRole("button", { name: /Setup Google Gemini API Key/ }),
      ).toBeVisible();
      await expect(
        po.page.getByRole("button", { name: /Setup OpenRouter API Key/ }),
      ).toBeVisible();
    },
  );

  testSetup("node.js install flow", async ({ po }) => {
    // Start with Node.js not installed
    await po.setNodeMock(false);
    await po.page.reload();

    // Verify setup banner and install button are visible
    await expect(
      po.page.getByText("Setup Dyad", { exact: true }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("button", { name: "Install Node.js Runtime" }),
    ).toBeVisible();

    // Manual configuration link should be visible
    await expect(
      po.page.getByText("Node.js already installed? Configure path manually"),
    ).toBeVisible();

    // Click the install button (opens external URL)
    await po.page
      .getByRole("button", { name: "Install Node.js Runtime" })
      .click();

    // After clicking install, the "Continue" button should appear
    await expect(
      po.page.getByRole("button", { name: /Continue.*I installed Node\.js/ }),
    ).toBeVisible();

    // Simulate user having installed Node.js
    await po.setNodeMock(true);

    // Click the continue button
    await po.page
      .getByRole("button", { name: /Continue.*I installed Node\.js/ })
      .click();

    // Node.js should now show as installed
    await expect(
      po.page.getByText(/Node\.js \(v[\d.]+\) installed/),
    ).toBeVisible();

    // Reset mock
    await po.setNodeMock(null);
  });

  testSetup("ai provider setup flow", async ({ po }) => {
    // Verify setup banner is visible
    await expect(
      po.page.getByText("Setup Dyad", { exact: true }),
    ).toBeVisible();

    // Dismiss telemetry consent if present
    const laterButton = po.page.getByRole("button", { name: "Later" });
    if (await laterButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await laterButton.click();
    }

    // Test Google Gemini navigation
    await po.page
      .getByRole("heading", { name: "Setup Google Gemini API Key" })
      .click({ force: true });
    await expect(
      po.page.getByRole("heading", { name: "Configure Google" }),
    ).toBeVisible();
    await po.page.getByRole("button", { name: "Go Back" }).click();

    // Test OpenRouter navigation
    await po.page
      .getByRole("heading", { name: "Setup OpenRouter API Key" })
      .click();
    await expect(
      po.page.getByRole("heading", { name: "Configure OpenRouter" }),
    ).toBeVisible();
    await po.page.getByRole("button", { name: "Go Back" }).click();

    // Test other providers navigation
    await po.page
      .getByRole("heading", { name: "Setup other AI providers" })
      .click();
    await expect(po.page.getByRole("link", { name: "Settings" })).toBeVisible();

    // Now configure the test provider
    await po.setUpTestProvider();
    // Set up API key so provider is considered configured
    await po.page.getByRole("heading", { name: "test-provider" }).click();
    await po.setUpTestProviderApiKey();
    await po.setUpTestModel();

    // Go back to apps tab
    await po.goToAppsTab();

    // After configuring a provider, the setup banner should be gone
    await expect(
      po.page.getByText("Setup Dyad", { exact: true }),
    ).not.toBeVisible();
    await expect(po.page.getByText("Build a new app")).toBeVisible();
  });
});
