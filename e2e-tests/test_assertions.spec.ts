import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

// End-to-end coverage for the reviewable "Add assertions with AI" flow. The
// fake LLM server answers the agent turn with a read_file then a
// generate_test_assertions tool call, and answers the approve-time code prompt
// (see testing/fake-llm-server/testAssertionsFixtures.ts), so this drives the
// real agent tool, the real spec splice, and the real chat card — it does NOT
// spawn a Playwright run of the generated spec.
testSkipIfWindows(
  "proposes assertions in a chat card and writes the approved ones into the spec",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("recorder");

    await po.previewPanel.selectPreviewMode("tests");
    await po.previewPanel.clickEnableTesting();

    await po.previewPanel.selectPreviewMode("preview");
    await po.clickRestart();
    await po.previewPanel.expectPreviewIframeIsVisible();

    // Record a short flow so there is a generated spec to annotate.
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
    await po.page.getByTestId("preview-recording-save-button").click();

    // The saved banner offers the assertion pass, which runs in Agent mode.
    const enhanceButton = po.page.getByTestId(
      "preview-recording-enhance-button",
    );
    await expect(enhanceButton).toBeVisible({ timeout: Timeout.LONG });
    await enhanceButton.click();
    await po.page.getByTestId("agent-mode-continue").click();

    // The agent reads the spec and calls generate_test_assertions, whose card
    // lands in the chat, steps first.
    const card = po.page.getByTestId("dyad-test-assertions-card");
    await expect(card).toBeVisible({ timeout: Timeout.LONG });
    await expect(card).toContainText("recorded-assert-item.spec.ts");
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

    // Approve and confirm the latch.
    await po.page.getByTestId("dyad-test-assertions-approve-button").click();
    await expect(
      po.page.getByTestId("dyad-test-assertions-approved-badge"),
    ).toBeVisible({ timeout: Timeout.LONG });

    // The card's own link opens the rewritten spec in the Code tab, which now
    // has an assertion alongside the recorded steps.
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

    // The card is a persisted message, so it survives leaving and returning to
    // the chat — still in its approved state.
    await po.previewPanel.selectPreviewMode("preview");
    await po.previewPanel.selectPreviewMode("tests");
    await expect(
      po.page.getByTestId("dyad-test-assertions-approved-badge"),
    ).toBeVisible();
  },
);
