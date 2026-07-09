import { expect, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
const originalPath = process.env.PATH;
const originalTestPnpmVersion = process.env.DYAD_TEST_PNPM_VERSION;
const originalTestInstallPnpmVersion =
  process.env.DYAD_TEST_INSTALL_PNPM_VERSION;
const originalDefaultApproveBuildsUrl =
  process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL;
const SOCKET_FIREWALL_VERDICT_TIMEOUT = process.env.CI
  ? 240_000
  : Timeout.EXTRA_LONG;
const SOCKET_FIREWALL_TEST_TIMEOUT = process.env.CI
  ? 360_000
  : Timeout.EXTRA_LONG * 2;

async function configurePackageManagerCache(userDataDir: string) {
  const npmCacheDir = path.join(userDataDir, "npm-cache");
  const pnpmStoreDir = path.join(userDataDir, "pnpm-store");

  await fs.mkdir(npmCacheDir, { recursive: true });
  await fs.mkdir(pnpmStoreDir, { recursive: true });

  process.env.npm_config_cache = npmCacheDir;
  process.env.npm_config_store_dir = pnpmStoreDir;
  process.env.pnpm_config_store_dir = pnpmStoreDir;
}

async function createOldPnpmShim(userDataDir: string) {
  const fakeBinDir = path.join(userDataDir, "fake-old-pnpm-bin");
  const pnpmPath = path.join(fakeBinDir, "pnpm");
  const systemPnpmPath = execFileSync("which", ["pnpm"], {
    encoding: "utf8",
  }).trim();

  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(
    pnpmPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      '  echo "10.15.0"',
      "  exit 0",
      "fi",
      `exec "${systemPnpmPath}" "$@"`,
      "",
    ].join("\n"),
  );
  await fs.chmod(pnpmPath, 0o755);
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
}

async function createUpgradeablePnpmShim(userDataDir: string) {
  const fakeBinDir = path.join(userDataDir, "upgradeable-pnpm-bin");
  const pnpmPath = path.join(fakeBinDir, "pnpm");
  const systemPnpmPath = execFileSync("which", ["pnpm"], {
    encoding: "utf8",
  }).trim();

  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(
    pnpmPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      '  echo "${DYAD_TEST_PNPM_VERSION:-10.15.0}"',
      "  exit 0",
      "fi",
      `exec "${systemPnpmPath}" "$@"`,
      "",
    ].join("\n"),
  );
  await fs.chmod(pnpmPath, 0o755);
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
}

async function createSupportedPnpmShim(userDataDir: string) {
  const fakeBinDir = path.join(userDataDir, "supported-pnpm-bin");
  const pnpmPath = path.join(fakeBinDir, "pnpm");
  const systemPnpmPath = execFileSync("which", ["pnpm"], {
    encoding: "utf8",
  }).trim();

  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(
    pnpmPath,
    ["#!/bin/sh", `exec "${systemPnpmPath}" "$@"`, ""].join("\n"),
  );
  await fs.chmod(pnpmPath, 0o755);
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
}

function warmSocketFirewallCache() {
  const maxAttempts = process.env.CI ? 8 : 5;
  const warmupEnv = {
    ...process.env,
    npm_config_store_dir: undefined,
    pnpm_config_store_dir: undefined,
  };
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execFileSync(
        "npx",
        ["--prefer-offline", "--yes", "sfw@2.0.4", "--help"],
        {
          encoding: "utf8",
          env: warmupEnv,
          timeout: 120_000,
        },
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        attempt * 5_000,
      );
    }
  }

  throw lastError;
}

async function restorePackageManagerCache() {
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

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  if (originalTestPnpmVersion === undefined) {
    delete process.env.DYAD_TEST_PNPM_VERSION;
  } else {
    process.env.DYAD_TEST_PNPM_VERSION = originalTestPnpmVersion;
  }

  if (originalTestInstallPnpmVersion === undefined) {
    delete process.env.DYAD_TEST_INSTALL_PNPM_VERSION;
  } else {
    process.env.DYAD_TEST_INSTALL_PNPM_VERSION = originalTestInstallPnpmVersion;
  }

  if (originalDefaultApproveBuildsUrl === undefined) {
    delete process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL;
  } else {
    process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL =
      originalDefaultApproveBuildsUrl;
  }
}

