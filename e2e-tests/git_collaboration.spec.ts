import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { PageObject } from "./helpers/test_helper";
async function createGitConflict(po: PageObject) {
  await po.setUp({ nativeGit: true }); // Conflicts are easier to handle with native git usually
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  const repoName = "test-git-conflict-" + Date.now();
  await po.githubConnector.fillCreateRepoName(repoName);
  await po.githubConnector.clickCreateRepoButton();
  await expect(po.page.getByTestId("github-connected-repo")).toBeVisible({
    timeout: 20000,
  });

  const appPath = await po.getCurrentAppPath();
  if (!appPath) throw new Error("App path not found");

  // Setup conflict
  const conflictFile = "conflict.txt";
  const conflictFilePath = path.join(appPath, conflictFile);

  // 1. Create file on main
  fs.writeFileSync(conflictFilePath, "Line 1\nLine 2\nLine 3");
  execSync(`git add ${conflictFile} && git commit -m "Add conflict file"`, {
    cwd: appPath,
  });

  // 2. Create feature branch
  const featureBranch = "feature-conflict";
  execSync(`git checkout -b ${featureBranch}`, { cwd: appPath });
  fs.writeFileSync(conflictFilePath, "Line 1\nLine 2 Modified Feature\nLine 3");
  execSync(`git add ${conflictFile} && git commit -m "Modify on feature"`, {
    cwd: appPath,
  });

  // 3. Switch back to main and modify
  execSync(`git checkout main`, { cwd: appPath });
  fs.writeFileSync(conflictFilePath, "Line 1\nLine 2 Modified Main\nLine 3");
  execSync(`git add ${conflictFile} && git commit -m "Modify on main"`, {
    cwd: appPath,
  });

  // 4. Try to merge feature into main via UI
  await po.goToChatTab();
  await po.getTitleBarAppNameButton().click(); // Open Publish Panel

  // We need to merge 'feature-conflict' into 'main'.
  // Find the branch in the list.

  //open branches accordion
  const branchesCard = po.page.getByTestId("branches-header");
  await branchesCard.hover();

  await po.page.getByTestId(`branch-actions-${featureBranch}`).click();
  await po.page.getByTestId("merge-branch-menu-item").click();
  await po.page.getByTestId("merge-branch-submit-button").click();
  return { conflictFile };
}

async function getCurrentAppId(po: PageObject): Promise<number | null> {
  const currentAppName = await po.getCurrentAppName();
  return await po.page.evaluate(async (appName) => {
    const result = await (window as any).electron.ipcRenderer.invoke(
      "list-apps",
    );
    const match = result.apps.find((app: any) => app.name === appName);
    return match?.id ?? null;
  }, currentAppName);
}

/**
 * Sets up a rebase conflict scenario for testing.
 * Creates a base commit, feature branch with changes, diverging main changes,
 * and starts a rebase that will conflict.
 * @returns Object with conflict file path and feature branch name
 */
async function setupRebaseConflict(
  po: PageObject,
  options: { nativeGit?: boolean } = {},
): Promise<{
  conflictFile: string;
  conflictFilePath: string;
  featureBranch: string;
  appPath: string;
}> {
  await po.setUp({ nativeGit: options.nativeGit ?? false });
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  const repoName = "test-rebase-gate-" + Date.now();
  await po.githubConnector.fillCreateRepoName(repoName);
  await po.githubConnector.clickCreateRepoButton();
  await expect(po.page.getByTestId("github-connected-repo")).toBeVisible({
    timeout: 20000,
  });

  const appPath = await po.getCurrentAppPath();
  if (!appPath) throw new Error("App path not found");

  const conflictFile = "rebase-conflict.txt";
  const conflictFilePath = path.join(appPath, conflictFile);
  const featureBranch = "rebase-feature";

  // Base commit
  fs.writeFileSync(conflictFilePath, "Line 1\nLine 2\nLine 3");
  execSync(`git add ${conflictFile} && git commit -m "Base commit"`, {
    cwd: appPath,
  });

  // Feature branch change
  execSync(`git checkout -b ${featureBranch}`, { cwd: appPath });
  fs.writeFileSync(conflictFilePath, "Line 1\nLine 2 Feature\nLine 3");
  execSync(`git add ${conflictFile} && git commit -m "Feature change"`, {
    cwd: appPath,
  });

  // Diverging change on main
  execSync(`git checkout main`, { cwd: appPath });
  fs.writeFileSync(conflictFilePath, "Line 1\nLine 2 Main\nLine 3");
  execSync(`git add ${conflictFile} && git commit -m "Main change"`, {
    cwd: appPath,
  });

  // Start rebase that will conflict
  execSync(`git checkout ${featureBranch}`, { cwd: appPath });
  let rebaseErrored = false;
  try {
    execSync(`git rebase main`, { cwd: appPath });
  } catch {
    rebaseErrored = true;
  }
  if (!rebaseErrored) {
    throw new Error("Expected rebase to produce conflicts");
  }

  return { conflictFile, conflictFilePath, featureBranch, appPath };
}

