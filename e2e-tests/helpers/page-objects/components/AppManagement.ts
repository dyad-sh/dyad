/**
 * Page object for app management functionality.
 * Handles app selection, importing, renaming, and app-related operations.
 */

import { Page, expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import { ElectronApplication } from "playwright";
import path from "path";
import { execSync, execFileSync } from "child_process";
import { Timeout } from "../../constants";

export class AppManagement {
  constructor(
    public page: Page,
    private electronApp: ElectronApplication,
    private userDataDir: string,
  ) {}

  getTitleBarAppNameButton() {
    return this.page.getByTestId("title-bar-app-name-button");
  }

  getAppListItem({ appName }: { appName: string }) {
    return this.page.getByTestId(`app-list-item-${appName}`);
  }

  async isCurrentAppNameNone() {
    await expect(async () => {
      await expect(this.getTitleBarAppNameButton()).toContainText(
        "no app selected",
      );
    }).toPass();
  }

  async getCurrentAppName() {
    // Make sure to wait for the app to be set to avoid a race condition.
    await expect(async () => {
      await expect(this.getTitleBarAppNameButton()).not.toContainText(
        "no app selected",
      );
    }).toPass();
    return (await this.getTitleBarAppNameButton().textContent())?.replace(
      "App: ",
      "",
    );
  }

  async getCurrentAppPath() {
    const currentAppName = await this.getCurrentAppName();
    if (!currentAppName) {
      throw new Error("No current app name found");
    }
    return this.getAppPath({ appName: currentAppName });
  }

  getAppPath({ appName }: { appName: string }) {
    return path.join(this.userDataDir, "coney-apps", appName);
  }

  async clickAppListItem({ appName }: { appName: string }) {
    await this.page.getByTestId(`app-list-item-${appName}`).click();
  }

  async clickOpenInChatButton() {
    await this.page.getByRole("button", { name: "Open in Chat" }).click();
  }

  locateAppUpgradeButton({ upgradeId }: { upgradeId: string }) {
    return this.page.getByTestId(`app-upgrade-${upgradeId}`);
  }

  async clickAppUpgradeButton({ upgradeId }: { upgradeId: string }) {
    await this.locateAppUpgradeButton({ upgradeId }).click();
  }

  async expectAppUpgradeButtonIsNotVisible({
    upgradeId,
  }: {
    upgradeId: string;
  }) {
    await expect(this.locateAppUpgradeButton({ upgradeId })).toBeHidden({
      timeout: Timeout.MEDIUM,
    });
  }

  async expectNoAppUpgrades() {
    await expect(this.page.getByTestId("no-app-upgrades-needed")).toBeVisible({
      timeout: Timeout.LONG,
    });
  }

  async clickAppDetailsRenameAppButton() {
    await this.page.getByTestId("app-details-rename-app-button").click();
  }

  async clickAppDetailsMoreOptions() {
    await this.page.getByTestId("app-details-more-options-button").click();
  }

  async clickAppDetailsCopyAppButton() {
    await this.page.getByRole("button", { name: "Copy app" }).click();
  }

  async clickConnectSupabaseButton() {
    await this.page.getByTestId("connect-supabase-button").click();
  }

  async importApp(appDir: string) {
    await this.page.getByRole("button", { name: "Import App" }).click();
    await eph.stubDialog(this.electronApp, "showOpenDialog", {
      filePaths: [
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "fixtures",
          "import-app",
          appDir,
        ),
      ],
    });
    await this.page.getByRole("button", { name: "Select Folder" }).click();
    await this.page.getByRole("button", { name: "Import" }).click();
  }

  async configureGitUser({
    email = "test@example.com",
    name = "Test User",
    disableGpgSign = true,
  }: {
    email?: string;
    name?: string;
    disableGpgSign?: boolean;
  } = {}) {
    const appPath = await this.getCurrentAppPath();
    if (!appPath) {
      throw new Error("App path not found");
    }

    execFileSync("git", ["config", "user.email", email], { cwd: appPath });
    execFileSync("git", ["config", "user.name", name], { cwd: appPath });
    if (disableGpgSign) {
      execSync("git config commit.gpgsign false", { cwd: appPath });
    }
  }

  async ensurePnpmInstall() {
    const appPath = await this.getCurrentAppPath();
    if (!appPath) {
      throw new Error("No app selected");
    }

    const maxDurationMs = 180_000; // 3 minutes
    const retryIntervalMs = 15_000;
    const startTime = Date.now();
    let lastOutput = "";

    const checkCommand = `node -e 'const pkg=require("./package.json");const{execSync}=require("child_process");try{const prodResult=JSON.parse(execSync("pnpm list --json --depth=0",{encoding:"utf8"}));const devResult=JSON.parse(execSync("pnpm list --json --depth=0 --dev",{encoding:"utf8"}));const installed={...(prodResult[0]||{}).dependencies||{},...(devResult[0]||{}).devDependencies||{}};const expected=Object.keys({...pkg.dependencies||{},...pkg.devDependencies||{}});const missing=expected.filter(dep=>!installed[dep]);console.log(missing.length?"MISSING: "+missing.join(", "):"All dependencies installed")}catch(e){console.log("Error:",e.message)}'`;

    while (Date.now() - startTime < maxDurationMs) {
      try {
        console.log(`Checking installed dependencies in ${appPath}...`);
        const stdout = execSync(checkCommand, {
          cwd: appPath,
          stdio: "pipe",
          encoding: "utf8",
        });
        lastOutput = (stdout || "").toString().trim();
        console.log(`Dependency check output: ${lastOutput}`);
        if (lastOutput.includes("All dependencies installed")) {
          return;
        }
      } catch (error: any) {
        // Capture any error output to include in the final error if we time out
        const stdOut = error?.stdout ? error.stdout.toString() : "";
        const stdErr = error?.stderr ? error.stderr.toString() : "";
        lastOutput = [stdOut, stdErr, error?.message]
          .filter(Boolean)
          .join("\n");
        console.error("Dependency check command failed:", lastOutput);
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, maxDurationMs - elapsed);
      const waitMs = Math.min(retryIntervalMs, remaining);
      if (waitMs <= 0) break;
      console.log(`Waiting ${waitMs}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    throw new Error(
      `Dependencies not fully installed in ${appPath} after 3 minutes. Last output: ${lastOutput}`,
    );
  }
}
