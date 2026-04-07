import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { testWithConfigSkipIfWindows, Timeout } from "./helpers/test_helper";

const originalPath = process.env.PATH ?? "";
let fakeSfwLogPath = "";

const testWithFakeSocketFirewall = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ userDataDir }) => {
    const fakeBinDir = path.join(userDataDir, "fake-bin");
    fakeSfwLogPath = path.join(userDataDir, "sfw-invocations.log");
    const fakeSfwPath = path.join(fakeBinDir, "sfw");

    await fs.mkdir(fakeBinDir, { recursive: true });
    await fs.writeFile(
      fakeSfwPath,
      `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(fakeSfwLogPath)}, JSON.stringify(args) + "\\n");

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("Socket Firewall test stub\\n");
  process.exit(0);
}

if (args.includes("lodahs")) {
  const details = [
    "Socket Firewall blocked lodahs",
    "Package \\"lodahs\\" is typosquatting lodash.",
    "Reason: malicious package detected."
  ].join("\\n");
  process.stderr.write(details);
  process.exit(1);
}

process.exit(0);
`,
      { mode: 0o755 },
    );
    await fs.chmod(fakeSfwPath, 0o755);
    process.env.PATH = `${fakeBinDir}:${originalPath}`;
  },
  postLaunchHook: async () => {
    process.env.PATH = originalPath;
  },
});

testWithFakeSocketFirewall(
  "build mode - blocked unsafe npm package shows socket verdict and preserves app files",
  async ({ po }) => {
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
    const packageJsonPath = path.join(appPath, "package.json");
    const pnpmLockPath = path.join(appPath, "pnpm-lock.yaml");
    const initialPackageJson = await fs.readFile(packageJsonPath, "utf8");
    const initialPnpmLock = await fs.readFile(pnpmLockPath, "utf8");

    await po.sendPrompt("tc=add-unsafe-dependency");
    await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible();

    await po.approveProposal();

    const errorSummary =
      "Failed to add dependencies: lodahs. Socket Firewall blocked lodahs";
    await expect(po.page.getByText(errorSummary)).toBeVisible({
      timeout: Timeout.LONG,
    });

    await po.page.getByText(errorSummary).click();
    await expect(
      po.page.getByText('Package "lodahs" is typosquatting lodash.'),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(
      po.page.getByText("Reason: malicious package detected."),
    ).toBeVisible();

    expect(await fs.readFile(packageJsonPath, "utf8")).toBe(initialPackageJson);
    expect(await fs.readFile(pnpmLockPath, "utf8")).toBe(initialPnpmLock);

    const sfwInvocations = await fs.readFile(fakeSfwLogPath, "utf8");
    expect(sfwInvocations).toContain('["--help"]');
    expect(sfwInvocations).toContain('["pnpm","add","lodahs"]');
    expect(sfwInvocations).toContain(
      '["npm","install","--legacy-peer-deps","lodahs"]',
    );
  },
);
