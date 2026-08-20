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
 * Connects GitHub from the Publish panel, which is where the Coolify tab is.
 *
 * Coolify deploys from a repository, so an app has to have one before any of
 * this is reachable — and the panel carries its own GitHub section, so the
 * whole flow stays on one screen rather than navigating to app details and
 * back.
 */
async function connectGithubFromPublishPanel(po: any) {
  await po.previewPanel.selectPreviewMode("publish");
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`coolify-e2e-${Date.now()}`);
}

/**
 * Gets as far as a saved connection: token, server and project chosen.
 *
 * No insecure-address consent here, and that is correct rather than a gap:
 * the fake answers on loopback, which isSecureInstanceUrl treats as secure
 * because nothing can sit between the app and 127.0.0.1. The consent path a
 * real plain-HTTP instance triggers is covered by unit tests instead.
 */
async function connectCoolify(po: any, fakeLlmPort: number) {
  await po.page.getByRole("tab", { name: "Your Own Server" }).click();
  // The tab opens on the installer, so switch to the paste-a-token form.
  await po.page.getByTestId("coolify-setup-use-existing").click();

  await po.page
    .getByTestId("coolify-instance-url")
    .fill(coolifyBase(fakeLlmPort));
  await po.page.getByTestId("coolify-token").fill("1|fake-coolify-token");
  await po.page.getByTestId("coolify-save-token").click();

  await expect(po.page.getByTestId("coolify-server-select")).toBeVisible({
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
  await connectGithubFromPublishPanel(po);

  await connectCoolify(po, fakeLlmPort);

  await po.page.getByTestId("coolify-server-select").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByTestId("coolify-project-select").click();
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
  await connectGithubFromPublishPanel(po);
  await connectCoolify(po, fakeLlmPort);

  await po.page.getByTestId("coolify-server-select").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByTestId("coolify-project-select").click();
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
  // Discovery is cached per instance and the connected view has no control
  // that re-asks, so this takes the route a user would: open the form, press
  // refresh, and come back out without changing anything.
  // Scoped to the connector: the chat transcript has its own Edit buttons.
  const connector = po.page.getByTestId("coolify-connector");
  await connector.getByRole("button", { name: "Edit" }).click();
  await connector
    .getByRole("button", { name: "Refresh servers and projects" })
    .click();
  await connector.getByRole("button", { name: "Cancel" }).click();

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
  await connectGithubFromPublishPanel(po);
  await connectCoolify(po, fakeLlmPort);

  await po.page.getByTestId("coolify-server-select").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByTestId("coolify-project-select").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();

  await po.page.getByTestId("coolify-deploy").click();

  // The address, which is the claim in this test's name and the one thing the
  // PR singles out about deploying without a domain: Coolify generates an
  // sslip.io host and the panel has to offer it back.
  const applications = await expect
    .poll(async () => (await coolifyApplications(fakeLlmPort)).length, {
      timeout: Timeout.EXTRA_LONG,
    })
    .toBe(1)
    .then(() => coolifyApplications(fakeLlmPort));

  const address = String(applications[0].fqdn);
  expect(address).toContain("sslip.io");
  // The panel shows it as a link and repeats it in the deploy log, so first()
  // rather than a locator that has to know which.
  await expect(
    po.page.getByText(address, { exact: false }).first(),
  ).toBeVisible({ timeout: Timeout.EXTRA_LONG });

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
  await connectGithubFromPublishPanel(po);
  await connectCoolify(po, fakeLlmPort);

  await po.page.getByTestId("coolify-server-select").click();
  await po.page.getByRole("option", { name: "production" }).click();
  await po.page.getByTestId("coolify-project-select").click();
  await po.page.getByRole("option", { name: "demo-project" }).click();
  await po.page.getByTestId("coolify-save-connection").click();

  await po.page.getByTestId("coolify-deploy").click();

  // A failed build is only actionable if what the builder said comes back —
  // and readable. This passed before by substring-matching inside the JSON
  // Coolify sends, so it also checks the wrapping is gone.
  await expect(po.page.getByText("npm ERR! build failed")).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });
  await expect(po.page.getByText('{"output"')).toHaveCount(0);
});
