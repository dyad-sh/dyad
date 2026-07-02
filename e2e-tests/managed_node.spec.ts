import { expect } from "@playwright/test";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { testWithConfigSkipIfWindows, Timeout } from "./helpers/test_helper";

const MANAGED_NODE_VERSION = "v24.18.0";

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
      `case " $* " in *" --version "*) echo "${MANAGED_NODE_VERSION}"; exit 0;; esac`,
      `exec "${process.execPath.replace(/"/g, '\\"')}" "$@"`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(nodePath, 0o755);

  const pnpmPath = path.join(binDir, "pnpm");
  fs.writeFileSync(
    pnpmPath,
    [
      "#!/bin/sh",
      'previous=""',
      'for arg in "$@"; do',
      '  if [ "$arg" = "--version" ]; then echo "10.15.0"; exit 0; fi',
      '  if [ "$arg" = "install" ]; then echo "Already up to date"; exit 0; fi',
      '  if [ "$previous" = "run" ] && [ "$arg" = "dev" ]; then',
      `  exec "${process.execPath.replace(/"/g, '\\"')}" -e "const http=require('http');const server=http.createServer((_req,res)=>res.end('managed node ok'));server.listen(0,()=>console.log('http://localhost:'+server.address().port));"`,
      "  fi",
      '  previous="$arg"',
      "done",
      'echo "Unsupported fake pnpm command: $@" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  fs.chmodSync(pnpmPath, 0o755);

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

test("managed Node auto-installs from the preview setup card and starts the app", async ({
  po,
}) => {
  await po.setUp();
  await po.setNodeMock(false);

  await po.sendPrompt("tc=1");
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
