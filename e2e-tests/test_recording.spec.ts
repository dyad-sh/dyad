import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the preview test recorder. The imported app has no
// database, so recording runs with isolation mode "none" (no branch/user, no
// auth) — the fast, network-free path. Like ai_e2e_testing, this drives the UI
// orchestration; it does NOT spawn a real Playwright run (that would be
// Playwright-in-Playwright).
//
// This covers capture and review: what the recorder catches, and what the review
// then offers. Turning that review into a file goes through the AI proposal, and
// is covered by test_assertions.spec.ts.
testSkipIfWindows(
  "records interactions in the preview and reviews them without writing a file",
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

    // Stop without naming it — naming is optional, and the AI names the test as
    // part of proposing it.
    await po.page.getByTestId("preview-recording-stop-button").click();

    // Stopping reviews the recording rather than writing it: the steps are
    // listed, and the file only appears once the user approves a proposal.
    const steps = po.page.getByTestId("preview-recorded-steps");
    await expect(steps).toBeVisible({ timeout: Timeout.LONG });
    await expect(steps).toContainText("Increment");
    await expect(steps).toContainText("Subscribe");
    await expect(
      po.page.getByTestId("preview-recording-review-title"),
    ).toHaveText("Untitled recording");

    // The review offers one way forward and one way out. Nothing here writes a
    // test nobody has checked.
    await expect(
      po.page.getByTestId("preview-recording-generate-assertions-button"),
    ).toHaveText("Generate test proposal");
    // Two-step: the recording exists nowhere else, so discarding confirms first.
    await po.page.getByTestId("preview-recording-discard-button").click();
    await po.page
      .getByTestId("preview-recording-discard-confirm-button")
      .click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeHidden({
      timeout: Timeout.LONG,
    });

    // Nothing was written: the Tests panel has no recorded spec in it.
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page.locator("#preview-panel").getByText(/recorded-.*\.spec\.ts/),
    ).toHaveCount(0);
  },
);

// The recorder lives in the preview, but the Tests panel is where users look
// for it: the entry point there has to switch tabs and arm the session.
testSkipIfWindows(
  "starts a recording from the Tests panel entry point",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("recorder");

    // Recording is part of the testing feature — no opt-in, no record button.
    await po.previewPanel.selectPreviewMode("preview");
    await expect(po.page.getByTestId("preview-record-button")).toBeHidden();

    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();

    await po.previewPanel.selectPreviewMode("preview");
    await po.clickRestart();
    await po.previewPanel.expectPreviewIframeIsVisible();
    await expect(po.page.getByTestId("preview-record-button")).toBeVisible();

    await po.previewPanel.selectPreviewMode("tests");
    await po.page.getByTestId("tests-record-button").click();

    // Recording runs in the preview, so the panel switches back to it.
    await expect(po.page.getByTestId("preview-recording-bar")).toBeVisible({
      timeout: Timeout.LONG,
    });
    await po.previewPanel.expectPreviewIframeIsVisible();

    await po.page.getByTestId("preview-recording-cancel-button").click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeHidden({
      timeout: Timeout.LONG,
    });
  },
);

testSkipIfWindows(
  "signs in the isolated Neon test user inside the iframe before recording",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("recorder");

    // Mark the imported fixture as an existing Neon Auth app without running
    // the product's integration installer (which would rewrite this deliberately
    // minimal fixture). The E2E build then provisions a deterministic branch
    // and account while the fixture serves Better Auth-shaped endpoints locally.
    const appName = await po.appManagement.getCurrentAppName();
    await po.page.evaluate(async (name) => {
      await (window as any).electron.ipcRenderer.invoke(
        "test:set-neon-auth-fixture",
        { appName: name },
      );
    }, appName);

    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();
    await po.previewPanel.selectPreviewMode("preview");
    await po.clickRestart();
    await po.previewPanel.expectPreviewIframeIsVisible();

    const frame = po.previewPanel.getPreviewIframeElement().contentFrame();
    await expect(frame.getByTestId("auth-state")).toHaveText("Signed out");

    await po.page.getByTestId("preview-record-button").click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });
    await expect(frame.getByTestId("auth-state")).toHaveText("Signed in", {
      timeout: Timeout.LONG,
    });
    await expect
      .poll(() =>
        frame.locator("html").evaluate(() => window.location.pathname),
      )
      .toBe("/");

    await po.page.getByTestId("preview-recording-cancel-button").click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeHidden({
      timeout: Timeout.LONG,
    });
  },
);
