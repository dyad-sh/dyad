import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { apps, chats } from "@/db/schema";
import { readSettings, writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

type TestApp = {
  appId: number;
  name: string;
  appDir: string;
};

const fixtureAppDir = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "import-app",
  "minimal",
);

function git(appDir: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test User",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: appDir, stdio: "pipe" },
  ).toString();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

describe("Git collaboration actions (integration)", () => {
  let harness: HybridChatHarness;
  let appCounter = 0;
  let appsRoot: string;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      settings: { isTestMode: true },
    });
    appsRoot = path.dirname(harness.appDir);
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

  async function createFixtureApp(baseName: string): Promise<TestApp> {
    appCounter += 1;
    const name = `${baseName}-${appCounter}`;
    const appDir = path.join(appsRoot, slug(name));
    fs.cpSync(fixtureAppDir, appDir, { recursive: true });
    git(appDir, "init");
    git(appDir, "add", "-A");
    git(appDir, "commit", "-m", "init");

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    await harness.db.insert(chats).values({ appId: appRow.id });
    return { appId: appRow.id, name, appDir };
  }

  async function mountAppDetails(app: TestApp) {
    harness.mountSurface({
      route: "/app-details",
      appId: app.appId,
      withTitleBar: true,
    });
    await screen.findByTestId("app-details-page");
    await screen.findByRole("heading", { name: app.name });
  }

  async function connectGitHub(app: TestApp) {
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect to GitHub" }),
    );

    await screen.findByText("FAKE-CODE");
    await screen.findByText("https://github.com/login/device");
    await waitFor(
      () => {
        expect(readSettings().githubAccessToken?.value).toBe(
          "fake_access_token_12345",
        );
      },
      { timeout: 15_000 },
    );

    cleanup();
    await mountAppDetails(app);
    await screen.findByTestId("github-setup-repo", {}, { timeout: 15_000 });
  }

  async function createRepoThroughConnector(repoName: string) {
    fireEvent.change(
      await screen.findByTestId("github-create-repo-name-input"),
      {
        target: { value: repoName },
      },
    );
    await screen.findByText("Repository name is available!", undefined, {
      timeout: 10_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Repo" }));

    const connectedRepo = await screen.findByTestId(
      "github-connected-repo",
      {},
      { timeout: 30_000 },
    );
    await within(connectedRepo).findByText("Successfully pushed to GitHub!", {
      exact: false,
    });
    await screen.findByTestId("branch-actions-menu-trigger", undefined, {
      timeout: 15_000,
    });
    return connectedRepo;
  }

  async function setupLinkedApp(baseName: string, repoName: string) {
    await harness.github.resetRepos();
    await harness.github.clearPushEvents();
    const app = await createFixtureApp(baseName);
    await mountAppDetails(app);
    await connectGitHub(app);
    await createRepoThroughConnector(repoName);
    cleanup();
    await mountAppDetails(app);
    await screen.findByTestId("github-connected-repo", undefined, {
      timeout: 15_000,
    });
    await screen.findByTestId("branch-actions-menu-trigger", undefined, {
      timeout: 15_000,
    });
    return app;
  }

  async function openDropdown(trigger: HTMLElement) {
    trigger.focus();
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="dropdown-menu-content"]'),
      ).toBeTruthy();
    });
  }

  async function clickMenuItem(testId: string) {
    const item = await screen.findByTestId(testId);
    fireEvent.pointerDown(item);
    fireEvent.pointerUp(item);
    fireEvent.click(item);
  }

  async function expandBranches() {
    fireEvent.click(await screen.findByTestId("branches-header"));
  }

  async function ensureBranchItem(branch: string) {
    if (!screen.queryByTestId(`branch-item-${branch}`)) {
      await expandBranches();
    }
    await screen.findByTestId(`branch-item-${branch}`, undefined, {
      timeout: 10_000,
    });
  }

  async function openBranchActions(branch: string) {
    await ensureBranchItem(branch);
    await openDropdown(await screen.findByTestId(`branch-actions-${branch}`));
  }

  async function mergeBranch(branch: string) {
    await openBranchActions(branch);
    await clickMenuItem("merge-branch-menu-item");
    await screen.findByRole("dialog", { name: "Merge Branch" });
    fireEvent.click(await screen.findByTestId("merge-branch-submit-button"));
  }

  function seedGitConflict(appDir: string) {
    const conflictFile = "conflict.txt";
    const conflictFilePath = path.join(appDir, conflictFile);

    fs.writeFileSync(conflictFilePath, "Line 1\nLine 2\nLine 3");
    git(appDir, "add", conflictFile);
    git(appDir, "commit", "-m", "Add conflict file");

    git(appDir, "checkout", "-b", "feature-conflict");
    fs.writeFileSync(
      conflictFilePath,
      "Line 1\nLine 2 Modified Feature\nLine 3",
    );
    git(appDir, "add", conflictFile);
    git(appDir, "commit", "-m", "Modify on feature");

    git(appDir, "checkout", "main");
    fs.writeFileSync(conflictFilePath, "Line 1\nLine 2 Modified Main\nLine 3");
    git(appDir, "add", conflictFile);
    git(appDir, "commit", "-m", "Modify on main");

    return { conflictFile, conflictFilePath };
  }

  async function startConflictMerge(app: TestApp) {
    const conflict = seedGitConflict(app.appDir);

    cleanup();
    await mountAppDetails(app);
    await screen.findByTestId("branch-actions-menu-trigger", undefined, {
      timeout: 15_000,
    });
    await mergeBranch("feature-conflict");
    await screen.findByRole(
      "button",
      { name: "Resolve merge conflicts with AI" },
      { timeout: 15_000 },
    );
    return conflict;
  }

  it("resolves merge conflicts with AI", async () => {
    const app = await setupLinkedApp(
      "git-collab-resolve",
      `test-git-conflict-resolve-hybrid-${Date.now()}`,
    );
    const { conflictFilePath } = await startConflictMerge(app);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Resolve merge conflicts with AI",
      }),
    );

    await waitFor(
      () => {
        expect(fs.readFileSync(conflictFilePath, "utf-8")).not.toMatch(
          /<<<<<<<|=======|>>>>>>>/,
        );
        expect(fs.existsSync(path.join(app.appDir, ".git", "MERGE_HEAD"))).toBe(
          false,
        );
      },
      { timeout: 30_000 },
    );
  }, 90_000);

  it("cancels sync when merge conflicts occur", async () => {
    const app = await setupLinkedApp(
      "git-collab-cancel",
      `test-git-conflict-cancel-hybrid-${Date.now()}`,
    );
    await startConflictMerge(app);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel sync" }));
    await waitFor(
      () => {
        expect(
          screen.queryByRole("button", {
            name: "Resolve merge conflicts with AI",
          }),
        ).toBeNull();
        expect(fs.existsSync(path.join(app.appDir, ".git", "MERGE_HEAD"))).toBe(
          false,
        );
      },
      { timeout: 15_000 },
    );
  }, 90_000);
});
