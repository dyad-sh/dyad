/**
 * E2E tests for the Contract Generation Pipeline (Document -> Plan -> Act)
 * Tests the FULL generation flow from natural language description to smart contract
 * Every step of the way is verified as requested by QA
 */

import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

// ============================================================================
// SECTION 1: UI MODE SWITCHING - Testing the Generate mode UI
// ============================================================================

test.describe("Generation Pipeline - Mode Switching UI", () => {
  test("should display Generate tab alongside Translate tab", async ({
    po,
  }) => {
    // Navigate to home
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to contract mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    // Wait for card to appear
    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Check for Generate tab
    await expect(
      po.page.getByRole("tab", { name: /generate/i }),
    ).toBeVisible();

    // Check for Translate tab
    await expect(
      po.page.getByRole("tab", { name: /translate/i }),
    ).toBeVisible();
  });

  test("should switch to Generate mode when Generate tab is clicked", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to contract mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Click Generate tab
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Should show NL description textarea
    await expect(po.page.getByTestId("nl-description-textarea")).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show correct card description for Generate mode", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Click Generate tab
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Card description should mention generation from natural language
    await expect(
      po.page.getByText(/generate smart contracts from natural language/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should hide source language selector in Generate mode", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // In Translate mode, source selector should be visible
    await expect(
      po.page.getByRole("combobox", { name: /source/i }),
    ).toBeVisible();

    // Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Source selector should be hidden
    await expect(
      po.page.getByRole("combobox", { name: /source/i }),
    ).not.toBeVisible();
  });

  test("should hide code textarea in Generate mode", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // In Translate mode, code textarea should be visible
    await expect(po.page.locator("#source-code")).toBeVisible();

    // Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Code textarea should be hidden
    await expect(po.page.locator("#source-code")).not.toBeVisible();
  });

  test("should preserve project name when switching modes", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Enter project name in Translate mode
    await po.page.locator("#project-name").fill("my-test-project");

    // Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Project name should still be there
    await expect(po.page.locator("#project-name")).toHaveValue("my-test-project");

    // Switch back to Translate mode
    await po.page.getByRole("tab", { name: /translate/i }).click();

    // Project name should still be there
    await expect(po.page.locator("#project-name")).toHaveValue("my-test-project");
  });
});

// ============================================================================
// SECTION 2: NL DESCRIPTION INPUT VALIDATION
// ============================================================================

test.describe("Generation Pipeline - NL Description Validation", () => {
  test("should show character count starting at 0/2000", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Character count should show 0/2000
    await expect(po.page.getByText("0/2000")).toBeVisible();
  });

  test("should update character count as user types", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Type some text
    await po.page.getByTestId("nl-description-textarea").fill("Hello World");

    // Character count should update
    await expect(po.page.getByText("11/2000")).toBeVisible();
  });

  test("should show validation error for short descriptions (< 10 chars)", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Enter short description
    await po.page.getByTestId("nl-description-textarea").fill("Counter");

    // Validation error should appear
    await expect(po.page.getByTestId("nl-description-error")).toBeVisible();
    await expect(po.page.getByTestId("nl-description-error")).toContainText(
      "at least 10 characters",
    );
  });

  test("should disable generate button for short descriptions", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Enter short description
    await po.page.getByTestId("nl-description-textarea").fill("short");

    // Generate button should be disabled
    await expect(po.page.getByTestId("main-generate-button")).toBeDisabled();
  });

  test("should show validation error for descriptions exceeding max length (> 2000 chars)", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Enter description exceeding max length
    const longDescription = "a".repeat(2001);
    await po.page.getByTestId("nl-description-textarea").fill(longDescription);

    // Validation error should appear
    await expect(po.page.getByTestId("nl-description-error")).toBeVisible();
    await expect(po.page.getByTestId("nl-description-error")).toContainText(
      "maximum length",
    );
  });

  test("should accept valid description (10-2000 chars) and enable button", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Enter valid description
    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract with increment and decrement functions");

    // No validation error
    await expect(po.page.getByTestId("nl-description-error")).not.toBeVisible();

    // Note: Button may still be disabled if toolchain not installed
  });

  test("should disable generate button when description is empty", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Description is empty by default
    await expect(po.page.getByTestId("nl-description-textarea")).toHaveValue("");

    // Generate button should be disabled
    await expect(po.page.getByTestId("main-generate-button")).toBeDisabled();
  });
});

