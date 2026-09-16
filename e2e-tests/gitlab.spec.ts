import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { expect } from "@playwright/test";

import {
  testWithConfig,
  Timeout,
  type ElectronConfig,
} from "./helpers/test_helper";

/**
 * Publishing to GitLab, against a fake instance.
 *
 * The instance URL is something the user types, so this fills in the fake's
 * address the way a user fills in their own instance's, and the whole path
 * runs unchanged: the same client, the same handlers, the same git plumbing.
 * One broad journey rather than several narrow ones, as the e2e rule asks.
 */

/** The feature is behind an experiment, off unless the user turns it on. */
const electronConfig: ElectronConfig = {
  preLaunchHook: async ({ userDataDir }) => {
    await fsp.mkdir(userDataDir, { recursive: true });
    await fsp.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableGitlabPublishing: true }),
      "utf8",
    );
  },
};

const test = testWithConfig(electronConfig);

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

test("publishes to GitLab: connect, create a project, sync, link an existing one", async ({
  po,
}) => {
  await po.gitlabConnector.reset();
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=basic");
  // Git operations coordinate with app startup; wait for the preview so the
  // install and runtime have released their claims.
  await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
  await po.previewPanel.selectPreviewMode("publish");

  // With the experiment on, an unlinked app offers both providers.
  await expect(po.page.getByTestId("repository-provider-choice")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await po.gitlabConnector.chooseProvider();
  await po.gitlabConnector.connect();
  await expect(po.gitlabConnector.getSetupRepo()).toContainText(
    "Set up your GitLab project",
  );
  await expect(po.gitlabConnector.getSetupRepo()).toContainText("gitlabuser");

  const projectName = `gitlab-e2e-${Date.now()}`;
  await po.gitlabConnector.createProject(projectName, "dyad-team");
  const connected = po.gitlabConnector.getConnectedRepo();
  await expect(connected).toContainText(`dyad-team/${projectName}`);
  await po.gitlabConnector.expectPushEvent({
    path: `dyad-team/${projectName}`,
    branch: "main",
    operation: "create",
  });
  // The card is now about GitLab, and the provider choice is gone.
  await expect(po.page.getByTestId("publish-repository-card")).toContainText(
    "GitLab",
  );
  await expect(po.page.getByTestId("repository-provider-choice")).toHaveCount(
    0,
  );

  // A second sync carries a new local commit up.
  const appPath = await po.appManagement.getCurrentAppPath();
  fs.writeFileSync(path.join(appPath, "gitlab-e2e.txt"), "hello gitlab");
  git(appPath, "add", "gitlab-e2e.txt");
  git(appPath, "commit", "-m", "Add GitLab E2E fixture");
  await po.gitlabConnector.sync();
  await po.gitlabConnector.expectPushEvent({
    path: `dyad-team/${projectName}`,
    branch: "main",
    operation: "push",
  });

  // The credentials never reach .git/config.
  const remoteUrl = git(appPath, "remote", "get-url", "origin");
  expect(remoteUrl).toBe(
    `${po.gitlabConnector.instanceUrl()}/dyad-team/${projectName}.git`,
  );

  // Link an existing project instead.
  await po.gitlabConnector.disconnectRepo();
  await po.gitlabConnector.connectExistingProject(
    "dyad-team/existing-app",
    "main",
  );
  await expect(connected).toContainText("dyad-team/existing-app");
  await po.gitlabConnector.expectPushEvent({
    path: "dyad-team/existing-app",
    branch: "main",
    operation: "create",
  });

  // Settings reports the connection and can drop it.
  await po.navigation.goToSettingsTab();
  await expect(po.page.getByTestId("gitlab-integration-status")).toContainText(
    "gitlabuser",
    { timeout: Timeout.MEDIUM },
  );
  await po.page.getByTestId("gitlab-disconnect-button").click();
  await expect(po.page.getByTestId("gitlab-credentials-form")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});
