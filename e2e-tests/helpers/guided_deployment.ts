import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { testWithConfig } from "./fixtures";
import { Timeout } from "./constants";
import type { PageObject } from "./page-objects/PageObject";

export const test = testWithConfig({
  testTimeout: 180_000,
  preLaunchHook: async ({ userDataDir }) => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({
        enableCloudflareDeployment: true,
        neon: {
          accessToken: { value: "fake-neon-token" },
          refreshToken: { value: "fake-neon-refresh" },
          expiresIn: 3600,
          tokenTimestamp: Math.floor(Date.now() / 1000),
        },
      }),
    );
  },
});

export async function prepareDeploymentApp(po: PageObject) {
  const entryUrl = po.page.url();
  await po.setUp({ autoApprove: true });
  await po.githubConnector.resetRepos();
  const response = await po.page.request.post(
    `http://localhost:${po.githubConnector.fakeLlmPort}/cloudflare/test/reset`,
  );
  expect(response.ok()).toBe(true);
  // Reuse a small app fixture; deployment does not need an LLM-generated app.
  await po.importApp("recorder");
  await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
  const appDir = await po.appManagement.getCurrentAppPath();
  await fs.mkdir(path.join(appDir, "worker"), { recursive: true });
  await fs.writeFile(
    path.join(appDir, "worker", "wrangler.jsonc"),
    JSON.stringify({
      name: "guided-worker",
      main: "index.ts",
      compatibility_date: "2026-01-01",
    }),
  );
  await fs.writeFile(
    path.join(appDir, "worker", "index.ts"),
    'export default { fetch() { return new Response("hello"); } };\n',
  );
  const appName = await po.appManagement.getCurrentAppName();
  await po.page.evaluate(async (name) => {
    await (window as any).electron.ipcRenderer.invoke(
      "test:set-neon-auth-fixture",
      { appName: name },
    );
  }, appName);
  // Reload the actual packaged entry point to clear the renderer's app cache
  // after the test-only database write (a file:// chat route cannot reload).
  await po.page.goto(entryUrl);
  await po.page.waitForLoadState("domcontentloaded");
  await po.navigation.goToChatTab();
  await expect(po.page.getByTestId("deploy-button")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  return appDir;
}

// Hold one real IPC request in the main process so loading cannot race past
// the assertions. Restore the handler immediately so Cancel can start a fresh
// review. No renderer methods or production test hooks are replaced.
export async function holdNextMigrationPreview(po: PageObject) {
  const request = await po.electronApp.evaluateHandle(({ ipcMain }) => {
    const channel = "migration:preview";
    type Handler = Parameters<typeof ipcMain.handle>[1];
    // Electron keeps invoke listeners in this registry; fail explicitly if
    // an Electron upgrade changes it rather than silently bypassing the test.
    const handlers = (
      ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers;
    const original = handlers?.get(channel);
    if (!original)
      throw new Error("Migration preview handler is not registered");
    let release!: (error: string | null) => void;
    const gate = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, params) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, original);
      try {
        const error = await gate;
        if (error) throw new Error(error);
        return await original(event, params);
      } finally {
        finish();
      }
    });
    return { release, settled };
  });
  return async (error: string | null = null) => {
    await request.evaluate(async (pending, error) => {
      pending.release(error);
      await pending.settled;
    }, error);
    await request.dispose();
  };
}

export async function writeDeploymentUpdate(
  appDir: string,
  fileName: string,
  content: string,
) {
  await fs.writeFile(path.join(appDir, "worker", fileName), content);
}

export function readCommittedDeploymentUpdate(
  appDir: string,
  fileName: string,
) {
  return execFileSync("git", ["show", "HEAD:worker/" + fileName], {
    cwd: appDir,
    encoding: "utf8",
  });
}