const testSkipIfWindows = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ userDataDir, fakeLlmPort }) => {
    await configurePackageManagerCache(userDataDir);
    await createSupportedPnpmShim(userDataDir);
    process.env.DYAD_TEST_PNPM_VERSION = "11.1.2";
    process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL = `http://localhost:${fakeLlmPort}/api/default-approve-builds.txt`;
    warmSocketFirewallCache();
  },
  postLaunchHook: restorePackageManagerCache,
});

const oldPnpmTestSkipIfWindows = testWithConfigSkipIfWindows({
  showPnpmMinimumReleaseAgeWarning: true,
  preLaunchHook: async ({ userDataDir, fakeLlmPort }) => {
    await configurePackageManagerCache(userDataDir);
    await createOldPnpmShim(userDataDir);
    process.env.DYAD_TEST_PNPM_VERSION = "10.15.0";
    process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL = `http://localhost:${fakeLlmPort}/api/default-approve-builds.txt`;
  },
  postLaunchHook: restorePackageManagerCache,
});

const upgradePnpmTestSkipIfWindows = testWithConfigSkipIfWindows({
  showPnpmMinimumReleaseAgeWarning: true,
  preLaunchHook: async ({ userDataDir, fakeLlmPort }) => {
    await configurePackageManagerCache(userDataDir);
    await createUpgradeablePnpmShim(userDataDir);
    process.env.DYAD_TEST_PNPM_VERSION = "10.15.0";
    process.env.DYAD_TEST_INSTALL_PNPM_VERSION = "11.1.2";
    process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL = `http://localhost:${fakeLlmPort}/api/default-approve-builds.txt`;
  },
  postLaunchHook: restorePackageManagerCache,
});

const realPnpmStrictBuildsTestSkipIfWindows = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ userDataDir, fakeLlmPort }) => {
    execFileSync("pnpm", ["--version"], { encoding: "utf8" });
    await configurePackageManagerCache(userDataDir);
    process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL = `http://localhost:${fakeLlmPort}/api/default-approve-builds.txt`;
  },
  postLaunchHook: restorePackageManagerCache,
});

async function openMinimalBuildChat(po: PageObject) {
  await po.setUp();
  await po.page.evaluate(
    async (nodeBinDir) => {
      await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
        customNodePath: nodeBinDir,
      });
      await (window as any).electron.ipcRenderer.invoke(
        "reload-env-path",
        undefined,
      );
    },
    path.join(po.userDataDir, "supported-pnpm-bin"),
  );

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
    appPath,
    packageJsonPath: path.join(appPath, "package.json"),
    pnpmLockPath: path.join(appPath, "pnpm-lock.yaml"),
    pnpmWorkspacePath: path.join(appPath, "pnpm-workspace.yaml"),
  };
}

async function getCurrentAppId(po: PageObject): Promise<number> {
  const appPath = await po.appManagement.getCurrentAppPath();
  const currentAppName = await po.appManagement.getCurrentAppName();
  const apps = await po.page.evaluate(async () => {
    return (window as any).electron.ipcRenderer.invoke("list-apps", undefined);
  });
  const matchingApp = apps.apps.find(
    (app: { id: number; name: string; resolvedPath?: string }) =>
      app.resolvedPath === appPath || app.name === currentAppName,
  );
  if (!matchingApp) {
    throw new Error(`Could not find current app ${currentAppName}`);
  }
  return matchingApp.id;
}

