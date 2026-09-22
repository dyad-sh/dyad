import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  testWithConfig,
  Timeout,
  type ElectronConfig,
} from "./helpers/test_helper";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";

/**
 * Deploying a GitLab-linked app to a self-hosted Coolify, against a fake
 * GitLab and a fake Coolify.
 *
 * What this proves that the GitHub-backed deploy spec does not: the deploy
 * key lands on the GitLab project (read-only), and Coolify is told to clone
 * from the SSH URL GitLab reports, port and all, rather than one Dyad made up.
 */

/** Both features are behind experiments, off unless the user turns them on. */
const electronConfig: ElectronConfig = {
  preLaunchHook: async ({ userDataDir }) => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({
        enableOwnServerDeployment: true,
        enableGitlabPublishing: true,
      }),
      "utf8",
    );
  },
};

const test = testWithConfig(electronConfig);

const coolifyBase = (port: number) => `http://localhost:${port}/coolify`;

async function resetCoolify(port: number) {
  await fetch(`http://localhost:${port}/coolify/test/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function coolifyApplications(port: number) {
  const res = await fetch(`http://localhost:${port}/coolify/test/applications`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

test("deploys a GitLab-linked app through a deploy key on the project", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  await resetCoolify(fakeLlmPort);
  await po.gitlabConnector.reset();
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  // Link the app to a GitLab project from the Publish panel.
  await po.previewPanel.selectPreviewMode("publish");
  await po.gitlabConnector.chooseProvider();
  await po.gitlabConnector.connect();
  const projectName = `coolify-gitlab-e2e-${Date.now()}`;
  await po.gitlabConnector.createProject(projectName, "dyad-team");

  // Connect Coolify and pick where the app deploys.
  await po.page.getByRole("tab", { name: "Your Own Server" }).click();
  await po.page.getByTestId("coolify-setup-use-existing").click();
  await po.page
    .getByTestId("coolify-instance-url")
    .fill(coolifyBase(fakeLlmPort));
  await po.page.getByTestId("coolify-token").fill("1|fake-coolify-token");
  await po.page.getByTestId("coolify-save-token").click();
  await expect(po.page.getByTestId("coolify-server-select")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await po.page.getByTestId("coolify-server-select").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByTestId("coolify-project-select").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();
  await expect(po.page.getByTestId("coolify-deploy")).toBeEnabled({
    timeout: Timeout.MEDIUM,
  });

  await po.page.getByTestId("coolify-deploy").click();

  const applications = await expect
    .poll(async () => (await coolifyApplications(fakeLlmPort)).length, {
      timeout: Timeout.EXTRA_LONG,
    })
    .toBe(1)
    .then(() => coolifyApplications(fakeLlmPort));

  // Coolify clones from the URL GitLab reported, non-standard port included.
  expect(applications[0].git_repository).toBe(
    `ssh://git@fake-gitlab.local:2222/dyad-team/${projectName}.git`,
  );
  expect(applications[0].git_branch).toBe("main");

  // The public half of Dyad's key sits on the project, read-only.
  const keys = await po.gitlabConnector.getDeployKeys();
  expect(keys).toHaveLength(1);
  expect(keys[0].project).toBe(`dyad-team/${projectName}`);
  expect(keys[0].can_push).toBe(false);
  expect(keys[0].key).toMatch(/^ssh-ed25519 /);

  const address = String(applications[0].fqdn);
  await expect(
    po.page.getByText(address, { exact: false }).first(),
  ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
});
