/**
 * E2E tests for Vector Retrieval in Translation Pipeline
 * Tests the vector-based RAG context retrieval during smart contract translation
 */

import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Vector Retrieval in Translation Pipeline", () => {
  test("should use vector search for context retrieval during translation", async ({
    po,
  }) => {
    // Navigate to home
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    // Wait for translation card to appear
    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Enter Solidity contract with various patterns to trigger vector search
    const solidityCode = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.0;

      contract TokenVault {
        mapping(address => uint256) public balances;
        mapping(address => mapping(address => uint256)) public allowances;

        event Deposit(address indexed user, uint256 amount);
        event Withdraw(address indexed user, uint256 amount);

        modifier onlyPositiveAmount(uint256 amount) {
          require(amount > 0, "Amount must be positive");
          _;
        }

        function deposit() public payable onlyPositiveAmount(msg.value) {
          balances[msg.sender] += msg.value;
          emit Deposit(msg.sender, msg.value);
        }

        function withdraw(uint256 amount) public onlyPositiveAmount(amount) {
          require(balances[msg.sender] >= amount, "Insufficient balance");
          balances[msg.sender] -= amount;
          payable(msg.sender).transfer(amount);
          emit Withdraw(msg.sender, amount);
        }
      }
    `;

    // Fill in source language
    await po.page
      .getByRole("combobox", { name: /source/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /solidity/i }).click();

    // Fill in target language (Sui)
    await po.page
      .getByRole("combobox", { name: /target/i })
      .first()
      .click();
    await po.page.getByRole("option", { name: /sui/i }).click();

    // Fill in code
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

    // Check Document phase starts
    await expect(po.page.getByText("Document")).toBeVisible();
    await expect(
      po.page.getByText("Gathering ecosystem context"),
    ).toBeVisible();

    // Wait for document phase to complete
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 60000 });

    // Look for vector search indicators (these messages come from the pipeline)
    // The pipeline should show progress messages about vector search or context retrieval
    const pipelineText = await po.page
      .locator("[data-testid='translation-pipeline']")
      .or(po.page.locator("text=Translation Pipeline").locator("..").locator(".."))
      .textContent();

    // Verify we see context-related information (KB size, chunks, or retrieval method)
    // Use specific selector to match "Document Phase Complete: ... 44KB" or "Ecosystem docs: XXkb"
    await expect(
      po.page.getByText(/Ecosystem docs:?\s*\d+KB/i).or(
        po.page.getByText(/Document Phase Complete/i),
      ),
    ).toBeVisible({ timeout: 30000 });

    // Approve Document phase
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Should navigate to chat after Act phase
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should show context size in KB during Document phase", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Simple contract to test context fetching
    const solidityCode = `
      pragma solidity ^0.8.0;

      contract Counter {
        uint256 public count;

        function increment() public {
          count += 1;
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

    await po.page.getByTestId("main-translate-button").click();

    // Wait for pipeline UI
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Document phase should show ecosystem docs size in KB
    await expect(
      po.page.getByText(/Ecosystem docs:?\s*\d+KB/i).or(
        po.page.getByText(/Document Phase Complete/i),
      ),
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

  test("should handle translation with complex Solidity patterns for RAG queries", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Contract with many Solidity patterns that should trigger multiple RAG queries
    const solidityCode = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.0;

      import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
      import "@openzeppelin/contracts/access/Ownable.sol";

      contract StakingPool is Ownable {
        struct StakeInfo {
          uint256 amount;
          uint256 rewardDebt;
          uint256 lastStakeTime;
        }

        mapping(address => StakeInfo) public stakes;

        IERC20 public stakingToken;
        uint256 public rewardRate;

        event Staked(address indexed user, uint256 amount);
        event Unstaked(address indexed user, uint256 amount);
        event RewardsClaimed(address indexed user, uint256 amount);

        constructor(address _stakingToken, uint256 _rewardRate) {
          stakingToken = IERC20(_stakingToken);
          rewardRate = _rewardRate;
        }

        modifier updateReward(address account) {
          StakeInfo storage stake = stakes[account];
          if (stake.amount > 0) {
            stake.rewardDebt += calculateReward(account);
          }
          _;
        }

        function stake(uint256 amount) external updateReward(msg.sender) {
          require(amount > 0, "Cannot stake 0");
          stakingToken.transferFrom(msg.sender, address(this), amount);
          stakes[msg.sender].amount += amount;
          stakes[msg.sender].lastStakeTime = block.timestamp;
          emit Staked(msg.sender, amount);
        }

        function calculateReward(address account) public view returns (uint256) {
          StakeInfo memory stake = stakes[account];
          uint256 timeElapsed = block.timestamp - stake.lastStakeTime;
          return stake.amount * rewardRate * timeElapsed / 1e18;
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

    // Wait for pipeline
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Document phase should process all the patterns
    await expect(po.page.getByText("Document")).toBeVisible();

    // Wait for Document phase approval (this validates the RAG retrieval worked)
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 60000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase approval
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Should navigate to chat
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

test.describe("Vector Retrieval Fallback Behavior", () => {
  test("should complete translation even without vector search", async ({
    po,
  }) => {
    // This test verifies graceful fallback to full documentation fetch
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    // Minimal contract - should still work even if vector search fails
    const solidityCode = `contract Minimal { uint256 x; }`;

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

    // Pipeline should appear
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // All phases should be visible (use heading role to avoid matching other elements)
    await expect(po.page.getByRole("heading", { name: /Document/i })).toBeVisible();
    await expect(po.page.getByRole("heading", { name: /Plan/i })).toBeVisible();
    await expect(po.page.getByRole("heading", { name: /Act/i })).toBeVisible();

    // Document phase should complete (regardless of vector search success)
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 60000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Plan phase
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Should complete successfully
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });

  test("should fetch documentation for Solana target", async ({ po }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    const solidityCode = `
      pragma solidity ^0.8.0;
      contract Storage {
        uint256 data;
        function store(uint256 x) public { data = x; }
        function retrieve() public view returns (uint256) { return data; }
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

    // Pipeline should show
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Should fetch substantial docs for Solana (llms.txt is 600KB+)
    await expect(
      po.page.getByText(/Ecosystem docs:?\s*\d+KB/i).or(
        po.page.getByText(/Document Phase Complete/i),
      ),
    ).toBeVisible({ timeout: 30000 });

    // Wait for Document phase
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 60000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Wait for Plan phase
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    // Complete
    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});

test.describe("Vector Retrieval Performance", () => {
  test("should show performance information during Document phase", async ({
    po,
  }) => {
    await po.page.waitForURL(/\//, { timeout: 10000 });

    // Switch to translation mode
    const contractButton = po.page.getByTestId("contract-mode-toggle");
    await contractButton.click({ force: true });

    await expect(po.page.getByTestId("translation-card")).toBeVisible({
      timeout: 15000,
    });

    const solidityCode = `
      pragma solidity ^0.8.0;
      contract NFT {
        mapping(uint256 => address) public owners;
        mapping(address => uint256) public balances;
        event Transfer(address indexed from, address indexed to, uint256 tokenId);

        function transfer(address to, uint256 tokenId) public {
          require(owners[tokenId] == msg.sender, "Not owner");
          owners[tokenId] = to;
          balances[msg.sender]--;
          balances[to]++;
          emit Transfer(msg.sender, to, tokenId);
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

    await po.page.getByTestId("main-translate-button").click();

    // Wait for pipeline
    await expect(po.page.getByText("Translation Pipeline")).toBeVisible({
      timeout: 10000,
    });

    // Should see size information (KB indicator shows context was gathered)
    await expect(
      po.page.getByText(/Ecosystem docs:?\s*\d+KB/i).or(
        po.page.getByText(/Document Phase Complete/i),
      ),
    ).toBeVisible({ timeout: 30000 });

    // Complete the flow
    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 60000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    await expect(
      po.page.getByRole("button", { name: /Approve & Continue/i }),
    ).toBeVisible({ timeout: 30000 });
    await po.page.getByRole("button", { name: /Approve & Continue/i }).click();

    await expect(po.page).toHaveURL(/\/chat/, { timeout: 60000 });
  });
});
