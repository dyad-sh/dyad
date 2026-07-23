import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the preview test recorder. The imported app has no
// database, so recording runs with isolation mode "none" (no branch/user, no
// auth) — the fast, network-free path. Like ai_e2e_testing, this drives the UI
// orchestration and asserts the generated spec is written and discovered; it
// does NOT spawn a real Playwright run (that would be Playwright-in-Playwright).
testSkipIfWindows(
  "records interactions in the preview and saves a runnable spec",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("recorder");

    // Recording requires the per-app testing opt-in.
    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();

    // Run the app so the preview (and the injected recorder script) is live.
    await po.previewPanel.selectPreviewMode("preview");
    await po.clickRestart();
    await po.previewPanel.expectPreviewIframeIsVisible();

    // Start recording; the status bar appears once the session is armed.
    await po.page.getByTestId("preview-record-button").click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeVisible({
      timeout: Timeout.LONG,
    });

    // Drive the app inside the preview iframe — these are trusted inputs, so the
    // recorder captures them.
    const frame = po.previewPanel.getPreviewIframeElement().contentFrame();
    await frame.getByRole("button", { name: "Increment" }).click();
    await frame.getByLabel("Name").fill("Ada");
    await frame.getByLabel("Subscribe").check();

    // At least one step registered.
    await expect(
      po.page.getByTestId("preview-recording-step-count"),
    ).not.toHaveText("0 steps");

    // Name and save the recording.
    await po.page.getByTestId("preview-recording-name-input").fill("add item");
    await po.page.getByTestId("preview-recording-save-button").click();

    // The spec is written under tests/ and auto-discovered into the panel.
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page.locator("#preview-panel").getByText("recorded-add-item.spec.ts"),
    ).toBeVisible({ timeout: Timeout.LONG });
  },
);