test.describe("Git Collaboration", () => {
  //create git conflict helper function
  test("should create, switch, rename, merge, and delete branches", async ({
    po,
  }) => {
    await po.setUp({ nativeGit: true });
    await po.sendPrompt("tc=basic");

    await po.getTitleBarAppNameButton().click();
    await po.githubConnector.connect();

    // Create a new repo to start fresh
    const repoName = "test-git-collab-" + Date.now();
    await po.githubConnector.fillCreateRepoName(repoName);
    await po.githubConnector.clickCreateRepoButton();

    // Wait for repo to be connected
    await expect(po.page.getByTestId("github-connected-repo")).toBeVisible({
      timeout: 20000,
    });
    await po.githubConnector.snapshotConnectedRepo();

    // 1. Create a new branch
    const featureBranch = "feature-1";

    // User instruction: Open chat and go to publish tab
    await po.goToChatTab();
    await po.getTitleBarAppNameButton().click(); // Open Publish Panel

    // Wait for BranchManager to appear
    await expect(po.page.getByTestId("create-branch-trigger")).toBeVisible({
      timeout: 10000,
    });
    await po.page.getByTestId("create-branch-trigger").click();
    await po.page.getByTestId("new-branch-name-input").fill(featureBranch);
    await po.page.getByTestId("create-branch-submit-button").click();

    // Verify we are on the new branch
    //open branches accordion
    const branchesCard = po.page.getByTestId("branches-header");
    await branchesCard.hover();
    await expect(
      po.page.getByTestId(`branch-item-${featureBranch}`),
    ).toBeVisible();

    // 2. Create a branch from source (create feature-2 from main)
    // First switch back to main to ensure we are not on feature-1
    await po.page.getByTestId("branch-select-trigger").click();
    await po.page.getByRole("option", { name: "main" }).click();
    await expect(po.page.getByTestId("current-branch-display")).toHaveText(
      "main",
    );

    const featureBranch2 = "feature-2";
    await po.page.getByTestId("create-branch-trigger").click();
    await po.page.getByTestId("new-branch-name-input").fill(featureBranch2);
    // Select source branch 'main' explicitly (though it defaults to HEAD which is main)
    // To test the dropdown, let's select feature-1 as source actually
    await po.page.getByTestId("source-branch-select-trigger").click();
    await po.page.getByRole("option", { name: featureBranch }).click();
    await po.page.getByTestId("create-branch-submit-button").click();

    // Verify creation (it doesn't auto-switch, so we check list)
    await po.page.getByTestId("branch-select-trigger").click();
    await expect(
      po.page.getByRole("option", { name: featureBranch2 }),
    ).toBeVisible();
    await po.page.keyboard.press("Escape"); // Close select

    // 3. Rename Branch
    // Rename feature-2 to feature-2-renamed
    const renamedBranch = "feature-2-renamed";
    await branchesCard.hover();
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
    await expect(po.page.getByTestId("current-branch-display")).toHaveText(
      featureBranch,
    );

    const mergeTestFile = "merge-test.txt";
    const mergeTestFilePath = path.join(appPath, mergeTestFile);
    const featureContent = "Content from feature-1 branch";
    fs.writeFileSync(mergeTestFilePath, featureContent);
    execSync(
      `git add ${mergeTestFile} && git commit -m "Add merge test file"`,
      {
        cwd: appPath,
      },
    );

    // Switch back to main
    await po.page.getByTestId("branch-select-trigger").click();
    await po.page.getByRole("option", { name: "main" }).click();
    await expect(po.page.getByTestId("current-branch-display")).toHaveText(
      "main",
    );

    // Verify file doesn't exist on main before merge
    expect(fs.existsSync(mergeTestFilePath)).toBe(false);

    // Merge feature-1 into main (we are currently on main)
    await branchesCard.hover();
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
    await branchesCard.hover();
    await po.page.getByTestId(`branch-actions-${featureBranch}`).click();
    await po.page.getByTestId("delete-branch-menu-item").click();
    // Confirm delete (native confirm dialog handling might be needed or custom dialog)
    // The implementation uses `confirm()`, so we need to handle the dialog.
    await po.page.getByRole("button", { name: "Delete Branch" }).click();

    // Verify deletion
    await po.page.getByTestId("branch-select-trigger").click();
    await expect(
      po.page.getByTestId(`branch-item-${featureBranch}`),
    ).not.toBeVisible();
    await po.page.keyboard.press("Escape");
  });

  test("should resolve merge conflicts with AI", async ({ po }) => {
    await createGitConflict(po);
    // Verify Conflict Dialog appears
    await expect(po.page.getByText("Resolve Conflicts")).toBeVisible({
      timeout: 10000,
    });
    //use AI to resolve conflicts
    await po.page.getByRole("button", { name: "Auto-Resolve with AI" }).click();
    await po.waitForToastWithText(`AI suggested a resolution`);
  });
  test("should resolve merge conflicts manually", async ({ po }) => {
    await createGitConflict(po);
    // Verify Conflict Dialog appears
    await expect(po.page.getByText("Resolve Conflicts")).toBeVisible({
      timeout: 10000,
    });
    //use Manual resolution
    await po.page.getByRole("button", { name: "Manual Git Resolve" }).click();
    await po.waitForToastWithText(`Applied manual conflict resolution`);
  });

  test("should resolve merge conflicts manually with text editor", async ({
    po,
  }) => {
    const { conflictFile } = await createGitConflict(po);
    await expect(po.page.getByText("Resolve Conflicts")).toBeVisible({
      timeout: 10000,
    });

    const resolvedContent = "Line 1\nLine 2 Resolved\nLine 3";
    await po.editFileContent(resolvedContent);
    await po.page.getByTestId("finish-resolution-button").click();

    await po.waitForToastWithText(`Resolved ${conflictFile}`);
    await expect(po.page.getByText("Resolve Conflicts")).not.toBeVisible();
  });

  test("should block completion when conflicts remain unresolved", async ({
    po,
  }) => {
    await createGitConflict(po);
    await expect(po.page.getByText("Resolve Conflicts")).toBeVisible({
      timeout: 10000,
    });

    // Attempt to finish without resolving; backend should reject due to conflicts
    await po.page.getByTestId("finish-resolution-button").click();
    await po.waitForToastWithText("still have conflicts", 10000);
  });

  test("should fail rebase completion when native git is disabled", async ({
    po,
  }) => {
    const { conflictFile, conflictFilePath, appPath } =
      await setupRebaseConflict(po, { nativeGit: false });

    // Resolve the conflict but leave rebase in-progress so completion requires native git
    fs.writeFileSync(conflictFilePath, "Line 1\nLine 2 Resolved\nLine 3");
    execSync(`git add ${conflictFile}`, { cwd: appPath });

    const appId = await getCurrentAppId(po);
    if (!appId) throw new Error("App ID not found");

    const result = await po.page.evaluate(async (id) => {
      return (window as any).electron.ipcRenderer.invoke(
        "github:complete-merge",
        {
          appId: id,
        },
      );
    }, appId);

    expect(result.success).toBe(false);
    expect(result.error).toContain("requires native Git");
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
    await collaboratorsCard.hover();

    // Wait for Collaborator Manager
    await expect(
      po.page.getByTestId("collaborator-invite-input"),
    ).toBeVisible();

    // Invite a fake user
    const fakeUser = "test-user-123";
    await po.page.getByTestId("collaborator-invite-input").fill(fakeUser);
    await po.page.getByTestId("collaborator-invite-button").click();
    // Let's check for a toast.
    await po.waitForToast();

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
    ).not.toBeVisible({ timeout: 5000 });
  });
});
