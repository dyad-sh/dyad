/**
 * E2E tests for the Contract Generation Pipeline (Document → Plan → Act)
 * Tests the generation flow from natural language description to smart contract
 */

import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Generation Pipeline - Mode Switching", () => {
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
    await expect(
      po.page
        .getByPlaceholder(/describe your smart contract/i)
        .or(po.page.getByRole("textbox", { name: /description/i })),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Generation Pipeline - Input Validation", () => {
  test("should show validation error for short descriptions", async ({
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

    // Enter a short description (less than 10 characters)
    const textarea = po.page
      .getByPlaceholder(/describe your smart contract/i)
      .or(po.page.locator('textarea[name*="description"], textarea'));
    await textarea.first().fill("Counter");

    // Check that generate button is disabled or validation error is shown
    const generateButton = po.page.getByRole("button", {
      name: /generate/i,
    });

    // Either button is disabled or there's a validation message
    const isDisabled = await generateButton.isDisabled();
    if (!isDisabled) {
      await expect(
        po.page.getByText(/at least 10 characters/i),
      ).toBeVisible({ timeout: 2000 });
    }
  });

  test("should enable generate button for valid descriptions", async ({
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

    // Enter a valid description (more than 10 characters)
    const textarea = po.page
      .getByPlaceholder(/describe your smart contract/i)
      .or(po.page.locator('textarea[name*="description"], textarea'));
    await textarea.first().fill("Create a simple counter contract with increment and decrement functions");

    // Fill in project name
    const nameInput = po.page
      .getByPlaceholder(/project name/i)
      .or(po.page.getByRole("textbox", { name: /name/i }));
    await nameInput.first().fill("test-counter");

    // Generate button should be enabled
    const generateButton = po.page.getByRole("button", {
      name: /generate/i,
    });
    await expect(generateButton).toBeEnabled({ timeout: 2000 });
  });
});

test.describe("Generation Pipeline - Target Blockchain Selection", () => {
  test("should show blockchain selector in generation mode", async ({
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

    // Should show a target blockchain dropdown/selector
    await expect(
      po.page
        .getByRole("combobox", { name: /target/i })
        .or(po.page.getByText(/target blockchain/i)),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should allow selecting Sui Move as target", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to contract mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Click Generate tab
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Click on target blockchain dropdown
    const targetDropdown = po.page
      .getByRole("combobox", { name: /target/i })
      .first();
    await targetDropdown.click();

    // Select Sui Move
    await po.page.getByRole("option", { name: /sui/i }).click();
  });

  test("should allow selecting Solana/Anchor as target", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to contract mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Click Generate tab
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Click on target blockchain dropdown
    const targetDropdown = po.page
      .getByRole("combobox", { name: /target/i })
      .first();
    await targetDropdown.click();

    // Select Solana/Anchor
    await po.page
      .getByRole("option", { name: /solana|anchor/i })
      .click();
  });
});

test.describe("Generation Pipeline - Pipeline Display", () => {
  test("should show Generation Pipeline UI when generate is clicked", async ({
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

    // Fill in required fields
    const textarea = po.page
      .getByPlaceholder(/describe your smart contract/i)
      .or(po.page.locator('textarea[name*="description"], textarea'));
    await textarea.first().fill("Create a simple counter contract with increment and decrement functions");

    const nameInput = po.page
      .getByPlaceholder(/project name/i)
      .or(po.page.getByRole("textbox", { name: /name/i }));
    await nameInput.first().fill("test-gen-counter");

    // Click Generate button
    const generateButton = po.page.getByTestId("main-generate-button");
    await generateButton.click();

    // Wait for pipeline UI to appear - should say "Generation Pipeline" not "Translation Pipeline"
    await expect(
      po.page
        .getByText("Generation Pipeline")
        .or(po.page.getByText(/generating/i)),
    ).toBeVisible({ timeout: 10000 });
  });

  test("should show Document phase during generation", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to contract mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Click Generate tab
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Fill in required fields
    const textarea = po.page
      .getByPlaceholder(/describe your smart contract/i)
      .or(po.page.locator('textarea[name*="description"], textarea'));
    await textarea.first().fill("Create a simple NFT minting contract with admin controls");

    const nameInput = po.page
      .getByPlaceholder(/project name/i)
      .or(po.page.getByRole("textbox", { name: /name/i }));
    await nameInput.first().fill("test-gen-nft");

    // Click Generate button
    const generateButton = po.page.getByTestId("main-generate-button");
    await generateButton.click();

    // Check for Document phase - should show "Understanding requirements" in generation mode
    await expect(
      po.page
        .getByText("📚 Document")
        .or(po.page.getByText(/understanding requirements/i))
        .or(po.page.getByText(/gathering/i)),
    ).toBeVisible({ timeout: 10000 });
  });

  test("should handle MCP unavailability gracefully", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to contract mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Click Generate tab
    await po.page.getByRole("tab", { name: /generate/i }).click();

    // Fill in required fields
    const textarea = po.page
      .getByPlaceholder(/describe your smart contract/i)
      .or(po.page.locator('textarea[name*="description"], textarea'));
    await textarea.first().fill("Create a token contract with minting and burning");

    const nameInput = po.page
      .getByPlaceholder(/project name/i)
      .or(po.page.getByRole("textbox", { name: /name/i }));
    await nameInput.first().fill("test-token-fallback");

    // Click Generate button
    const generateButton = po.page.getByTestId("main-generate-button");
    await generateButton.click();

    // If MCP is unavailable, should show fallback message or continue gracefully
    // (should not crash with "Connection closed" error)
    await expect(
      po.page
        .getByText(/generation pipeline/i)
        .or(po.page.getByText(/using built-in knowledge/i))
        .or(po.page.getByText(/mcp unavailable/i))
        .or(po.page.getByText(/understanding requirements/i))
        .or(po.page.getByText(/📚 document/i)),
    ).toBeVisible({ timeout: 15000 });

    // Should NOT show the connection closed error
    const errorVisible = await po.page
      .getByText(/connection closed/i)
      .isVisible()
      .catch(() => false);

    // If there's an error, it should be a user-friendly message, not a raw MCP error
    if (errorVisible) {
      // If we see a connection error, check it's handled gracefully
      await expect(
        po.page
          .getByText(/try again/i)
          .or(po.page.getByText(/retry/i))
          .or(po.page.getByText(/fallback/i)),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Generation Pipeline - Full Flow", () => {
  test("should complete full generation flow with approval workflow", async ({
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

    // Fill in valid description
    const textarea = po.page
      .getByPlaceholder(/describe your smart contract/i)
      .or(po.page.locator('textarea[name*="description"], textarea'));
    await textarea.first().fill("Create a simple counter contract with increment, decrement, and get_count functions");

    const nameInput = po.page
      .getByPlaceholder(/project name/i)
      .or(po.page.getByRole("textbox", { name: /name/i }));
    await nameInput.first().fill("e2e-counter-test");

    // Select Sui Move as target
    const targetDropdown = po.page
      .getByRole("combobox", { name: /target/i })
      .first();
    await targetDropdown.click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    // Click Generate
    const generateButton = po.page.getByTestId("main-generate-button");
    await generateButton.click();

    // Wait for pipeline UI
    await expect(
      po.page
        .getByText("Generation Pipeline")
        .or(po.page.getByText(/generating/i)),
    ).toBeVisible({ timeout: 15000 });

    // Wait for Phase 1 (Document) approval button
    await expect(
      po.page.getByRole("button", { name: /approve/i }),
    ).toBeVisible({ timeout: 60000 });

    // Approve Phase 1
    await po.page.getByRole("button", { name: /approve/i }).click();

    // Wait for Phase 2 (Plan) approval button
    await expect(
      po.page.getByRole("button", { name: /approve/i }),
    ).toBeVisible({ timeout: 60000 });

    // Approve Phase 2
    await po.page.getByRole("button", { name: /approve/i }).click();

    // Should navigate to chat view after Phase 3 (Act) completes
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 120000 });
  });
});
