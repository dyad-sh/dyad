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

function gitStatus(appDir: string): string {
  return git(appDir, "status", "--porcelain").trim();
}

function currentBranch(appDir: string): string {
  return git(appDir, "branch", "--show-current").trim();
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

  async function selectItem(trigger: HTMLElement, matcher: string | RegExp) {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = await waitFor(() => {
      const options = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
      );
      const match = options.find((candidate) => {
        const text = candidate.textContent ?? "";
        return typeof matcher === "string"
          ? text.includes(matcher)
          : matcher.test(text);
      });
      expect(match).toBeTruthy();
      return match!;
    });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    fireEvent.keyDown(option, { key: "Enter" });
  }

  async function createBranch(branch: string, sourceBranch?: string) {
    await openDropdown(
      await screen.findByTestId("branch-actions-menu-trigger"),
    );
    await clickMenuItem("create-branch-trigger");
    await screen.findByRole("dialog", { name: "Create New Branch" });
    fireEvent.change(await screen.findByTestId("new-branch-name-input"), {
      target: { value: branch },
    });

    if (sourceBranch) {
      await selectItem(
        await screen.findByTestId("source-branch-select-trigger"),
        sourceBranch,
      );
    }

    fireEvent.click(await screen.findByTestId("create-branch-submit-button"));
    await expectCurrentBranch(branch);
  }

  async function selectBranch(branch: string) {
    await selectItem(
      await screen.findByTestId("branch-select-trigger"),
      branch,
    );
    await expectCurrentBranch(branch);
  }

  async function expectCurrentBranch(branch: string) {
    await waitFor(
      () => {
        expect(screen.getByTestId("branch-select-trigger").textContent).toMatch(
          new RegExp(branch),
        );
      },
      { timeout: 15_000 },
    );
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

  async function renameBranch(oldBranch: string, newBranch: string) {
    await openBranchActions(oldBranch);
    await clickMenuItem("rename-branch-menu-item");
    fireEvent.change(await screen.findByTestId("rename-branch-input"), {
      target: { value: newBranch },
    });
    fireEvent.click(await screen.findByTestId("rename-branch-submit-button"));
    await waitFor(() =>
      expect(screen.queryByTestId(`branch-item-${oldBranch}`)).toBeNull(),
    );
  }

  async function mergeBranch(branch: string) {
    await openBranchActions(branch);
    await clickMenuItem("merge-branch-menu-item");
    await screen.findByRole("dialog", { name: "Merge Branch" });
    fireEvent.click(await screen.findByTestId("merge-branch-submit-button"));
  }

  async function deleteBranch(branch: string) {
    await openBranchActions(branch);
    await clickMenuItem("delete-branch-menu-item");
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Branch" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`branch-item-${branch}`)).toBeNull(),
    );
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

  it("creates, switches, renames, merges, and deletes branches", async () => {
    const app = await setupLinkedApp(
      "git-collab-branches",
      `test-git-collab-hybrid-${Date.now()}`,
    );

    await createBranch("feature-1");
    await ensureBranchItem("feature-1");

    await selectBranch("main");
    await createBranch("feature-2", "feature-1");
    expect(gitStatus(app.appDir)).toBe("");

    await selectBranch("main");
    await renameBranch("feature-2", "feature-2-renamed");
    await ensureBranchItem("feature-2-renamed");
    expect(
      git(app.appDir, "branch", "--list", "feature-2-renamed").trim(),
    ).toContain("feature-2-renamed");

    await selectBranch("feature-1");
    const mergeTestFile = "merge-test.txt";
    const mergeTestFilePath = path.join(app.appDir, mergeTestFile);
    const featureContent = "Content from feature-1 branch";
    fs.writeFileSync(mergeTestFilePath, featureContent);
    git(app.appDir, "add", mergeTestFile);
    git(app.appDir, "commit", "-m", "Add merge test file");

    await selectBranch("main");
    expect(fs.existsSync(mergeTestFilePath)).toBe(false);

    await mergeBranch("feature-1");
    await waitFor(() => expect(fs.existsSync(mergeTestFilePath)).toBe(true), {
      timeout: 10_000,
    });
    expect(fs.readFileSync(mergeTestFilePath, "utf-8")).toBe(featureContent);
    expect(gitStatus(app.appDir)).toBe("");
    expect(currentBranch(app.appDir)).toBe("main");

    await deleteBranch("feature-1");
    await selectItem(
      await screen.findByTestId("branch-select-trigger"),
      "main",
    );
    expect(git(app.appDir, "branch", "--list", "feature-1").trim()).toBe("");
  }, 90_000);

  it("pulls changes from the remote through the branch actions menu", async () => {
    const app = await setupLinkedApp(
      "git-collab-pull",
      `test-git-pull-hybrid-${Date.now()}`,
    );

    const testFile = "pull-test.txt";
    const testFilePath = path.join(app.appDir, testFile);
    const fileContent = "Initial content";
    fs.writeFileSync(testFilePath, fileContent);
    git(app.appDir, "add", testFile);
    git(app.appDir, "commit", "-m", "Add pull test file");

    await openDropdown(
      await screen.findByTestId("branch-actions-menu-trigger"),
    );
    await clickMenuItem("git-pull-button");

    await screen.findByText("Pulled latest changes from remote", undefined, {
      timeout: 10_000,
    });
    expect(fs.existsSync(testFilePath)).toBe(true);
    expect(fs.readFileSync(testFilePath, "utf-8")).toBe(fileContent);
    expect(gitStatus(app.appDir)).toBe("");
  }, 60_000);

  it("invites and removes collaborators", async () => {
    await setupLinkedApp(
      "git-collab-invite",
      `test-git-collab-invite-hybrid-${Date.now()}`,
    );

    fireEvent.click(await screen.findByTestId("collaborators-header"));
    await screen.findByTestId("collaborator-invite-input", undefined, {
      timeout: 10_000,
    });

    const fakeUser = "test-user-123";
    fireEvent.change(screen.getByTestId("collaborator-invite-input"), {
      target: { value: fakeUser },
    });
    fireEvent.click(screen.getByTestId("collaborator-invite-button"));
    await screen.findByTestId(`collaborator-item-${fakeUser}`, undefined, {
      timeout: 10_000,
    });

    fireEvent.click(
      screen.getByTestId(`collaborator-remove-button-${fakeUser}`),
    );
    fireEvent.click(await screen.findByTestId("confirm-remove-collaborator"));
    await waitFor(
      () =>
        expect(
          screen.queryByTestId(`collaborator-item-${fakeUser}`),
        ).toBeNull(),
      { timeout: 10_000 },
    );
  }, 60_000);

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