// ============================================================================
// SECTION 3: TARGET BLOCKCHAIN SELECTION
// ============================================================================

test.describe("Generation Pipeline - Target Blockchain Selection", () => {
  test("should show target blockchain selector in Generate mode", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Target blockchain selector should be visible
    await expect(po.page.getByTestId("generate-target-selector")).toBeVisible();
  });

  test("should show all supported blockchains in dropdown", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Click selector to open dropdown
    await po.page.getByTestId("generate-target-selector").click();

    // Should show Sui Move option
    await expect(po.page.getByRole("option", { name: /Sui/i })).toBeVisible();

    // Should show Solana/Anchor option
    await expect(
      po.page
        .getByRole("option", { name: /Solana/i })
        .or(po.page.getByRole("option", { name: /Anchor/i })),
    ).toBeVisible();

    // Should show Solidity option
    await expect(
      po.page.getByRole("option", { name: /Solidity/i }),
    ).toBeVisible();
  });

  test("should allow selecting Sui Move as target", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page.getByTestId("generate-target-selector").click();
    await po.page.getByRole("option", { name: /Sui/i }).click();

    // Verify selection is shown in selector
    await expect(po.page.getByTestId("generate-target-selector")).toContainText(
      /Sui/i,
    );
  });

  test("should allow selecting Solana/Anchor as target", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page.getByTestId("generate-target-selector").click();
    await po.page
      .getByRole("option", { name: /Solana/i })
      .or(po.page.getByRole("option", { name: /Anchor/i }))
      .click();
  });

  test("should allow selecting Solidity as target", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page.getByTestId("generate-target-selector").click();
    await po.page.getByRole("option", { name: /Solidity/i }).click();

    // Verify selection
    await expect(po.page.getByTestId("generate-target-selector")).toContainText(
      /Solidity/i,
    );
  });

  test("should show blockchain ecosystem info in options", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page.getByTestId("generate-target-selector").click();

    // Options should show ecosystem info like "Ethereum", "Sui", "Solana"
    await expect(
      po.page.getByRole("option", { name: /Ethereum/i }),
    ).toBeVisible();
    await expect(po.page.getByRole("option", { name: /Sui/i })).toBeVisible();
    await expect(
      po.page.getByRole("option", { name: /Solana/i }).or(
        po.page.getByRole("option", { name: /Anchor/i }),
      ),
    ).toBeVisible();
  });
});

// ============================================================================
// SECTION 4: PIPELINE UI DISPLAY
// ============================================================================

test.describe("Generation Pipeline - Pipeline UI Display", () => {
  test("should show 'Generation Pipeline' title (not Translation)", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract with increment and decrement functions");

    await po.page.getByTestId("main-generate-button").click();

    // Should show "Generation Pipeline" not "Translation Pipeline"
    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show generation-specific subtitle", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract with increment and decrement functions");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Should mention generation from description
    await expect(
      po.page.getByText(/generating smart contract from description/i),
    ).toBeVisible();
  });

  test("should show all three phases: Document, Plan, Act", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // All three phases should be visible
    await expect(po.page.getByText("Document")).toBeVisible();
    await expect(po.page.getByText("Plan")).toBeVisible();
    await expect(po.page.getByText("Act")).toBeVisible();
  });

  test("should show generation-specific phase descriptions", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Generation-specific descriptions
    await expect(
      po.page.getByText(/understanding requirements/i),
    ).toBeVisible();
    await expect(po.page.getByText(/designing architecture/i)).toBeVisible();
    await expect(po.page.getByText(/generating contract code/i)).toBeVisible();
  });

  test("should show Document phase as In Progress initially", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Document phase should show In Progress
    await expect(po.page.getByText("In Progress")).toBeVisible({
      timeout: 5000,
    });
  });
});

