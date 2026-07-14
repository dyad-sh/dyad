import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect } from "@playwright/test";

import { test, Timeout } from "./helpers/test_helper";

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test User",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: "pipe",
    },
  )
    .toString()
    .trim();
}

test("completes the GitHub publish happy paths", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.appManagement.getTitleBarAppNameButton().click();

  await po.githubConnector.connect();
  await expect(po.githubConnector.getSetupRepo()).toContainText(
    "Set up your GitHub repo",
    { timeout: Timeout.MEDIUM },
  );

  const repoName = `github-e2e-${Date.now()}`;
  await po.githubConnector.createRepo(repoName);
  await expect(po.page.getByTestId("github-connected-repo")).toContainText(
    `testuser/${repoName}`,
  );
  await po.githubConnector.expectPushEvent({
    repo: repoName,
    branch: "main",
    operation: "create",
  });

  const collaborators = po.page.getByTestId("collaborators-header");
  await collaborators.click();
  const collaborator = "github-e2e-collaborator";
  await po.page.getByTestId("collaborator-invite-input").fill(collaborator);
  await po.page.getByTestId("collaborator-invite-button").click();
  await expect(
    po.page.getByTestId(`collaborator-item-${collaborator}`),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page
    .getByTestId(`collaborator-remove-button-${collaborator}`)
    .click();
  await po.page.getByTestId("confirm-remove-collaborator").click();
  await expect(
    po.page.getByTestId(`collaborator-item-${collaborator}`),
  ).toBeHidden({ timeout: Timeout.MEDIUM });

  const branchMenu = po.page.getByTestId("branch-actions-menu-trigger");
  await expect(branchMenu).toBeVisible({ timeout: Timeout.MEDIUM });
  await branchMenu.click();
  await po.page.getByTestId("create-branch-trigger").click();
  await po.page.getByTestId("new-branch-name-input").fill("feature-e2e");
  await po.page.getByTestId("create-branch-submit-button").click();
  await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
    "feature-e2e",
    { timeout: Timeout.MEDIUM },
  );

  const appPath = await po.appManagement.getCurrentAppPath();
  fs.writeFileSync(path.join(appPath, "github-e2e.txt"), "from feature branch");
  git(appPath, "add", "github-e2e.txt");
  git(appPath, "commit", "-m", "Add GitHub E2E fixture");

  await po.page.getByTestId("branch-select-trigger").click();
  await po.page.getByRole("option", { name: "main" }).click();
  await expect(po.page.getByTestId("branch-select-trigger")).toContainText(
    "main",
  );
  expect(fs.existsSync(path.join(appPath, "github-e2e.txt"))).toBe(false);

  await po.page.getByTestId("branches-header").click();
  await po.page.getByTestId("branch-actions-feature-e2e").click();
  await po.page.getByTestId("rename-branch-menu-item").click();
  await po.page.getByTestId("rename-branch-input").fill("feature-publish");
  await po.page.getByTestId("rename-branch-submit-button").click();
  await expect(po.page.getByTestId("branch-item-feature-publish")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  await po.page.getByTestId("branch-actions-feature-publish").click();
  await po.page.getByTestId("merge-branch-menu-item").click();
  await po.page.getByTestId("merge-branch-submit-button").click();
  await expect
    .poll(() => fs.existsSync(path.join(appPath, "github-e2e.txt")), {
      timeout: Timeout.MEDIUM,
    })
    .toBe(true);

  await po.page.getByTestId("branch-actions-feature-publish").click();
  await po.page.getByTestId("delete-branch-menu-item").click();
  await po.page.getByRole("button", { name: "Delete Branch" }).click();
  await expect(po.page.getByTestId("branch-item-feature-publish")).toBeHidden({
    timeout: Timeout.MEDIUM,
  });

  await po.githubConnector.sync();
  const remoteUrl = git(appPath, "remote", "get-url", "origin");
  const remoteClone = path.join(po.userDataDir, "github-remote-clone");
  fs.mkdirSync(remoteClone, { recursive: true });
  git(remoteClone, "clone", remoteUrl, ".");
  fs.writeFileSync(path.join(remoteClone, "remote-change.txt"), "from remote");
  git(remoteClone, "add", "remote-change.txt");
  git(remoteClone, "commit", "-m", "Add remote change");
  git(remoteClone, "push", "origin", "HEAD:main");

  await branchMenu.click();
  await po.page.getByTestId("git-pull-button").click();
  await expect(
    po.page.getByText("Pulled latest changes from remote"),
  ).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect
    .poll(() => fs.existsSync(path.join(appPath, "remote-change.txt")), {
      timeout: Timeout.MEDIUM,
    })
    .toBe(true);

  await po.githubConnector.disconnectRepo();
  await po.githubConnector.connectExistingRepo("testuser/existing-app", "main");
  await expect(po.page.getByTestId("github-connected-repo")).toContainText(
    "testuser/existing-app",
  );
});
