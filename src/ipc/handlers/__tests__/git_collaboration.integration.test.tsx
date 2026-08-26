import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

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

const execFileAsync = promisify(execFile);

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

async function gitNetwork(appDir: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync(
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
    {
      cwd: appDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  return result.stdout;
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
      { name: "Resolve with AI" },
      { timeout: 15_000 },
    );
    expect(
      screen.getAllByText(`Resolve 1 conflict to finish merging.`),
    ).toHaveLength(1);
    expect(
      screen.queryByText("Merge conflicts detected while syncing to GitHub."),
    ).toBeNull();
    return conflict;
  }

  async function startSyncConflict(app: TestApp) {
    const conflictFile = "conflict.txt";
    const conflictFilePath = path.join(app.appDir, conflictFile);
    fs.writeFileSync(conflictFilePath, "Line 1\nLine 2\nLine 3");
    git(app.appDir, "add", conflictFile);
    git(app.appDir, "commit", "-m", "Add sync conflict fixture");
    await gitNetwork(app.appDir, "push", "origin", "main");

    const remoteClone = path.join(appsRoot, `${slug(app.name)}-remote`);
    const remoteUrl = git(app.appDir, "remote", "get-url", "origin").trim();
    await gitNetwork(appsRoot, "clone", remoteUrl, remoteClone);
    fs.writeFileSync(
      path.join(remoteClone, conflictFile),
      "Line 1\nLine 2 Modified Main\nLine 3",
    );
    git(remoteClone, "add", conflictFile);
    git(remoteClone, "commit", "-m", "Modify conflict fixture remotely");
    await gitNetwork(remoteClone, "push", "origin", "main");

    fs.writeFileSync(
      conflictFilePath,
      "Line 1\nLine 2 Modified Feature\nLine 3",
    );
    git(app.appDir, "add", conflictFile);
    git(app.appDir, "commit", "-m", "Modify conflict fixture locally");

    cleanup();
    await mountAppDetails(app);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sync to GitHub" }),
    );
    await screen.findByRole(
      "button",
      { name: "Resolve with AI" },
      { timeout: 15_000 },
    );
    expect(
      screen.getByText("Resolve 1 conflict to continue syncing."),
    ).toBeTruthy();
    return { conflictFilePath };
  }

  it("resolves sync conflicts with AI and continues the interrupted sync", async () => {
    const app = await setupLinkedApp(
      "git-collab-resolve",
      `test-git-conflict-resolve-hybrid-${Date.now()}`,
    );
    const { conflictFilePath } = await startSyncConflict(app);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Resolve with AI",
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
    await harness.bridge.settleInFlight();

    cleanup();
    await mountAppDetails(app);
    await waitFor(
      () => {
        expect(
          screen.getByTestId("github-connected-repo").textContent,
        ).toContain("Conflicts resolved");
      },
      { timeout: 15_000 },
    );
    const continueButton = await screen.findByRole(
      "button",
      { name: "Continue to Sync" },
      { timeout: 15_000 },
    );
    expect(
      screen.queryByRole("button", { name: "Resolve with AI" }),
    ).toBeNull();

    await harness.github.clearPushEvents();
    fireEvent.click(continueButton);
    await waitFor(
      () => {
        expect(
          within(screen.getByTestId("github-connected-repo")).getByText(
            "Successfully pushed to GitHub!",
            { exact: false },
          ),
        ).toBeTruthy();
      },
      { timeout: 30_000 },
    );
    await harness.bridge.settleInFlight();
    expect(await harness.github.pushEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "push", branch: "main" }),
      ]),
    );
    await gitNetwork(app.appDir, "fetch", "origin", "main");
    expect(git(app.appDir, "branch", "--show-current").trim()).toBe("main");
    expect(git(app.appDir, "status", "--porcelain").trim()).toBe("");
    expect(git(app.appDir, "rev-parse", "HEAD").trim()).toBe(
      git(app.appDir, "rev-parse", "origin/main").trim(),
    );
    expect(git(app.appDir, "show", "origin/main:conflict.txt")).not.toMatch(
      /<<<<<<<|=======|>>>>>>>/,
    );
  }, 90_000);

  it("cancels sync when merge conflicts occur", async () => {
    const app = await setupLinkedApp(
      "git-collab-cancel",
      `test-git-conflict-cancel-hybrid-${Date.now()}`,
    );
    await startConflictMerge(app);

    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel merge" }),
    );
    await waitFor(
      () => {
        expect(
          screen.queryByRole("button", {
            name: "Resolve with AI",
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
