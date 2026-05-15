import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "database url guide shows connection URIs for development and production",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.navigation.goToHubAndSelectTemplate("Next.js Template");
    await po.chatActions.selectChatMode("build");
    await po.sendPrompt("tc=basic", { timeout: Timeout.EXTRA_LONG });
    await po.sendPrompt("tc=add-neon");

    await po.appManagement.startDatabaseIntegrationSetup("neon");
    await po.appManagement.clickConnectNeonButton();
    await po.appManagement.selectNeonProject("Test Project");

    await po.navigation.clickBackButton();
    await po.previewPanel.selectPreviewMode("publish");

    // Scope to the Database URL panel — the chat history also renders a
    // "Continue" button from the add-integration message.
    const panel = po.page.getByTestId("database-url-panel");
    await expect(panel).toBeVisible({ timeout: Timeout.MEDIUM });

    // The picker shows Continue disabled until an environment is chosen.
    const continueButton = panel.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeDisabled();

    // Pick Development → URI for the development branch is fetched.
    await panel.getByRole("button", { name: /^Development/ }).click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    const devInput = panel.getByLabel("Development database URL");
    await expect(devInput).toHaveValue(
      "postgresql://test:test@test-development.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );

    // Copy button writes the URI to the clipboard.
    await panel.getByRole("button", { name: "Copy URL" }).click();
    expect(await po.getClipboardText()).toBe(
      "postgresql://test:test@test-development.neon.tech/test",
    );

    // Go back to the selection and pick Production → URI for the default
    // (production) branch is fetched instead.
    await panel.getByRole("button", { name: "Back to selection" }).click();
    await panel.getByRole("button", { name: /^Production/ }).click();
    await panel.getByRole("button", { name: "Continue" }).click();

    const prodInput = panel.getByLabel("Production database URL");
    await expect(prodInput).toHaveValue(
      "postgresql://test:test@test-main.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );
  },
);
