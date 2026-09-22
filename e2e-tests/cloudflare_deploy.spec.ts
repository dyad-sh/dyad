import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  testWithConfig,
  Timeout,
  type ElectronConfig,
  type PageObject,
} from "./helpers/test_helper";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";

/**
 * Deploying a Cloudflare Worker, against a fake Cloudflare.
 *
 * Cloudflare's API host is fixed, so test builds redirect it to the fake
 * server the same way they redirect GitHub. The flow is otherwise the real
 * one: the real handlers, a real git push to the fake GitHub, and the real
 * readiness checks in between.
 */

// Not the fixture's default, so the spec can tell this value reached the rule
// rather than the default happening to match.
const TEST_PNPM_VERSION = "11.4.2";

const electronConfig: ElectronConfig = {
  // Cloudflare deployment is off by default, so every spec here opts in.
  preLaunchHook: async ({ userDataDir }) => {
    // Set here because the fixture clears it before each launch.
    process.env.DYAD_TEST_PNPM_VERSION = TEST_PNPM_VERSION;
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableCloudflareDeployment: true }),
      "utf8",
    );
  },
};

const test = testWithConfig(electronConfig);

// Later spec files in this worker read the variable when they load.
test.afterAll(() => {
  delete process.env.DYAD_TEST_PNPM_VERSION;
});

/** Fails here, by name, rather than later as a puzzling assertion. */
async function fakeCloudflare(port: number, path: string, init?: RequestInit) {
  const res = await fetch(
    `http://localhost:${port}/cloudflare/test/${path}`,
    init,
  );
  if (!res.ok) {
    throw new Error(`fake Cloudflare ${path} failed: ${res.status}`);
  }
  return res;
}

// The fake is shared by every test in the worker, so each starts clean.
test.beforeEach(async ({}, testInfo) => {
  await fakeCloudflare(FAKE_LLM_BASE_PORT + testInfo.parallelIndex, "reset", {
    method: "POST",
  });
});

async function cloudflareState(port: number) {
  const res = await fakeCloudflare(port, "state");
  return (await res.json()) as {
    workers: Array<Record<string, unknown>>;
    triggers: Array<Record<string, unknown>>;
    buildVariables: Record<string, Record<string, { value: string }>>;
  };
}

async function saveToken(po: PageObject) {
  await po.page.getByRole("tab", { name: "Cloudflare" }).click();
  await po.page
    .getByLabel("Cloudflare API Token")
    .fill("fake-cloudflare-token");
  await po.page.getByRole("button", { name: "Save API Token" }).click();
}

test("deploys a Worker from a subfolder and shows it live", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=cloudflare-worker");

  await po.previewPanel.selectPreviewMode("publish");
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`cloudflare-e2e-${Date.now()}`);

  await saveToken(po);

  // The name comes from the Worker's own Wrangler config.
  await expect(po.page.getByTestId("cloudflare-worker-name")).toHaveValue(
    "e2e-worker",
    { timeout: Timeout.MEDIUM },
  );
  await po.page.getByRole("button", { name: "Connect and Deploy" }).click();

  await expect(po.page.getByTestId("cloudflare-deployment-state")).toHaveText(
    /Live/,
    { timeout: Timeout.MEDIUM },
  );
  await expect(
    po.page.getByText("https://e2e-worker.fake-subdomain.workers.dev"),
  ).toBeVisible();

  const state = await cloudflareState(fakeLlmPort);
  expect(state.workers).toEqual([
    expect.objectContaining({ name: "e2e-worker", routeEnabled: true }),
  ]);
  expect(state.triggers).toEqual([
    expect.objectContaining({
      root_directory: "/worker",
      path_includes: ["worker/*"],
      branch_includes: ["main"],
      deploy_command: "npx wrangler deploy --name e2e-worker",
    }),
  ]);
  // The Worker is a pnpm project, and Cloudflare's default pnpm is too old
  // for the workspace files current tooling writes.
  const [trigger] = state.triggers;
  expect(
    state.buildVariables[String(trigger.trigger_uuid)]?.PNPM_VERSION?.value,
  ).toBe(TEST_PNPM_VERSION);
});

test("waits for Cloudflare to get access to the repository, then continues", async ({
  po,
}, testInfo) => {
  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  await po.setUp({ autoApprove: true });
  await fakeCloudflare(fakeLlmPort, "revoke-github-access", { method: "POST" });
  await po.sendPrompt("tc=cloudflare-worker");

  await po.previewPanel.selectPreviewMode("publish");
  await po.githubConnector.connect();
  await po.githubConnector.createRepo(`cloudflare-e2e-${Date.now()}`);

  await saveToken(po);

  await expect(po.page.getByTestId("cloudflare-repo-access")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByTestId("cloudflare-worker-form")).toBeHidden();

  // The user grants access in a browser; Dyad notices without being told.
  await fakeCloudflare(fakeLlmPort, "grant-github-access", { method: "POST" });

  await expect(po.page.getByTestId("cloudflare-worker-form")).toBeVisible({
    timeout: Timeout.LONG,
  });
});

test("asks for GitHub before anything about Cloudflare", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  await po.previewPanel.selectPreviewMode("publish");
  await po.page.getByRole("tab", { name: "Cloudflare" }).click();

  await expect(
    po.page.getByText("GitHub Required for Cloudflare Deployment"),
  ).toBeVisible();
  await expect(po.page.getByTestId("cloudflare-token-form")).toBeHidden();
});
