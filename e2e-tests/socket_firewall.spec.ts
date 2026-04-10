import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  testWithConfigSkipIfWindows,
  Timeout,
  type PageObject,
} from "./helpers/test_helper";

const originalNpmCache = process.env.npm_config_cache;
const originalNpmStoreDir = process.env.npm_config_store_dir;
const originalPnpmStoreDir = process.env.pnpm_config_store_dir;

const testSkipIfWindows = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ userDataDir }) => {
    const npmCacheDir = path.join(userDataDir, "npm-cache");
    const pnpmStoreDir = path.join(userDataDir, "pnpm-store");

    await fs.mkdir(npmCacheDir, { recursive: true });
    await fs.mkdir(pnpmStoreDir, { recursive: true });

    process.env.npm_config_cache = npmCacheDir;
    process.env.npm_config_store_dir = pnpmStoreDir;
    process.env.pnpm_config_store_dir = pnpmStoreDir;
  },
  postLaunchHook: async () => {
    if (originalNpmCache === undefined) {
      delete process.env.npm_config_cache;
    } else {
      process.env.npm_config_cache = originalNpmCache;
    }

    if (originalNpmStoreDir === undefined) {
      delete process.env.npm_config_store_dir;
    } else {
      process.env.npm_config_store_dir = originalNpmStoreDir;
    }

    if (originalPnpmStoreDir === undefined) {
      delete process.env.pnpm_config_store_dir;
    } else {
      process.env.pnpm_config_store_dir = originalPnpmStoreDir;
    }
  },
});

async function openMinimalBuildChat(po: PageObject) {
  await po.setUp();

  await po.navigation.goToSettingsTab();
  await expect(
    po.page.getByRole("switch", { name: "Block unsafe npm packages" }),
  ).toBeChecked();

  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
  await po.chatActions.clickNewChat();
  await po.chatActions.selectChatMode("build");

  const appPath = await po.appManagement.getCurrentAppPath();
  return {
    packageJsonPath: path.join(appPath, "package.json"),
    pnpmLockPath: path.join(appPath, "pnpm-lock.yaml"),
  };
}

testSkipIfWindows(
  "build mode - safe npm package installs through the real socket firewall path",
  async ({ po }) => {
    const { packageJsonPath, pnpmLockPath } = await openMinimalBuildChat(po);
    const initialPackageJson = await fs.readFile(packageJsonPath, "utf8");
    const initialPnpmLock = await fs.readFile(pnpmLockPath, "utf8");

    await po.sendPrompt("tc=add-safe-dependency");
    await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible({
      timeout: Timeout.LONG,
    });

    await po.approveProposal();
    await expect(async () => {
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, "utf8"),
      );
      expect(packageJson.dependencies?.lodash).toEqual(expect.any(String));
      expect(await fs.readFile(pnpmLockPath, "utf8")).not.toBe(initialPnpmLock);
    }).toPass({
      timeout: Timeout.EXTRA_LONG,
    });

    await expect(
      po.page.getByText(/Failed to add dependencies:/),
    ).not.toBeVisible();

    expect(await fs.readFile(packageJsonPath, "utf8")).not.toBe(
      initialPackageJson,
    );
  },
);

testSkipIfWindows(
  "build mode - blocked unsafe npm package shows the real socket verdict and preserves app files",
  async ({ po }) => {
    const { packageJsonPath, pnpmLockPath } = await openMinimalBuildChat(po);
    const initialPackageJson = await fs.readFile(packageJsonPath, "utf8");
    const initialPnpmLock = await fs.readFile(pnpmLockPath, "utf8");

    await po.sendPrompt("tc=add-unsafe-dependency");
    await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible({
      timeout: Timeout.LONG,
    });

    await po.approveProposal();

    const errorCard = po.page.getByRole("button", {
      name: /Failed to add dependencies: axois\./i,
    });
    await expect(errorCard).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    await errorCard.click();
    await expect(errorCard).toContainText(/blocked npm package/i, {
      timeout: Timeout.MEDIUM,
    });
    await expect(errorCard).toContainText(/axois/i, {
      timeout: Timeout.MEDIUM,
    });
    await expect(errorCard).toContainText(/malware/i, {
      timeout: Timeout.MEDIUM,
    });

    expect(await fs.readFile(packageJsonPath, "utf8")).toBe(initialPackageJson);
    expect(await fs.readFile(pnpmLockPath, "utf8")).toBe(initialPnpmLock);
  },
);