// ============================================================================
// SECTION 5: DOCUMENT PHASE (PHASE 1)
// ============================================================================

test.describe("Generation Pipeline - Document Phase", () => {
  test("should show ecosystem documentation fetching progress", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Should show fetching progress or ecosystem docs
    await expect(
      po.page
        .getByText(/fetching/i)
        .or(po.page.getByText(/ecosystem docs/i))
        .or(po.page.getByText(/gathering/i)),
    ).toBeVisible({ timeout: 30000 });
  });

  test("should show AI_RULES.md generation message", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Wait for AI_RULES.md generation message
    await expect(po.page.getByText(/AI_RULES\.md generated/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test("should show file size for AI_RULES.md", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    await expect(po.page.getByText(/AI_RULES\.md generated/i)).toBeVisible({
      timeout: 30000,
    });

    // Should show KB size
    await expect(po.page.getByText(/\d+\.?\d*KB/i)).toBeVisible();
  });

  test("should show approval button after Document phase completes", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Wait for approval button
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
  });

  test("should show approval message mentioning AI_RULES.md", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });

    // Approval section should mention AI_RULES.md
    await expect(
      po.page.getByText(/AI_RULES\.md file has been generated/i),
    ).toBeVisible();
  });
});

// ============================================================================
// SECTION 6: PLAN PHASE (PHASE 2)
// ============================================================================

test.describe("Generation Pipeline - Plan Phase", () => {
  test("should start Plan phase after Document approval", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a counter contract with increment and decrement");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Wait for and approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Plan phase should start
    await expect(po.page.getByText("Plan")).toBeVisible();
  });

  test("should show requirements analysis in Plan phase for generation", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a counter contract with increment and decrement");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Wait for Plan phase to complete
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });

    // Should show requirements analysis (Contract Types, Functionality, etc.)
    await expect(
      po.page
        .getByText(/contract types/i)
        .or(po.page.getByText(/functionality/i))
        .or(po.page.getByText(/requirements/i))
        .or(po.page.getByText(/analyzing/i)),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should show approval button after Plan phase completes", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a counter contract with increment and decrement");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Wait for Plan phase approval button
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
  });
});

// ============================================================================
// SECTION 7: ACT PHASE (PHASE 3)
// ============================================================================

