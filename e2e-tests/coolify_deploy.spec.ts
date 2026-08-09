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
 * Deploying to a self-hosted Coolify, against a fake instance.
 *
 * Unlike GitHub, Coolify needs no build-time redirect: the instance URL is
 * something the user types, so these fill in the fake's address the way a
 * user fills in their own server's. What that buys is coverage of the real
 * path — the same handlers, the same state machine, the same queries — with
 * nothing test-only in production code.
 *
 * The deploy keys these generate land in the app's userData directory, which
 * the fixture already points at a per-worker temporary path, so nothing here
 * touches the developer's ~/.ssh.
 */

/** The feature is behind an experiment, off unless the user turns it on. */
const electronConfig: ElectronConfig = {
  preLaunchHook: async ({ userDataDir }) => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableOwnServerDeployment: true }),
      "utf8",
    );
  },
};

const test = testWithConfig(electronConfig);

const coolifyBase = (port: number) => `http://localhost:${port}/coolify`;

async function resetCoolify(port: number, overrides: unknown = {}) {
  await fetch(`http://localhost:${port}/coolify/test/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
  await fetch(`http://localhost:${port}/github/api/test/clear-deploy-keys`, {
    method: "POST",
  });
}

async function coolifyApplications(port: number) {
  const res = await fetch(`http://localhost:${port}/coolify/test/applications`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

/**
 * Gets as far as a saved connection: token, server and project chosen.
 *
 * The address is plain HTTP, which is what a stock Coolify serves until it
 * has a certificate — so this also walks the consent the connection form
 * asks for before it will send a token over an unencrypted link.
 */
async function connectCoolify(po: any, fakeLlmPort: number) {
  await po.selectPreviewMode("publish");
  await po.page.getByRole("tab", { name: "Your Own Server" }).click();

  await po.page.getByLabel("Coolify address").fill(coolifyBase(fakeLlmPort));
  await po.page.getByLabel("API token").fill("1|fake-coolify-token");
  // Plain HTTP, so the form asks before sending a token over it.
  await po.page.getByRole("checkbox").check();
  await po.page.getByTestId("coolify-save-token").click();

  await expect(po.page.getByLabel("Server")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
}

test("connects to an instance and saves where the app deploys", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  // No deployment here, so this one never waits on the pipeline's poll
  // interval — it covers the half of the surface that is all UI.
  await resetCoolify(fakeLlmPort);
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");
  await po.appManagement.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`coolify-${testInfo.parallelIndex}`);

  await connectCoolify(po, fakeLlmPort);

  await po.page.getByLabel("Server").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByLabel("Project").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();

  await expect(po.page.getByTestId("coolify-deploy")).toBeEnabled({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByText("production / demo-project")).toBeVisible();
});

test("refuses to deploy an app whose server is on another instance", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  await resetCoolify(fakeLlmPort);
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");
  await po.appManagement.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`coolify-${testInfo.parallelIndex}`);
  await connectCoolify(po, fakeLlmPort);

  await po.page.getByLabel("Server").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByLabel("Project").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();
  await expect(po.page.getByTestId("coolify-deploy")).toBeEnabled({
    timeout: Timeout.MEDIUM,
  });

  // The instance now reports a different server, as it would after the token
  // was repointed somewhere else. The app's application is still running
  // where it was, so Dyad must say so rather than offer to deploy.
  await resetCoolify(fakeLlmPort, {
    servers: [{ uuid: "srv-elsewhere", name: "other", ip: "203.0.113.99" }],
  });
  await po.page.getByLabel("Refresh servers and projects").click();

  await expect(
    po.page.getByText("This app belongs to a different Coolify."),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(po.page.getByTestId("coolify-deploy")).toBeDisabled();
});

test("deploys, and reports the address the app is reachable at", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  // The one spec that pays the pipeline's poll interval, and it pays it once:
  // the fake reports the build finished on the first poll.
  await resetCoolify(fakeLlmPort);
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");
  await po.appManagement.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`coolify-${testInfo.parallelIndex}`);
  await connectCoolify(po, fakeLlmPort);

  await po.page.getByLabel("Server").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByLabel("Project").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();

  await po.page.getByTestId("coolify-deploy").click();

  await expect(po.page.getByText("Deployed", { exact: false })).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });

  const applications = await coolifyApplications(fakeLlmPort);
  expect(applications).toHaveLength(1);
  // What Dyad claims about an app is the thing three rounds of review kept
  // getting wrong, so it is asserted against what the instance received.
  expect(applications[0].build_pack).toBe("railpack");
  expect(applications[0].ports_exposes).toBe("3000");
  expect(applications[0].server_uuid).toBe("srv-1");
});

test("shows the build log when the deployment fails", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  await resetCoolify(fakeLlmPort, { deploymentScript: ["failed"] });
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");
  await po.appManagement.getTitleBarAppNameButton().click();
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`coolify-${testInfo.parallelIndex}`);
  await connectCoolify(po, fakeLlmPort);

  await po.page.getByLabel("Server").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByLabel("Project").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();

  await po.page.getByTestId("coolify-deploy").click();

  // A failed build is only actionable if what the builder said comes back.
  await expect(po.page.getByText("npm ERR! build failed")).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });
});
