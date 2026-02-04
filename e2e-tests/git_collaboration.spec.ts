import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

test.describe("Git Collaboration", () => {
  //create git conflict helper function
  test("should create, switch, rename, merge, and delete branches", async ({
    po,
  }) => {
    await po.setUp({ disableNativeGit: false });
    await po.sendPrompt("tc=basic");

    await po.getTitleBarAppNameButton().click();
    await po.githubConnector.connect();

    // Create a new repo to start fresh
    const repoName = "test-git-collab-" + Date.now();
    await po.githubConnector.fillCreateRepoName(repoName);
    await po.githubConnector.clickCreateRepoButton();

    // Wait for repo to be connected
    await expect(po.page.getByTestId("github-connected-repo")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.githubConnector.snapshotConnectedRepo();

    // 1. Create a new branch
    const featureBranch = "feature-1";

    // User instruction: Open chat and go to publish tab
    await po.goToChatTab();
    await po.getTitleBarAppNameButton().click(); // Open Publish Panel

    // Wait for BranchManager to appear
    await expect(
      po.page.getByTestId("branch-actions-menu-trigger"),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.page.getByTestId("branch-actions-menu-trigger").click();
    await po.page.getByTestId("create-branch-trigger").click();
    await po.page.getByTestId("new-branch-name-input").fill(featureBranch);
    await po.page.getByTestId("create-branch-submit-button").click();

    // Verify we are on the new branch
    //open branches accordion
    const branchesCard = po.page.getByTestId("branches-header");
    await branchesCard.click();
    await expect(
      po.page.getByTestId(`branch-item-${featureBranch}`),
    ).toBeVisible();

    // 2. Create a branch from source (create feature-2 from main)
    // First switch back to main to ensure we are not on feature-1
    await po.page.getByTestId("branch-select-trigger").click();
    await po.page.getByRole("option", { name: "main" }).click();
    await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
      "main",
    );

    const featureBranch2 = "feature-2";
    await po.page.getByTestId("branch-actions-menu-trigger").click();
    await po.page.getByTestId("create-branch-trigger").click();
    await po.page.getByTestId("new-branch-name-input").fill(featureBranch2);
    // Select source branch 'main' explicitly (though it defaults to HEAD which is main)
    // To test the dropdown, let's select feature-1 as source actually
    await po.page.getByTestId("source-branch-select-trigger").click();
    await po.page.getByRole("option", { name: featureBranch }).click();
    await po.page.getByTestId("create-branch-submit-button").click();

    // Verify creation (it auto-switches to the new branch, so we verify we're on it)
    await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
      featureBranch2,
    );

    {
      const appPath = await po.getCurrentAppPath();
      if (!appPath) throw new Error("App path not found");
      const gitStatus = execSync("git status --porcelain", {
        cwd: appPath,
        encoding: "utf8",
      }).trim();
      expect(gitStatus).toBe("");
    }

    // 3. Rename Branch
    // Switch back to main first since we can't rename the branch we're currently on
    await po.page.getByTestId("branch-select-trigger").click();
    await po.page.getByRole("option", { name: "main" }).click();
    await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
      "main",
    );

    // Helper to ensure branch item is visible (expands accordion if needed)
    async function ensureBranchItemVisible(branchName: string) {
      const branchItem = po.page.getByTestId(`branch-item-${branchName}`);
      if (!(await branchItem.isVisible().catch(() => false))) {
        await branchesCard.click();
      }
      await expect(branchItem).toBeVisible({ timeout: Timeout.MEDIUM });
    }

    // Rename feature-2 to feature-2-renamed
    const renamedBranch = "feature-2-renamed";
    // Ensure the branches accordion is expanded (it may already be expanded, so check first)
    await ensureBranchItemVisible(featureBranch2);
    await po.page.getByTestId(`branch-actions-${featureBranch2}`).click();
    await po.page.getByTestId("rename-branch-menu-item").click();
    await po.page.getByTestId("rename-branch-input").fill(renamedBranch);
    await po.page.getByTestId("rename-branch-submit-button").click();

    // Verify rename
    await po.page.getByTestId("branch-select-trigger").click();
    await expect(
      po.page.getByRole("option", { name: renamedBranch }),
    ).toBeVisible();
    await expect(
      po.page.getByTestId(`branch-item-${featureBranch2}`),
    ).not.toBeVisible();
    await po.page.keyboard.press("Escape");

    // 4. Merge Branch
    // First, create a file on feature-1 to verify merge actually works
    const appPath = await po.getCurrentAppPath();
    if (!appPath) throw new Error("App path not found");

    // Switch to feature-1 and create a test file
    await po.page.getByTestId("branch-select-trigger").click();
    await po.page.getByRole("option", { name: featureBranch }).click();
    await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
      featureBranch,
    );

    const mergeTestFile = "merge-test.txt";
    const mergeTestFilePath = path.join(appPath, mergeTestFile);
    const featureContent = "Content from feature-1 branch";
    fs.writeFileSync(mergeTestFilePath, featureContent);
    // Configure git user for commit
    await po.configureGitUser();
    execSync(
      `git add ${mergeTestFile} && git commit -m "Add merge test file"`,
      {
        cwd: appPath,
      },
    );

    // Switch back to main
    await po.page.getByTestId("branch-select-trigger").click();
    await po.page.getByRole("option", { name: "main" }).click();
    await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
      "main",
    );

    // Verify file doesn't exist on main before merge
    expect(fs.existsSync(mergeTestFilePath)).toBe(false);

    // Merge feature-1 into main (we are currently on main)
    // Ensure the branches accordion is expanded
    await ensureBranchItemVisible(featureBranch);
    await po.page.getByTestId(`branch-actions-${featureBranch}`).click();
    await po.page.getByTestId("merge-branch-menu-item").click();
    await po.page.getByTestId("merge-branch-submit-button").click();

    // Wait for merge to complete
    await po.waitForToast("success", 10000);

    // Verify merge success: file should now exist on main
    await expect(async () => {
      expect(fs.existsSync(mergeTestFilePath)).toBe(true);
    }).toPass({ timeout: 5000 });
    expect(fs.readFileSync(mergeTestFilePath, "utf-8")).toBe(featureContent);

    // Verify git status is clean (no uncommitted changes)
    const gitStatus = execSync("git status --porcelain", {
      cwd: appPath,
      encoding: "utf8",
    }).trim();
    expect(gitStatus).toBe("");

    // Verify we're still on main branch
    const currentBranch = execSync("git branch --show-current", {
      cwd: appPath,
      encoding: "utf8",
    }).trim();
    expect(currentBranch).toBe("main");

    // 5. Delete Branch
    // Delete feature-1
    // Ensure the branches accordion is expanded
    await ensureBranchItemVisible(featureBranch);
    await po.page.getByTestId(`branch-actions-${featureBranch}`).click();
    await po.page.getByTestId("delete-branch-menu-item").click();
    await po.page.getByRole("button", { name: "Delete Branch" }).click();

    // Verify deletion
    await po.page.getByTestId("branch-select-trigger").click();
    await expect(
      po.page.getByTestId(`branch-item-${featureBranch}`),
    ).not.toBeVisible();
    await po.page.keyboard.press("Escape");
  });

  test("should pull changes from remote", async ({ po }) => {
    await po.setUp({ disableNativeGit: false });
    await po.sendPrompt("tc=basic");

    await po.getTitleBarAppNameButton().click();
    await po.githubConnector.connect();

    // Create a new repo to start fresh
    const repoName = "test-git-pull-" + Date.now();
    await po.githubConnector.fillCreateRepoName(repoName);
    await po.githubConnector.clickCreateRepoButton();

    // Wait for repo to be connected
    await expect(po.page.getByTestId("github-connected-repo")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    const appPath = await po.getCurrentAppPath();
    if (!appPath) throw new Error("App path not found");

    // Configure git user
    await po.configureGitUser();

    // Create a file locally
    const testFile = "pull-test.txt";
    const testFilePath = path.join(appPath, testFile);
    const fileContent = "Initial content";
    fs.writeFileSync(testFilePath, fileContent);
    execSync(`git add ${testFile} && git commit -m "Add pull test file"`, {
      cwd: appPath,
    });

    // Go to publish panel
    await po.goToChatTab();
    await po.getTitleBarAppNameButton().click();

    // Open the branch actions dropdown
    await expect(
      po.page.getByTestId("branch-actions-menu-trigger"),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Test git pull - should succeed with no remote changes
    await po.page.getByTestId("branch-actions-menu-trigger").click();
    await po.page.getByTestId("git-pull-button").click();

    // Wait for success toast
    await po.waitForToast("success", 10000);

    // Verify the file still exists (pull succeeded)
    expect(fs.existsSync(testFilePath)).toBe(true);
    expect(fs.readFileSync(testFilePath, "utf-8")).toBe(fileContent);

    // Verify git status is clean
    const gitStatus = execSync("git status --porcelain", {
      cwd: appPath,
      encoding: "utf8",
    }).trim();
    expect(gitStatus).toBe("");
  });

  test("should invite and remove collaborators", async ({ po }) => {
    await po.setUp();
    await po.sendPrompt("tc=basic");
    await po.selectPreviewMode("publish");
    await po.githubConnector.connect();

    const repoName = "test-git-collab-invite-" + Date.now();
    await po.githubConnector.fillCreateRepoName(repoName);
    await po.githubConnector.clickCreateRepoButton();
    await expect(po.page.getByTestId("github-connected-repo")).toBeVisible({
      timeout: 20000,
    });
    //open collaborators accordion
    const collaboratorsCard = po.page.getByTestId("collaborators-header");
    await collaboratorsCard.click();

    // Wait for Collaborator Manager
    await expect(
      po.page.getByTestId("collaborator-invite-input"),
    ).toBeVisible();

    // Invite a fake user
    const fakeUser = "test-user-123";
    await po.page.getByTestId("collaborator-invite-input").fill(fakeUser);
    await po.page.getByTestId("collaborator-invite-button").click();
    // Let's check for a toast.
    await po.waitForToast("success");

    // verify collaborator appears in the list
    await expect(
      po.page.getByTestId(`collaborator-item-${fakeUser}`),
    ).toBeVisible();

    // Delete collaborator
    await po.page.getByTestId(`collaborator-remove-button-${fakeUser}`).click();
    await po.page.getByTestId("confirm-remove-collaborator").click();
    await po.waitForToast("success");
    await expect(
      po.page.getByTestId(`collaborator-item-${fakeUser}`),
    ).not.toBeVisible({
      timeout: 5000,
    });
  });
});
