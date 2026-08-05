import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the recorder's "Generate test proposal" flow. The fake
// LLM server answers the agent turn with a generate_test_assertions tool call
// and answers the approve-time code prompt (see
// testing/fake-llm-server/testAssertionsFixtures.ts), so this drives the real
// agent tool, the real deterministic codegen, and the real chat card. The tool
// parks on the card, so approving resumes that same turn rather than starting a
// new one. The "run it" hand-off is answered as plain text — it does NOT spawn a
// Playwright run of the generated spec.
testSkipIfWindows(
  "proposes a name, steps and assertions, then generates the test file on approval",
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

    // Deliberately unnamed: naming a flow before performing it is guesswork, so
    // the AI names the test from what was actually recorded.
    await po.page.getByTestId("preview-recording-stop-button").click();

    // Stopping lists the steps and offers the proposal — no file yet.
    const steps = po.page.getByTestId("preview-recorded-steps");
    await expect(steps).toBeVisible({ timeout: Timeout.LONG });
    await expect(steps).toContainText(`await page.goto("/")`);
    await expect(steps).toContainText("Increment");

    const generateButton = po.page.getByTestId(
      "preview-recording-generate-assertions-button",
    );
    await expect(generateButton).toHaveText("Generate test proposal");
    await generateButton.click();
    await po.page.getByTestId("agent-mode-continue").click();

    // The agent names the test, describes the steps and proposes checks; all of
    // it lands in the card.
    const card = po.page.getByTestId("dyad-test-assertions-card");
    await expect(card).toBeVisible({ timeout: Timeout.LONG });
    // Named by the AI, not a path — nothing has been written yet.
    await expect(card).toContainText(`Type "Ada" into the field`);
    await expect(
      card.locator('[data-testid^="dyad-test-assertions-step-"]').first(),
    ).toBeVisible();

    const assertions = card.locator(
      '[data-testid^="dyad-test-assertions-assertion-"]',
    );
    await expect(assertions.first()).toBeVisible();

    // The turn is parked on the card rather than finished: the way out that
    // only exists while something is waiting is offered.
    await expect(
      po.page.getByTestId("dyad-test-assertions-discard-button"),
    ).toBeVisible();

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
    // the recorded steps and an assertion. Its filename comes from the name the
    // AI proposed, slugified — no "recorded test" placeholder anywhere.
    const specFileName = "recorded-type-ada-into-the-field.spec.ts";
    await po.page.getByTestId("dyad-test-assertions-open-file-button").click();
    // The spec shows up twice in the Code tab (file tree + editor breadcrumb),
    // so pin to the first rather than tripping strict mode.
    await expect(
      po.page.locator("#preview-panel").getByText(specFileName).first(),
    ).toBeVisible({ timeout: Timeout.LONG });
    await expect(po.page.locator("#preview-panel")).toContainText(
      "await expect(",
      { timeout: Timeout.LONG },
    );

    // Approving also hands the fresh spec back to the agent to run — as the
    // parked tool's result, so the same turn continues...
    await expect(po.page.getByTestId("messages-list")).toContainText(
      `Running e2e-tests/${specFileName}`,
      { timeout: Timeout.LONG },
    );
    // ...and nothing about the hand-off shows up as a message of the user's.
    await expect(po.page.getByTestId("messages-list")).not.toContainText(
      "I approved the assertions",
    );

    // The spec is written under e2e-tests/ and auto-discovered into the panel.
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page.locator("#preview-panel").getByText(specFileName),
    ).toBeVisible({ timeout: Timeout.LONG });

    // The card is a persisted message, so it survives leaving and returning to
    // the chat — still in its approved state.
    await po.previewPanel.selectPreviewMode("preview");
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page.getByTestId("dyad-test-assertions-approved-badge"),
    ).toBeVisible();
  },
);

// The recording bar has to survive a proposal that produces no test. The turn
// ending is the only signal that the wait is over — approval is what closes the
// bar, and a closed card never gets there — so the bar used to spin on "Asking
// the AI for assertions…" for the rest of the session, with the draft sitting
// behind a spinner that would never resolve.
testSkipIfWindows(
  "returns the recording bar to the review when the proposal turn ends without a test",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("recorder");

    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();

    await po.previewPanel.selectPreviewMode("preview");
    await po.clickRestart();
    await po.previewPanel.expectPreviewIframeIsVisible();

    await po.page.getByTestId("preview-record-button").click();
    await expect(po.page.getByTestId("preview-recording-bar")).toBeVisible({
      timeout: Timeout.LONG,
    });

    const frame = po.previewPanel.getPreviewIframeElement().contentFrame();
    await frame.getByRole("button", { name: "Increment" }).click();
    await expect(
      po.page.getByTestId("preview-recording-step-count"),
    ).not.toHaveText("0 steps");

    await po.page
      .getByTestId("preview-recording-name-input")
      .fill("abandoned flow");
    await po.page.getByTestId("preview-recording-stop-button").click();

    const status = po.page.getByTestId("preview-recording-review-status");
    await expect(status).toContainText("not saved yet", {
      timeout: Timeout.LONG,
    });

    await po.page
      .getByTestId("preview-recording-generate-assertions-button")
      .click();
    await po.page.getByTestId("agent-mode-continue").click();
    await expect(status).toContainText("Asking the AI for assertions");

    // Close the card without generating anything. The tool is parked on it, so
    // this resumes the turn, which says its piece and ends — no test file, and
    // nothing left to wait for.
    await expect(po.page.getByTestId("dyad-test-assertions-card")).toBeVisible({
      timeout: Timeout.LONG,
    });
    await po.page.getByTestId("dyad-test-assertions-discard-button").click();
    await expect(
      po.page.getByTestId("dyad-test-assertions-discarded-note"),
    ).toBeVisible({ timeout: Timeout.LONG });

    // The bar drops back to the review, where the recording can still be asked
    // about again or thrown away.
    await expect(status).toContainText("not saved yet", {
      timeout: Timeout.LONG,
    });
    await expect(
      po.page.getByTestId("preview-recording-generate-assertions-button"),
    ).toBeVisible();
    await expect(
      po.page.getByTestId("preview-recording-discard-button"),
    ).toBeVisible();
  },
);
