import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "unified database section shows env vars for development and production",
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

    // Scope to the unified Database section — the chat history also renders a
    // "Continue" button from the add-integration message.
    const panel = po.page.getByTestId("database-section");
    await expect(panel).toBeVisible({ timeout: Timeout.MEDIUM });

    // The app is on the development branch (Case 1), so the picker shows with
    // Continue disabled until an environment is chosen.
    const continueButton = panel.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeDisabled();

    // Pick Development → expand env vars → development branch values appear.
    await panel
      .getByRole("button", { name: /^Use development database/ })
      .click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await panel.getByRole("button", { name: "Environment variables" }).click();

    // Match the input by its exact label — the row also renders "Copy
    // DATABASE_URL" and "Show DATABASE_URL" buttons whose aria-labels would
    // otherwise make getByLabel ambiguous.
    const devDatabaseUrl = panel.getByLabel("DATABASE_URL", { exact: true });
    await expect(devDatabaseUrl).toHaveValue(
      "postgresql://test:test@test-development.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );
    await expect(
      panel.getByLabel("NEON_AUTH_BASE_URL", { exact: true }),
    ).toHaveValue(
      "https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    // The Next.js template surfaces a per-branch cookie secret.
    await expect(
      panel.getByLabel("NEON_AUTH_COOKIE_SECRET", { exact: true }),
    ).toHaveValue(/^[a-f0-9]{64}$/);

    // Copy button writes DATABASE_URL to the clipboard.
    await panel.getByRole("button", { name: "Copy DATABASE_URL" }).click();
    expect(await po.getClipboardText()).toBe(
      "postgresql://test:test@test-development.neon.tech/test",
    );

    // Go back, pick Production → the migration panel appears and the env vars
    // reflect the default (production) branch instead.
    await panel.getByRole("button", { name: "Back to selection" }).click();
    await panel
      .getByRole("button", { name: /^Separate production database/ })
      .click();
    await panel.getByRole("button", { name: "Continue" }).click();

    await expect(
      panel.getByRole("button", { name: "Migrate to Production" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    await panel.getByRole("button", { name: "Environment variables" }).click();

    const prodDatabaseUrl = panel.getByLabel("DATABASE_URL", { exact: true });
    await expect(prodDatabaseUrl).toHaveValue(
      "postgresql://test:test@test-main.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );
  },
);
