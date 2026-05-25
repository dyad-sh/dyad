import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "deployment env guide shows env vars for development and production",
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

    // Scope to the Deployment Env panel — the chat history also renders a
    // "Continue" button from the add-integration message.
    const panel = po.page.getByTestId("deployment-env-panel");
    await expect(panel).toBeVisible({ timeout: Timeout.MEDIUM });

    // The picker shows Continue disabled until an environment is chosen.
    const continueButton = panel.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeDisabled();

    // Pick Development → URI for the development branch is fetched.
    await panel.getByRole("button", { name: /^Development/ }).click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    const devDbInput = panel.getByRole("textbox", { name: "DATABASE_URL" });
    await expect(devDbInput).toHaveValue(
      "postgresql://test:test@test-development.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );

    // Auth env vars are populated from the mocked Neon Auth API.
    await expect(
      panel.getByRole("textbox", { name: "NEON_AUTH_BASE_URL" }),
    ).toHaveValue(
      "https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    await expect(
      panel.getByRole("textbox", { name: "NEON_AUTH_COOKIE_SECRET" }),
    ).not.toHaveValue("");

    // Copy button writes the DATABASE_URL to the clipboard.
    await panel.getByRole("button", { name: "Copy DATABASE_URL" }).click();
    expect(await po.getClipboardText()).toBe(
      "postgresql://test:test@test-development.neon.tech/test",
    );

    // Go back to the selection and pick Production → URI for the default
    // (production) branch is fetched instead.
    await panel.getByRole("button", { name: "Back to selection" }).click();
    await panel.getByRole("button", { name: /^Production/ }).click();
    await panel.getByRole("button", { name: "Continue" }).click();

    const prodDbInput = panel.getByRole("textbox", { name: "DATABASE_URL" });
    await expect(prodDbInput).toHaveValue(
      "postgresql://test:test@test-main.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );
    await expect(
      panel.getByRole("textbox", { name: "NEON_AUTH_BASE_URL" }),
    ).toHaveValue(
      "https://test-main.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
  },
);
