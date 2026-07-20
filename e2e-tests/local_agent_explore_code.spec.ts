import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("local-agent - explore_code experiment", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enableCodeExplorer: false,
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().enableCodeExplorer)
    .toBe(false);

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request", { name: "disabled" });

  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enableCodeExplorer: true,
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().enableCodeExplorer)
    .toBe(true);

  await po.appManagement.ensurePnpmInstall();
  await po.appManagement.ensureCodeExplorerReady();
  const appPath = await po.appManagement.getCurrentAppPath();
  const nodeModulesPath = path.join(appPath, "node_modules");
  const typeScriptPackagePath = path.join(
    nodeModulesPath,
    "typescript",
    "package.json",
  );
  const typeScriptPackage = JSON.parse(
    fs.readFileSync(typeScriptPackagePath, "utf8"),
  );
  const typeScriptPackageDir = path.dirname(typeScriptPackagePath);
  const backupRoot = fs.mkdtempSync(
    path.join(nodeModulesPath, ".dyad-typescript-backup-"),
  );
  const backupPackageDir = path.join(backupRoot, "typescript");
  let packageMoved = false;
  try {
    // Replace the package (which may be a pnpm store symlink) with an isolated
    // stub instead of mutating shared package-manager state.
    fs.renameSync(typeScriptPackageDir, backupPackageDir);
    packageMoved = true;
    fs.mkdirSync(typeScriptPackageDir);
    // Mimic TS7's installed-package shape: package metadata and CLI are
    // available, but the legacy CommonJS compiler API has no root export.
    fs.writeFileSync(
      typeScriptPackagePath,
      JSON.stringify({
        ...typeScriptPackage,
        version: "7.0.0-test",
        exports: { "./package.json": "./package.json" },
      }),
    );
    await po.chatActions.clickNewChat();
    await po.chatActions.selectLocalAgentMode();
    await po.sendPrompt("tc=local-agent/explore-code");

    const card = po.page.getByTestId("dyad-explore-code");
    await expect(card).toBeVisible({ timeout: Timeout.LONG });
    await card.click();
    await expect(card).toContainText("explore_code report");
    await expect(card).toContainText("src/App.tsx");
    await expect(card).toContainText("compiler-backed symbol window");
    await expect(card).toContainText("Read targets");

    await po.snapshotMessages();
  } finally {
    fs.rmSync(typeScriptPackageDir, { recursive: true, force: true });
    if (packageMoved) {
      fs.renameSync(backupPackageDir, typeScriptPackageDir);
    }
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
});
