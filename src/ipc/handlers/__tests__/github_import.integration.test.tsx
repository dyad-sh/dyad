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
import { writeSettings } from "@/main/settings";
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

  it("skips the tagger upgrade when 'Optimize for Dyad' is unchecked", async () => {
    await harness.github.resetRepos();
    writeSettings({
      githubAccessToken: { value: "fake_access_token_12345" },
      githubUser: {
        email: "testuser@example.com",
      },
    });
    await mountImportDialog();

    clickTab("Your GitHub Repos");

    const repoRow = await screen.findByTestId(
      "github-repo-row-testuser-existing-vite-app",
      {},
      { timeout: 20_000 },
    );

    // A distinct app name so this import doesn't collide with the default-upgrade
    // test's "existing-vite-app" row; the repo cloned is still the same one.
    fireEvent.change(screen.getByPlaceholderText(/Leave empty/), {
      target: { value: "no-optimize-vite-app" },
    });

    // Reveal the advanced options so the "Optimize for Dyad" checkbox mounts,
    // then uncheck it (it defaults to checked).
    fireEvent.click(screen.getByRole("button", { name: "Advanced options" }));
    const optimizeCheckbox = await screen.findByRole("checkbox");
    expect(optimizeCheckbox.getAttribute("aria-checked")).toBe("true");
    await harness.setSwitch(optimizeCheckbox, false);

    fireEvent.click(within(repoRow).getByRole("button", { name: "Import" }));

    await waitForDialogClosed();
    const app = await findImportedApp("no-optimize-vite-app");
    const appDir = importedAppPath(app.path);

    // The inverse of the default-upgrade test: no component-tagger rewrite.
    const config = fs.readFileSync(path.join(appDir, "vite.config.ts"), "utf8");
    expect(config).not.toContain("dyadComponentTagger");

    const pkg = fs.readFileSync(path.join(appDir, "package.json"), "utf8");
    expect(pkg).not.toContain("@dyad-sh/react-vite-component-tagger");
  }, 90_000);

  it("requires both custom commands before enabling import", async () => {
    await mountImportDialog();

    clickTab("GitHub URL");
    const urlPanel = await screen.findByLabelText("GitHub URL");
    fireEvent.change(
      within(urlPanel).getByPlaceholderText("https://github.com/user/repo.git"),
      {
        target: { value: "https://github.com/testuser/existing-vite-app.git" },
      },
    );

    fireEvent.click(
      within(urlPanel).getByRole("button", { name: "Advanced options" }),
    );

    // Fill ONLY the install command, leaving the start command empty.
    fireEvent.change(within(urlPanel).getByPlaceholderText("pnpm install"), {
      target: { value: "npm install" },
    });

    // The validation message appears and the Import button is disabled while
    // only one of the two commands is set.
    await waitFor(() =>
      expect(
        within(urlPanel).getByText(
          /Both commands are required when customizing/,
        ),
      ).toBeTruthy(),
    );
    const importButton = within(urlPanel).getByRole("button", {
      name: /^Import$/,
    }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);

    // Filling the second command clears the error and re-enables Import.
    fireEvent.change(within(urlPanel).getByPlaceholderText("pnpm dev"), {
      target: { value: "npm start" },
    });
    await waitFor(() =>
      expect(
        within(urlPanel).queryByText(
          /Both commands are required when customizing/,
        ),
      ).toBeNull(),
    );
    expect(importButton.disabled).toBe(false);
  }, 60_000);
});
