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
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    // Wait for translation card to appear
    await expect(
      po.page
        .locator('[data-testid="translation-card"]')
        .or(po.page.getByText("Source Language")),
    ).toBeVisible({ timeout: 5000 });

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
    await po.page.getByRole("button", { name: /translate/i }).click();

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

    // Wait for document phase to complete
    await expect(
      po.page
        .getByText("Document Phase Complete")
        .or(po.page.getByText("Ecosystem docs:")),
    ).toBeVisible({ timeout: 30000 });

    // Check progress bar exists
    await expect(po.page.getByText("Overall Progress")).toBeVisible();

    // Eventually should navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should show pipeline UI during Solidity to Solana translation", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(
      po.page
        .locator('[data-testid="translation-card"]')
        .or(po.page.getByText("Source Language")),
    ).toBeVisible({ timeout: 5000 });

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

    await po.page.getByRole("button", { name: /translate/i }).click();

    // Pipeline UI should appear
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // All three phases should be visible
    await expect(po.page.getByText("📚 Document")).toBeVisible();
    await expect(po.page.getByText("📋 Plan")).toBeVisible();
    await expect(po.page.getByText("⚡ Act")).toBeVisible();

    // Should show progress
    await expect(po.page.getByText(/\d+%/)).toBeVisible({ timeout: 5000 });

    // Should eventually navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should display document phase details with ecosystem docs", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(po.page.getByText("Source Language")).toBeVisible({
      timeout: 5000,
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

    await po.page.getByRole("button", { name: /translate/i }).click();

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

    // Should show version info
    await expect(
      po.page
        .getByText(/Current version:/i)
        .or(po.page.getByText(/version \d+\.\d+/i)),
    ).toBeVisible({ timeout: 30000 });

    // Should show translation patterns
    await expect(
      po.page
        .getByText(/Translation patterns:/i)
        .or(po.page.getByText(/mapping/i)),
    ).toBeVisible({ timeout: 30000 });
  });

  test("should show completed checkmarks for finished phases", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(po.page.getByText("Source Language")).toBeVisible({
      timeout: 5000,
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

    await po.page.getByRole("button", { name: /translate/i }).click();

    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Wait for at least one phase to complete
    await expect(po.page.getByText("Completed").first()).toBeVisible({
      timeout: 30000,
    });

    // Progress bar should show > 0%
    const progressText = await po.page.getByText(/\d+%/).textContent();
    const progress = parseInt(progressText?.match(/\d+/)?.[0] || "0");
    expect(progress).toBeGreaterThan(0);
  });
});

test.describe("Pipeline Approval Workflow", () => {
  test("should pause after each phase for user approval", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(
      po.page
        .locator('[data-testid="translation-card"]')
        .or(po.page.getByText("Source Language")),
    ).toBeVisible({ timeout: 5000 });

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
    await po.page.getByRole("button", { name: /translate/i }).click();

    // PHASE 1: Verify Document phase runs
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });
    await expect(po.page.getByText("📚 Document")).toBeVisible();
    await expect(po.page.getByText("In Progress")).toBeVisible({
      timeout: 5000,
    });

    // Wait for Phase 1 to complete
    await expect(po.page.getByText(/AI_RULES\.md generated/i)).toBeVisible({
      timeout: 30000,
    });
    await expect(po.page.getByText("Completed").first()).toBeVisible({
      timeout: 5000,
    });

    // APPROVAL UI: Verify approval section appears
    await expect(
      po.page.getByText(/Phase 1 Complete - Review AI_RULES\.md/i),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("button", { name: /View AI_RULES\.md/i }),
    ).toBeVisible();

    // Progress should be at 33% (1/3 phases complete)
    await expect(po.page.getByText("33%")).toBeVisible({ timeout: 2000 });

    // Click approve to continue to Phase 2
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // PHASE 2: Verify Plan phase starts
    await expect(po.page.getByText("📋 Plan")).toBeVisible();
    await expect(
      po.page.getByText(/Analyzing contract structure/i),
    ).toBeVisible({ timeout: 5000 });

    // Wait for Phase 2 to complete
    await expect(po.page.getByText(/Contract analysis complete/i)).toBeVisible({
      timeout: 10000,
    });

    // APPROVAL UI: Verify Phase 2 approval appears
    await expect(
      po.page.getByText(/Phase 2 Complete - Review Translation Plan/i),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible();

    // Progress should be at 66% (2/3 phases complete)
    await expect(po.page.getByText("66%")).toBeVisible({ timeout: 2000 });

    // Click approve to continue to Phase 3
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // PHASE 3: Verify Act phase starts
    await expect(po.page.getByText("⚡ Act")).toBeVisible();
    await expect(po.page.getByText(/Building enriched prompt/i)).toBeVisible({
      timeout: 5000,
    });

    // Wait for Phase 3 to complete and navigation to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });

    // Verify we're in chat and LLM is generating
    await expect(
      po.page.getByText(/translat/i).or(po.page.getByText(/contract/i)),
    ).toBeVisible({ timeout: 10000 });
  });

  test("should show AI_RULES.md file was created", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode by clicking the "Contract" button in title bar
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(po.page.getByText("Source Language")).toBeVisible({
      timeout: 5000,
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

    await po.page.getByRole("button", { name: /translate/i }).click();

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
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(po.page.getByText("Source Language")).toBeVisible({
      timeout: 5000,
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

    await po.page.getByRole("button", { name: /translate/i }).click();

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
    const contractButton = po.page.getByRole("button", { name: /contract/i });
    await contractButton.click();

    await expect(po.page.getByText("Source Language")).toBeVisible({
      timeout: 5000,
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

    await po.page.getByRole("button", { name: /translate/i }).click();

    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Solana has llms.txt so should fetch substantial docs (>100KB)
    await expect(
      po.page.getByText(/\d{3,}KB/).or(po.page.getByText(/600KB|630KB|645KB/)),
    ).toBeVisible({ timeout: 30000 });
  });
});
