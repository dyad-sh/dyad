import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the AI-generated E2E testing feature (the Tests
// panel opt-in + isolation warnings). These drive the UI orchestration with the
// fake LLM; they deliberately don't spawn a real Playwright run (that would be
// Playwright-in-Playwright and is covered by narrower unit/integration tests).

testSkipIfWindows(
  "prompts to switch to Agent mode when generating a test from a non-agent chat",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Put the chat in a non-agent mode (Build) so the button must confirm.
    await po.chatActions.selectChatMode("build");

    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();
    await expect(po.page.getByText("No tests yet")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Clicking "Generate a test" opens the Agent-mode confirmation dialog
    // instead of sending the request straight away.
    await po.page.getByTestId("generate-test-button").click();
    await expect(po.page.getByTestId("agent-mode-required-dialog")).toBeVisible(
      { timeout: Timeout.MEDIUM },
    );

    // Cancel dismisses it without sending anything to chat.
    await po.page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      po.page.getByTestId("agent-mode-required-dialog"),
    ).toBeHidden();
    await expect(po.page.getByText("No tests yet")).toBeVisible();
  },
);

testSkipIfWindows(
  "gates testing behind a per-app opt-in that persists and can be disabled",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    await po.previewPanel.selectPreviewMode("tests");

    // Off by default: the opt-in gate is shown and run controls are hidden.
    await expect(po.previewPanel.locateEnableTestingButton()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.previewPanel.locateRunAllTestsButton()).toBeHidden();

    // Enabling reveals the panel body (empty state) and hides the gate.
    await po.previewPanel.clickEnableTesting();
    await expect(po.page.getByText("No tests yet")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.previewPanel.locateEnableTestingButton()).toBeHidden();

    // The opt-in is persisted to the backend: remounting the panel (via a mode
    // round-trip) re-reads it as enabled rather than falling back to the gate.
    await po.previewPanel.selectPreviewMode("code");
    await po.previewPanel.selectPreviewMode("tests");
    await expect(po.previewPanel.locateDisableTestingButton()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Disabling returns to the gate.
    await po.previewPanel.clickDisableTesting();
    await expect(po.previewPanel.locateEnableTestingButton()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  },
);

testSkipIfWindows(
  "warns strongly when the app's data can't be isolated",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    // A plain imported app has no managed database, so runs can't be isolated —
    // the opt-in gate must show the strongest data-safety warning.
    await po.importApp("minimal");

    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page
        .locator("#preview-panel")
        .getByText(/can't isolate a custom or non-database backend/),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);

testSkipIfWindows(
  "reassures when tests run against an isolated Neon database copy",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.navigation.goToTemplatesAndSelectTemplate("Next.js Template");
    await po.chatActions.selectChatMode("build");
    await po.sendPrompt("tc=basic", { timeout: Timeout.EXTRA_LONG });
    await po.sendPrompt("tc=add-neon");

    // Connect a Neon project so runs get an isolated branch copy.
    await po.appManagement.startDatabaseIntegrationSetup("neon");
    await po.appManagement.clickConnectNeonButton();
    await po.appManagement.selectNeonProject("Test Project");

    // Connecting Neon navigates to the app-details page; go back to the app so
    // the preview panel (and Tests panel within it) is mounted again.
    await po.navigation.clickBackButton();

    // The gate now shows the calm, reassuring warning instead of the amber one.
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page
        .locator("#preview-panel")
        .getByText(/temporary copy of your Neon database/),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);
