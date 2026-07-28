import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the recorder's "Generate assertions" flow. The fake
// LLM server answers the agent turn with a generate_test_assertions tool call
// and answers the approve-time code prompt (see
// testing/fake-llm-server/testAssertionsFixtures.ts), so this drives the real
// agent tool, the real deterministic codegen, and the real chat card. The
// post-approval "run it" hand-off is answered as plain text — it does NOT spawn
// a Playwright run of the generated spec.
testSkipIfWindows(
  "reviews a recording as steps, then generates the test file on approval",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("recorder");

    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();

    await po.previewPanel.selectPreviewMode("preview");
    await po.clickRestart();
    await po.previewPanel.expectPreviewIframeIsVisible();

    // Record a short flow.
    await po.page.getByTestId("preview-record-button").click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeVisible({
      timeout: Timeout.LONG,
    });

    const frame = po.previewPanel.getPreviewIframeElement().contentFrame();
    await frame.getByRole("button", { name: "Increment" }).click();
    await frame.getByLabel("Name").fill("Ada");

    await expect(
      po.page.getByTestId("preview-recording-step-count"),
    ).not.toHaveText("0 steps");

    await po.page
      .getByTestId("preview-recording-name-input")
      .fill("assert item");
    await po.page.getByTestId("preview-recording-stop-button").click();

    // Stopping lists the steps and offers the assertion pass — no file yet.
    const steps = po.page.getByTestId("preview-recorded-steps");
    await expect(steps).toBeVisible({ timeout: Timeout.LONG });
    await expect(steps).toContainText(`await page.goto("/")`);
    await expect(steps).toContainText("Increment");

    const generateButton = po.page.getByTestId(
      "preview-recording-generate-assertions-button",
    );
    await expect(generateButton).toBeVisible();
    await generateButton.click();
    await po.page.getByTestId("agent-mode-continue").click();

    // The agent describes the steps and proposes checks; both land in the card.
    const card = po.page.getByTestId("dyad-test-assertions-card");
    await expect(card).toBeVisible({ timeout: Timeout.LONG });
    // Named by the test, not a path — nothing has been written yet.
    await expect(card).toContainText("assert item");
    await expect(
      card.locator('[data-testid^="dyad-test-assertions-step-"]').first(),
    ).toBeVisible();

    const assertions = card.locator(
      '[data-testid^="dyad-test-assertions-assertion-"]',
    );
    await expect(assertions.first()).toBeVisible();

    // Editing an assertion marks it for code regeneration on approve.
    await card
      .locator('[data-testid^="dyad-test-assertions-text-"]')
      .first()
      .click();
    const editor = card.locator('[data-testid^="dyad-test-assertions-edit-"]');
    await editor.fill("The name field keeps the typed value");
    await editor.press("Enter");
    await expect(assertions.first()).toContainText("Code written on approve");

    // Approve: this is what creates the spec.
    await po.page.getByTestId("dyad-test-assertions-approve-button").click();
    await expect(
      po.page.getByTestId("dyad-test-assertions-approved-badge"),
    ).toBeVisible({ timeout: Timeout.LONG });

    // The card's own link opens the generated spec in the Code tab, which has
    // the recorded steps and an assertion.
    await po.page.getByTestId("dyad-test-assertions-open-file-button").click();
    // The spec shows up twice in the Code tab (file tree + editor breadcrumb),
    // so pin to the first rather than tripping strict mode.
    await expect(
      po.page
        .locator("#preview-panel")
        .getByText("recorded-assert-item.spec.ts")
        .first(),
    ).toBeVisible({ timeout: Timeout.LONG });
    await expect(po.page.locator("#preview-panel")).toContainText(
      "await expect(",
      { timeout: Timeout.LONG },
    );

    // Approving also hands the fresh spec back to the agent to run.
    await expect(po.page.getByTestId("messages-list")).toContainText(
      "Running e2e-tests/recorded-assert-item.spec.ts",
      { timeout: Timeout.LONG },
    );

    // The card is a persisted message, so it survives leaving and returning to
    // the chat — still in its approved state.
    await po.previewPanel.selectPreviewMode("preview");
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page.getByTestId("dyad-test-assertions-approved-badge"),
    ).toBeVisible();
  },
);
