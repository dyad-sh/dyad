import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the AI-generated E2E testing feature (the Tests
// panel + <dyad-generate-test> tag). These drive the UI orchestration with the
// fake LLM; they deliberately don't spawn a real Playwright run (that would be
// Playwright-in-Playwright and is covered by narrower unit/integration tests).

testSkipIfWindows(
  "generates a test that appears in chat, on disk, and in the Tests panel",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Open the Tests panel and opt in. With no specs yet, the empty state shows.
    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();
    await expect(po.page.getByText("No tests yet")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // The AI generates a test via <dyad-generate-test>.
    await po.sendPrompt("tc=generate-test");

    // 1. It renders as a distinct test card in the chat transcript.
    await expect(po.page.getByTestId("dyad-generate-test")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // 2. It's written to disk under tests/ (forced there by normalizeTestPath).
    await po.snapshotAppFiles({ name: "generate-test-written" });

    // 3. It's auto-discovered into the panel once the turn ends (no manual
    //    refresh) — the invalidate-on-stream-end path in TestsPanel.
    await expect(
      po.page.locator("#preview-panel").getByText("critical-flow.spec.ts"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
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
    await po.navigation.goToHubAndSelectTemplate("Next.js Template");
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
