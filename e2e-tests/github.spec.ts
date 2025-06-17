import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("should connect to GitHub using device flow", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  // Wait for device flow to start and show the code
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // Verify the verification URI is displayed
  await expect(
    po.page.locator("text=https://github.com/login/device"),
  ).toBeVisible();

  // Verify the "Set up your GitHub repo" section appears
  await expect(po.githubConnector.getSetupYourGitHubRepoButton()).toBeVisible();
});

test("create and sync to new repo", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  // Verify "Create new repo" is selected by default
  await expect(po.githubConnector.getCreateNewRepoModeButton()).toHaveClass(
    /bg-primary/,
  );

  await po.githubConnector.fillCreateRepoName("test-new-repo");

  // Wait for availability check
  await po.page.waitForSelector("text=Repository name is available!", {
    timeout: 5000,
  });

  // Click create repo button
  await po.githubConnector.clickCreateRepoButton();

  // Snapshot post-creation state
  await po.githubConnector.snapshotConnectedRepo();

  // Sync: capture success message
  await po.githubConnector.clickSyncToGithubButton();

  await po.githubConnector.snapshotConnectedRepo();
  // Verify the push was received for the default branch (main)
  await po.githubConnector.verifyPushEvent({
    repo: "test-new-repo",
    branch: "main",
    operation: "create",
  });
});

test("create and sync to new repo - custom branch", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  await po.githubConnector.fillCreateRepoName("test-new-repo");
  await po.githubConnector.fillNewRepoBranchName("new-branch");

  // Click create repo button
  await po.githubConnector.clickCreateRepoButton();

  // Sync to GitHub
  await po.githubConnector.clickSyncToGithubButton();

  // Snapshot post-creation state
  await po.githubConnector.snapshotConnectedRepo();

  // Verify the push was received for the correct custom branch
  await po.githubConnector.verifyPushEvent({
    repo: "test-new-repo",
    branch: "new-branch",
    operation: "create",
  });
});

test("disconnect from repo", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  await po.githubConnector.fillCreateRepoName("test-new-repo");
  await po.githubConnector.clickCreateRepoButton();

  await po.githubConnector.clickDisconnectRepoButton();
  await po.githubConnector.getSetupYourGitHubRepoButton().click();
  // Make this deterministic
  await po.githubConnector.fillCreateRepoName("[scrubbed]");
  await po.githubConnector.snapshotSetupRepo();
});

test("create and sync to existing repo", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  await po.githubConnector.getConnectToExistingRepoModeButton().click();

  await po.githubConnector.selectRepo("testuser/existing-app");
  await po.githubConnector.selectBranch("main");
  await po.githubConnector.clickConnectToRepoButton();

  await po.githubConnector.snapshotConnectedRepo();
});

test("create and sync to existing repo - custom branch", async ({ po }) => {
  // Clear any previous push events
  await po.githubConnector.clearPushEvents();

  await po.setUp();
  await po.sendPrompt("tc=basic");

  await po.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();

  await po.githubConnector.getConnectToExistingRepoModeButton().click();

  await po.githubConnector.selectRepo("testuser/existing-app");
  await po.githubConnector.selectCustomBranch("new-branch");
  await po.githubConnector.clickConnectToRepoButton();

  // Sync to GitHub to trigger a push
  await po.githubConnector.clickSyncToGithubButton();
  await po.githubConnector.snapshotConnectedRepo();
  // Verify the push was received for the correct custom branch
  await po.githubConnector.verifyPushEvent({
    repo: "existing-app",
    branch: "new-branch",
    operation: "create",
  });
});