async function addLocalDependencyWithIgnoredBuild(appPath: string) {
  const dependencyDir = path.join(appPath, "packages", "fake-build-dep");
  await fs.mkdir(dependencyDir, { recursive: true });
  await fs.writeFile(
    path.join(dependencyDir, "package.json"),
    `${JSON.stringify(
      {
        name: "fake-build-dep",
        version: "1.0.0",
        scripts: {
          postinstall: "node postinstall.js",
        },
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(dependencyDir, "postinstall.js"),
    [
      'require("node:fs").writeFileSync(',
      '  require("node:path").join(__dirname, "postinstall-ran.txt"),',
      '  "yes",',
      ");",
      "",
    ].join("\n"),
  );

  const packageJsonPath = path.join(appPath, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  packageJson.dependencies = {
    ...packageJson.dependencies,
    "fake-build-dep": "file:./packages/fake-build-dep",
  };
  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

function extendSocketFirewallTestTimeout(testInfo: TestInfo) {
  testInfo.setTimeout(SOCKET_FIREWALL_TEST_TIMEOUT);
}

async function clickApproveProposal(po: PageObject) {
  const approveButton = po.page.getByTestId("approve-proposal-button").last();
  await expect(approveButton).toBeEnabled({ timeout: Timeout.MEDIUM });
  await approveButton.click();
  await expect(approveButton).toBeDisabled({ timeout: Timeout.MEDIUM });
}

testSkipIfWindows(
  "build mode - safe npm package installs through the real socket firewall path",
  async ({ po }, testInfo) => {
    extendSocketFirewallTestTimeout(testInfo);

    const { packageJsonPath, pnpmLockPath, pnpmWorkspacePath } =
      await openMinimalBuildChat(po);
    const initialPackageJson = await fs.readFile(packageJsonPath, "utf8");
    const initialPnpmLock = await fs.readFile(pnpmLockPath, "utf8");
    await fs.rm(pnpmWorkspacePath, { force: true });

    await po.sendPrompt("tc=add-safe-dependency");
    await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible({
      timeout: Timeout.LONG,
    });

    await clickApproveProposal(po);
    await expect(async () => {
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, "utf8"),
      );
      expect(packageJson.dependencies?.lodash).toEqual(expect.any(String));
      expect(await fs.readFile(pnpmLockPath, "utf8")).not.toBe(initialPnpmLock);
    }).toPass({
      timeout: Timeout.EXTRA_LONG,
    });
    const pnpmWorkspaceConfig = await fs.readFile(pnpmWorkspacePath, "utf8");
    expect(pnpmWorkspaceConfig).toContain("minimumReleaseAge: 1440");
    expect(pnpmWorkspaceConfig).toContain("# dyad-default-allow-builds begin");
    expect(pnpmWorkspaceConfig).toContain(
      "# dyad-default-allow-builds-schema=v1",
    );
    expect(pnpmWorkspaceConfig).toContain(
      "# dyad-default-allow-builds-data-version=2026-05-21.2",
    );
    expect(pnpmWorkspaceConfig).toContain(
      "# dyad-default-allow-builds-channel=remote",
    );
    expect(pnpmWorkspaceConfig).toContain("# dyad-default-allow-builds end");

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
  async ({ po }, testInfo) => {
    extendSocketFirewallTestTimeout(testInfo);

    const { packageJsonPath, pnpmLockPath } = await openMinimalBuildChat(po);
    const initialPackageJson = await fs.readFile(packageJsonPath, "utf8");
    const initialPnpmLock = await fs.readFile(pnpmLockPath, "utf8");

    await po.sendPrompt("tc=add-unsafe-dependency");
    await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible({
      timeout: Timeout.LONG,
    });

    await clickApproveProposal(po);

    const errorCard = po.page.getByRole("button", {
      name: /Failed to add dependencies: axois\./i,
    });
    await expect(errorCard).toBeVisible({
      timeout: SOCKET_FIREWALL_VERDICT_TIMEOUT,
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

oldPnpmTestSkipIfWindows(
  "app run uses old pnpm and dismisses the pnpm minimum release age warning for the session",
  async ({ po }, testInfo) => {
    testInfo.setTimeout(SOCKET_FIREWALL_TEST_TIMEOUT);

    await po.setUp();
    const fakeOldPnpmBinDir = path.join(po.userDataDir, "fake-old-pnpm-bin");
    await po.page.evaluate(async (nodeBinDir) => {
      await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
        customNodePath: nodeBinDir,
      });
      await (window as any).electron.ipcRenderer.invoke(
        "reload-env-path",
        undefined,
      );
    }, fakeOldPnpmBinDir);

    await po.importApp("minimal");

    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );
    const appPath = await po.appManagement.getCurrentAppPath();
    await expect(async () => {
      await expect(
        fs.stat(path.join(appPath, "pnpm-workspace.yaml")),
      ).resolves.toBeTruthy();
    }).toPass({ timeout: Timeout.EXTRA_LONG });

    await po.clickRestart();
    await expect(po.previewPanel.locateLoadingAppPreview()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    const warningBanner = po.page.getByTestId("package-manager-warning-banner");
    await expect(warningBanner).toContainText("Install pnpm 10.16.0 or newer", {
      timeout: Timeout.EXTRA_LONG,
    });
    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );

    await warningBanner
      .getByRole("button", { name: "Dismiss pnpm warning" })
      .click();
    await expect(warningBanner).toBeHidden({ timeout: Timeout.MEDIUM });
    await expect(async () => {
      const settings = await po.page.evaluate(async () => {
        return (window as any).electron.ipcRenderer.invoke(
          "get-user-settings",
          undefined,
        );
      });
      expect(settings.hidePnpmMinimumReleaseAgeWarning).not.toBe(true);
    }).toPass({ timeout: Timeout.MEDIUM });

    await po.clickRestart();
    await expect(po.previewPanel.locateLoadingAppPreview()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );
    await expect(warningBanner).toBeHidden({ timeout: Timeout.MEDIUM });
  },
);

upgradePnpmTestSkipIfWindows(
  "install pnpm action upgrades pnpm and rebuilds the app",
  async ({ po }, testInfo) => {
    testInfo.setTimeout(SOCKET_FIREWALL_TEST_TIMEOUT);

    await po.setUp();
    const upgradeablePnpmBinDir = path.join(
      po.userDataDir,
      "upgradeable-pnpm-bin",
    );
    await po.page.evaluate(async (nodeBinDir) => {
      await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
        customNodePath: nodeBinDir,
      });
      await (window as any).electron.ipcRenderer.invoke(
        "reload-env-path",
        undefined,
      );
    }, upgradeablePnpmBinDir);

    await po.importApp("minimal");
    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );

    const warningBanner = po.page.getByTestId("package-manager-warning-banner");
    await expect(warningBanner).toContainText("Install pnpm 10.16.0 or newer", {
      timeout: Timeout.EXTRA_LONG,
    });

    await warningBanner.getByRole("button", { name: "Install" }).click();
    const logList = po.previewPanel.locatePreviewLoadingLogList();
    await expect(
      logList.getByText("Rebuilding app after pnpm install..."),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });
    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );
    await expect(warningBanner).toBeHidden({ timeout: Timeout.EXTRA_LONG });

    const appPath = await po.appManagement.getCurrentAppPath();
    await expect(async () => {
      await expect(
        fs.stat(path.join(appPath, "pnpm-workspace.yaml")),
      ).resolves.toBeTruthy();
    }).toPass({ timeout: Timeout.EXTRA_LONG });

    await po.clickRestart();
    await expect(po.previewPanel.locateLoadingAppPreview()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
    await expect(warningBanner).toBeHidden({ timeout: Timeout.MEDIUM });
  },
);

realPnpmStrictBuildsTestSkipIfWindows(
  "custom pnpm install auto-denies ignored builds and recovers preview",
  async ({ po }, testInfo) => {
    testInfo.setTimeout(SOCKET_FIREWALL_TEST_TIMEOUT);

    await po.setUp();
    await po.importApp("minimal");
    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );

    const appPath = await po.appManagement.getCurrentAppPath();
    const appId = await getCurrentAppId(po);
    await addLocalDependencyWithIgnoredBuild(appPath);

    await po.page.evaluate(
      async ({ appId }) => {
        await (window as any).electron.ipcRenderer.invoke(
          "update-app-commands",
          {
            appId,
            installCommand:
              "pnpm --config.strictDepBuilds=true install --no-frozen-lockfile",
            startCommand: "pnpm run dev -- --host 127.0.0.1",
          },
        );
      },
      { appId },
    );

    await po.previewPanel.clickRebuild();
    await expect(po.previewPanel.locateLoadingAppPreview()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.previewPanel.expectPreviewIframeIsVisible(
      SOCKET_FIREWALL_TEST_TIMEOUT,
    );

    const pnpmWorkspaceConfig = await fs.readFile(
      path.join(appPath, "pnpm-workspace.yaml"),
      "utf8",
    );
    expect(pnpmWorkspaceConfig).toContain(
      "fake-build-dep: false # dyad-auto-denied",
    );
    await expect(async () => {
      const modulesConfig = await fs.readFile(
        path.join(appPath, "node_modules", ".modules.yaml"),
        "utf8",
      );
      expect(modulesConfig).not.toContain(
        "fake-build-dep@file:packages/fake-build-dep",
      );
    }).toPass({ timeout: Timeout.EXTRA_LONG });
  },
);
