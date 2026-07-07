import fs from "node:fs";
import path from "node:path";

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { apps } from "@/db/schema";
import { readSettings, writeSettings } from "@/main/settings";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("GitHub import dialog (integration)", () => {
  let harness: HybridChatHarness;
  let importAppsRoot: string;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      settings: { isTestMode: true },
    });
    importAppsRoot = path.join(path.dirname(harness.appDir), "imported-apps");
    fs.mkdirSync(importAppsRoot, { recursive: true });
    writeSettings({ customAppsFolder: importAppsRoot });
    invalidateDyadAppsBaseDirectoryCache();
  }, 60_000);

  afterEach(() => {
    cleanup();
    writeSettings({
      githubAccessToken: undefined,
      githubUser: undefined,
    });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function mountImportDialog() {
    harness.mountSurface({ route: "/import-app" });
    return screen.findByRole("dialog", { name: "Import App" });
  }

  function getTabByText(text: string): HTMLElement {
    const tab = screen
      .getAllByRole("tab")
      .find((element) => element.textContent?.includes(text));
    if (!tab) {
      throw new Error(`Could not find tab containing text: ${text}`);
    }
    return tab;
  }

  function clickTab(text: string) {
    fireEvent.click(getTabByText(text));
  }

  function importedAppPath(appPath: string): string {
    return path.isAbsolute(appPath)
      ? appPath
      : path.join(importAppsRoot, appPath);
  }

  async function findImportedApp(name: string) {
    await waitFor(
      async () => {
        const row = await harness.db.query.apps.findFirst({
          where: eq(apps.name, name),
        });
        expect(row).toBeTruthy();
      },
      { timeout: 30_000 },
    );
    const row = await harness.db.query.apps.findFirst({
      where: eq(apps.name, name),
    });
    if (!row) {
      throw new Error(`Imported app not found: ${name}`);
    }
    return row;
  }

  async function waitForDialogClosed() {
    await waitFor(
      () => {
        expect(screen.queryByRole("dialog", { name: "Import App" })).toBeNull();
      },
      { timeout: 60_000 },
    );
  }

  it("imports a GitHub URL with advanced options", async () => {
    await harness.github.resetRepos();
    await mountImportDialog();

    expect(getTabByText("Local Folder")).toBeTruthy();
    expect(getTabByText("Your GitHub Repos")).toBeTruthy();
    expect(getTabByText("GitHub URL")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Folder" })).toBeTruthy();

    clickTab("GitHub URL");
    const urlPanel = await screen.findByLabelText("GitHub URL");
    fireEvent.change(
      within(urlPanel).getByPlaceholderText("https://github.com/user/repo.git"),
      {
        target: { value: "https://github.com/testuser/existing-vite-app.git" },
      },
    );
    fireEvent.change(within(urlPanel).getByPlaceholderText(/Leave empty/), {
      target: { value: "url-existing-vite-app" },
    });

    fireEvent.click(
      within(urlPanel).getByRole("button", { name: "Advanced options" }),
    );
    fireEvent.change(within(urlPanel).getByPlaceholderText("pnpm install"), {
      target: { value: "npm install" },
    });
    fireEvent.change(within(urlPanel).getByPlaceholderText("pnpm dev"), {
      target: { value: "npm start" },
    });

    fireEvent.click(within(urlPanel).getByRole("button", { name: /^Import$/ }));

    await waitForDialogClosed();
    const app = await findImportedApp("url-existing-vite-app");
    expect(app.installCommand).toBe("npm install");
    expect(app.startCommand).toBe("npm start");

    const appDir = importedAppPath(app.path);
    expect(
      fs.readFileSync(path.join(appDir, "package.json"), "utf8"),
    ).toContain('"name": "existing-vite-app"');
    expect(
      fs.readFileSync(path.join(appDir, "vite.config.ts"), "utf8"),
    ).toContain("defineConfig");
  }, 90_000);

  it("imports an authenticated repository list item with the default tagger upgrade", async () => {
    await harness.github.resetRepos();
    writeSettings({
      githubAccessToken: { value: "fake_access_token_12345" },
      githubUser: {
        email: "testuser@example.com",
      },
    });
    await mountImportDialog();

    clickTab("Your GitHub Repos");
    expect(readSettings().githubAccessToken?.value).toBe(
      "fake_access_token_12345",
    );

    const repoRow = await screen.findByTestId(
      "github-repo-row-testuser-existing-vite-app",
      {},
      { timeout: 20_000 },
    );
    expect(
      within(repoRow).getByText("testuser/existing-vite-app"),
    ).toBeTruthy();
    fireEvent.click(within(repoRow).getByRole("button", { name: "Import" }));

    await waitForDialogClosed();
    const app = await findImportedApp("existing-vite-app");
    const appDir = importedAppPath(app.path);
    const pkg = fs.readFileSync(path.join(appDir, "package.json"), "utf8");
    expect(pkg).toContain("@dyad-sh/react-vite-component-tagger");

    const config = fs.readFileSync(path.join(appDir, "vite.config.ts"), "utf8");
    expect(config).toContain(
      "import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';",
    );
    expect(config).toContain("dyadComponentTagger()");
  }, 90_000);
});
