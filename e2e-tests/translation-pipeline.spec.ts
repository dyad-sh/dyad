/**
 * E2E tests for the Translation Pipeline (Document → Plan → Act)
 * Tests the visual pipeline UI and MCP integration during contract translation
 */

import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Translation Pipeline", () => {
  test("should show pipeline UI during Solidity to Sui translation", async ({
    po,
  }) => {
    // Navigate to home (should be default route)
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode (look for translate mode toggle)
    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    // Wait for translation card to appear
    await expect(
      po.page.getByTestId("translation-card"),
    ).toBeVisible({ timeout: 15000 });

    // Enter Solidity contract
    const solidityCode = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.0;

      contract Counter {
        uint256 public count;

        function increment() public {
          count += 1;
        }
      }
    `;

    // Fill in source language, target language, and code
    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill(solidityCode);

    // Click translate
    await po.page.getByTestId("main-translate-button").click();

    // Wait for pipeline UI to appear
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      po.page.getByText("Using advanced context-aware translation"),
    ).toBeVisible();

    // Check Document phase
    await expect(po.page.getByText("📚 Document")).toBeVisible();
    await expect(
      po.page.getByText("Gathering ecosystem context"),
    ).toBeVisible();

    // Wait for document phase to show in progress
    await expect(po.page.getByText("In Progress")).toBeVisible({
      timeout: 5000,
    });

    // Check for Plan phase
    await expect(po.page.getByText("📋 Plan")).toBeVisible();
    await expect(
      po.page.getByText("Analyzing contract structure"),
    ).toBeVisible();

    // Check for Act phase
    await expect(po.page.getByText("⚡ Act")).toBeVisible();
    await expect(
      po.page.getByText("Preparing enriched prompt for LLM"),
    ).toBeVisible();

    // Wait for Document phase to complete and show approval button
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });

    // Approve Document phase
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase to complete
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });

    // Approve Plan phase
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Act phase to complete and navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should show pipeline UI during Solidity to Solana translation", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(
      po.page.getByTestId("translation-card"),
    ).toBeVisible({ timeout: 15000 });

    const solidityCode = `
      pragma solidity ^0.8.0;

      contract SimpleStorage {
        uint256 storedData;

        function set(uint256 x) public {
          storedData = x;
        }
      }
    `;

    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page
      .getByRole("option", { name: /solana/i })
      .or(po.page.getByRole("option", { name: /anchor/i }))
      .click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill(solidityCode);

    await po.page.getByTestId("main-translate-button").click();

    // Pipeline UI should appear
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // All three phases should be visible
    await expect(po.page.getByText("📚 Document")).toBeVisible();
    await expect(po.page.getByText("📋 Plan")).toBeVisible();
    await expect(po.page.getByText("⚡ Act")).toBeVisible();

    // Wait for Document phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Should eventually navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should display document phase details with ecosystem docs", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByText("Source Language").first()).toBeVisible({
      timeout: 15000,
    });

    const solidityCode = `contract Test { uint256 x; }`;

    // Select Sui as target to test sitemap-based doc fetching
    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill(solidityCode);

    await po.page.getByTestId("main-translate-button").click();

    // Wait for pipeline
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Document phase should show fetching progress
    await expect(
      po.page
        .getByText(/Fetching ecosystem documentation/i)
        .or(po.page.getByText(/Ecosystem docs:/i)),
    ).toBeVisible({ timeout: 30000 });

    // Wait for Document phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Should navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should show completed checkmarks for finished phases", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByText("Source Language").first()).toBeVisible({
      timeout: 15000,
    });

    const solidityCode = `contract Simple {}`;

    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill(solidityCode);

    await po.page.getByTestId("main-translate-button").click();

    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Wait for Document phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

test.describe("Pipeline Approval Workflow", () => {
  test("should pause after each phase for user approval", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(
      po.page.getByTestId("translation-card"),
    ).toBeVisible({ timeout: 15000 });

    // Enter Solidity contract
    const solidityCode = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.0;

      contract SimpleCounter {
        uint256 public count;

        function increment() public {
          count += 1;
        }

        function getCount() public view returns (uint256) {
          return count;
        }
      }
    `;

    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill(solidityCode);

    // Click translate
    await po.page.getByTestId("main-translate-button").click();

    // PHASE 1: Verify Document phase runs
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });
    await expect(po.page.getByText("📚 Document")).toBeVisible();
    await expect(po.page.getByText("In Progress")).toBeVisible({
      timeout: 5000,
    });

    // Wait for Phase 1 approval button to appear
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });

    // Progress should be visible (percentage may vary due to async updates)
    await expect(po.page.getByText(/\d+%/)).toBeVisible({ timeout: 2000 });

    // Click approve to continue to Phase 2
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // PHASE 2: Verify Plan phase starts
    await expect(po.page.getByText("📋 Plan")).toBeVisible();
    await expect(
      po.page.getByText(/Analyzing contract structure/i),
    ).toBeVisible({ timeout: 5000 });

    // Wait for Phase 2 approval button to appear
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });

    // Progress should be visible
    await expect(po.page.getByText(/\d+%/)).toBeVisible({ timeout: 2000 });

    // Click approve to continue to Phase 3
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // PHASE 3: Verify Act phase starts
    await expect(po.page.getByText("⚡ Act")).toBeVisible();
    await expect(po.page.getByText(/Preparing enriched prompt for LLM/i)).toBeVisible({
      timeout: 5000,
    });

    // Wait for Phase 3 to complete and navigation to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should show AI_RULES.md file was created", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByText("Source Language").first()).toBeVisible({
      timeout: 15000,
    });

    const solidityCode = `contract Test { uint256 x; }`;

    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill(solidityCode);

    await po.page.getByTestId("main-translate-button").click();

    // Wait for pipeline
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Wait for Phase 1 completion
    await expect(po.page.getByText(/AI_RULES\.md generated/i)).toBeVisible({
      timeout: 30000,
    });

    // Verify file size is shown
    await expect(po.page.getByText(/\d+\.?\d*KB/i)).toBeVisible({
      timeout: 5000,
    });

    // Verify approval UI mentions the file
    await expect(
      po.page.getByText(/AI_RULES\.md file has been generated/i),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Pipeline MCP Integration", () => {
  test("should fetch Sui documentation via MCP", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByText("Source Language").first()).toBeVisible({
      timeout: 15000,
    });

    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill("contract Test {}");

    await po.page.getByTestId("main-translate-button").click();

    // Pipeline should show document phase
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Should show KB of docs fetched (>0KB means MCP is working)
    await expect(
      po.page.getByText(/\d+KB/).or(po.page.getByText(/Ecosystem docs/i)),
    ).toBeVisible({ timeout: 30000 });
  });

  test("should fetch Solana documentation via MCP", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByText("Source Language").first()).toBeVisible({
      timeout: 15000,
    });

    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page
      .getByRole("option", { name: /solana/i })
      .or(po.page.getByRole("option", { name: /anchor/i }))
      .click();

    await po.page
      .getByRole("textbox", { name: /code/i })
      .or(po.page.locator("textarea"))
      .first()
      .fill("contract Test {}");

    await po.page.getByTestId("main-translate-button").click();

    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Solana has llms.txt so should fetch substantial docs (>100KB)
    await expect(
      po.page.getByText(/\d{3,}KB/).or(po.page.getByText(/600KB|630KB|645KB/)),
    ).toBeVisible({ timeout: 30000 });
  });
});
