import { expect } from "@playwright/test";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { testWithConfigSkipIfWindows, Timeout } from "./helpers/test_helper";

const MANAGED_NODE_VERSION = "v22.22.3";

function createManagedNodeFixtureArchive(userDataDir: string) {
  const fixtureDir = path.join(userDataDir, "managed-node-fixture");
  const rootDir = path.join(
    fixtureDir,
    `node-${MANAGED_NODE_VERSION}-${process.platform}-${os.arch()}`,
  );
  const binDir = path.join(rootDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const nodePath = path.join(binDir, "node");
  fs.writeFileSync(
    nodePath,
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo "${MANAGED_NODE_VERSION}"; exit 0; fi`,
      `exec "${process.execPath.replace(/"/g, '\\"')}" "$@"`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(nodePath, 0o755);

  const archivePath = path.join(fixtureDir, "managed-node.tar.gz");
  execFileSync("tar", [
    "-czf",
    archivePath,
    "-C",
    fixtureDir,
    path.basename(rootDir),
  ]);
  const sha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(archivePath))
    .digest("hex");

  process.env.DYAD_TEST_MANAGED_NODE_ARCHIVE_URL =
    pathToFileURL(archivePath).toString();
  process.env.DYAD_TEST_MANAGED_NODE_SHA256 = sha256;
}

const test = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ userDataDir }) => {
    createManagedNodeFixtureArchive(userDataDir);
  },
  postLaunchHook: async () => {
    delete process.env.DYAD_TEST_MANAGED_NODE_ARCHIVE_URL;
    delete process.env.DYAD_TEST_MANAGED_NODE_SHA256;
  },
});

test("managed Node installs from the preview setup card and starts the app", async ({
  po,
}) => {
  await po.setUp();
  await po.setNodeMock(false);

  await po.sendPrompt("tc=1");
  await expect(
    po.page.getByText("Install Node.js to see your preview"),
  ).toBeVisible({ timeout: Timeout.LONG });

  const appId = await po.page.evaluate(async () => {
    const response = await (window as any).electron.ipcRenderer.invoke(
      "list-apps",
    );
    return (response.value?.apps ?? response.apps)[0].id;
  });
  await po.page.evaluate(async (appId) => {
    await (window as any).electron.ipcRenderer.invoke("update-app-commands", {
      appId,
      installCommand: "node --version",
      startCommand: `node -e "const port=${32100 + (appId % 10_000)}; require('http').createServer((_req,res)=>res.end('managed node ok')).listen(port,()=>console.log('http://localhost:'+port))"`,
    });
  }, appId);

  await po.page
    .getByRole("button", { name: "Install Node.js for me (~30 MB)" })
    .click();

  await expect(po.page.getByText("Installing Node.js")).toBeVisible();
  await expect
    .poll(() => po.settings.recordSettings().nodeRuntimePreference, {
      timeout: Timeout.LONG,
    })
    .toBe("managed");

  await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
  await expect(
    po.previewPanel.getPreviewIframeElement().contentFrame().locator("body"),
  ).toContainText("managed node ok", { timeout: Timeout.EXTRA_LONG });
});

test("managed Node exposes install, preference, and removal controls in Settings", async ({
  po,
}) => {
  await po.setUp();
  await po.setNodeMock(false);
  await po.navigation.goToSettingsTab();
  const runtimeSettings = po.page.getByTestId("node-runtime-settings");

  await expect(
    runtimeSettings.getByText("No usable Node.js found"),
  ).toBeVisible({
    timeout: Timeout.LONG,
  });

  await runtimeSettings
    .getByRole("button", { name: "Install managed Node.js" })
    .click();
  await expect
    .poll(() => po.settings.recordSettings().nodeRuntimePreference, {
      timeout: Timeout.LONG,
    })
    .toBe("managed");
  await expect(runtimeSettings.getByText(/Dyad-managed/)).toBeVisible({
    timeout: Timeout.LONG,
  });

  await runtimeSettings
    .getByRole("button", { name: "System", exact: true })
    .click();
  await expect
    .poll(() => po.settings.recordSettings().nodeRuntimePreference, {
      timeout: Timeout.MEDIUM,
    })
    .toBe("system");

  await runtimeSettings
    .getByRole("button", { name: "Managed", exact: true })
    .click();
  await expect
    .poll(() => po.settings.recordSettings().nodeRuntimePreference, {
      timeout: Timeout.MEDIUM,
    })
    .toBe("managed");

  await runtimeSettings
    .getByRole("button", { name: "Remove managed Node.js" })
    .click();
  await expect
    .poll(() => po.settings.recordSettings().nodeRuntimePreference, {
      timeout: Timeout.MEDIUM,
    })
    .toBe("system");
  await expect(
    runtimeSettings.getByRole("button", { name: "Install managed Node.js" }),
  ).toBeVisible();
});