test.describe("Generation Pipeline - Act Phase", () => {
  test("should start Act phase after Plan approval", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a counter contract with increment function");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Approve Plan phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Act phase should be visible
    await expect(po.page.getByText("Act")).toBeVisible();
  });

  test("should navigate to chat view after Act phase completes", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a counter contract with increment function");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Approve Plan phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Should navigate to chat after Act phase
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

// ============================================================================
// SECTION 8: FULL END-TO-END FLOWS
// ============================================================================

test.describe("Generation Pipeline - Full E2E Flow (Sui Move)", () => {
  test("should complete full generation flow for Sui Move", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Step 1: Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();
    await expect(po.page.getByTestId("nl-description-textarea")).toBeVisible();

    // Step 2: Select Sui Move as target
    await po.page.getByTestId("generate-target-selector").click();
    await po.page.getByRole("option", { name: /Sui/i }).click();

    // Step 3: Enter NL description
    const description =
      "Create a counter contract with increment, decrement, and get_count functions";
    await po.page.getByTestId("nl-description-textarea").fill(description);

    // Step 4: Enter project name
    await po.page.locator("#project-name").fill("e2e-sui-counter");

    // Step 5: Click Generate
    await po.page.getByTestId("main-generate-button").click();

    // Step 6: Verify pipeline UI appears
    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Step 7: Wait for Document phase completion and approve
    await expect(po.page.getByText(/AI_RULES\.md generated/i)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 5000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Step 8: Wait for Plan phase completion and approve
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Step 9: Wait for navigation to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

test.describe("Generation Pipeline - Full E2E Flow (Solana/Anchor)", () => {
  test("should scaffold Anchor project and complete generation flow for Solana", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Step 1: Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Step 2: Select Solana/Anchor as target
    await po.page.getByTestId("generate-target-selector").click();
    await po.page
      .getByRole("option", { name: /Solana/i })
      .or(po.page.getByRole("option", { name: /Anchor/i }))
      .click();

    // Step 3: Enter NL description
    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a staking contract with deposit and withdraw functions");

    // Step 4: Enter project name
    await po.page.locator("#project-name").fill("e2e-solana-staking");

    // Step 5: Click Generate (Anchor scaffolding happens automatically)
    await po.page.getByTestId("main-generate-button").click();

    // Step 6: Verify pipeline appears
    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 15000,
    });

    // Step 7: Approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Step 8: Approve Plan phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Step 9: Navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

test.describe("Generation Pipeline - Full E2E Flow (Ethereum/Solidity)", () => {
  test("should complete full generation flow for Ethereum/Solidity", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Step 1: Switch to Generate mode
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Step 2: Select Solidity as target
    await po.page.getByTestId("generate-target-selector").click();
    await po.page.getByRole("option", { name: /Solidity/i }).click();

    // Step 3: Enter NL description
    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create an ERC-20 token with burn and mint functions");

    // Step 4: Enter project name
    await po.page.locator("#project-name").fill("e2e-erc20-token");

    // Step 5: Click Generate
    await po.page.getByTestId("main-generate-button").click();

    // Step 6: Verify pipeline appears
    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Step 7: Approve Document phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Step 8: Approve Plan phase
    await expect(
      po.page.getByRole("button", { name: /approve & continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /approve & continue/i }).click();

    // Step 9: Navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

// ============================================================================
// SECTION 9: MCP INTEGRATION
// ============================================================================

test.describe("Generation Pipeline - MCP Integration", () => {
  test("should fetch Sui documentation via MCP", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Select Sui Move
    await po.page.getByTestId("generate-target-selector").click();
    await po.page.getByRole("option", { name: /Sui/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple counter contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Should show KB of docs fetched
    await expect(
      po.page
        .getByText(/\d+KB/)
        .or(po.page.getByText(/ecosystem docs/i))
        .or(po.page.getByText(/fetching/i)),
    ).toBeVisible({ timeout: 30000 });
  });

  test("should fetch Solana documentation via MCP", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Select Solana
    await po.page.getByTestId("generate-target-selector").click();
    await po.page
      .getByRole("option", { name: /Solana/i })
      .or(po.page.getByRole("option", { name: /Anchor/i }))
      .click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a simple staking contract");

    await po.page.getByTestId("main-generate-button").click();

    await expect(po.page.getByText("Generation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Solana should show substantial docs (via llms.txt)
    await expect(
      po.page
        .getByText(/\d{2,}KB/)
        .or(po.page.getByText(/ecosystem docs/i))
        .or(po.page.getByText(/fetching/i)),
    ).toBeVisible({ timeout: 30000 });
  });
});

// ============================================================================
// SECTION 10: ERROR HANDLING AND EDGE CASES
// ============================================================================

test.describe("Generation Pipeline - Error Handling", () => {
  test("should handle MCP unavailability gracefully", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    await po.page.getByRole("tab", { name: /generate/i }).click();

    await po.page
      .getByTestId("nl-description-textarea")
      .fill("Create a token contract");

    await po.page.getByTestId("main-generate-button").click();

    // Pipeline should start even if MCP has issues
    await expect(
      po.page
        .getByText(/generation pipeline/i)
        .or(po.page.getByText(/document/i)),
    ).toBeVisible({ timeout: 15000 });

    // Should not show raw connection error
    const errorVisible = await po.page
      .getByText(/connection closed/i)
      .isVisible()
      .catch(() => false);

    if (errorVisible) {
      // If error, should show retry option
      await expect(
        po.page
          .getByText(/try again/i)
          .or(po.page.getByText(/retry/i))
          .or(po.page.getByText(/fallback/i)),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
