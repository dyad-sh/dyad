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
import { eq } from "drizzle-orm";

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

type PushEvent = {
  repo: string;
  branch: string;
  operation: "push" | "create" | "delete";
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
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", ...args],
    { cwd: appDir, stdio: "pipe" },
  ).toString();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

describe("GitHub connector actions (integration)", () => {
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
    expect(await screen.findByText("Set up your GitHub repo")).toBeTruthy();
  }

  async function resetFakeGitHub() {
    await harness.github.resetRepos();
    await harness.github.clearPushEvents();
  }

  async function waitForPushEvent(expected: PushEvent) {
    await waitFor(
      async () => {
        const events = (await harness.github.pushEvents()) as PushEvent[];
        expect(events).toEqual(
          expect.arrayContaining([expect.objectContaining(expected)]),
        );
      },
      { timeout: 20_000 },
    );
  }

  async function createRepoThroughConnector(repoName: string, branch = "main") {
    fireEvent.change(
      await screen.findByTestId("github-create-repo-name-input"),
      {
        target: { value: repoName },
      },
    );
    await screen.findByText("Repository name is available!", undefined, {
      timeout: 10_000,
    });

    fireEvent.change(screen.getByTestId("github-new-repo-branch-input"), {
      target: { value: branch },
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
    return connectedRepo;
  }

  async function appRow(appId: number) {
    return harness.db.query.apps.findFirst({ where: eq(apps.id, appId) });
  }

  it("connects to GitHub through the device flow", async () => {
    await resetFakeGitHub();
    const app = await createFixtureApp("github-device-flow");
    await mountAppDetails(app);

    await connectGitHub(app);

    const settings = readSettings();
    expect(settings.githubAccessToken?.value).toBe("fake_access_token_12345");
  }, 60_000);

  it("creates and syncs new repositories, including custom and normalized branches", async () => {
    await resetFakeGitHub();

    const cases = [
      { repoInput: "test-new-repo-hybrid", repo: "test-new-repo-hybrid" },
      {
        repoInput: "test-new-repo-hybrid-custom",
        repo: "test-new-repo-hybrid-custom",
        branch: "new-branch",
      },
      { repoInput: "my hybrid repo", repo: "my-hybrid-repo" },
    ];

    for (const testCase of cases) {
      cleanup();
      writeSettings({
        githubAccessToken: undefined,
        githubUser: undefined,
      });
      await harness.github.clearPushEvents();

      const branch = testCase.branch ?? "main";
      const app = await createFixtureApp(`github-create-${testCase.repo}`);
      await mountAppDetails(app);
      await connectGitHub(app);
      const connectedRepo = await createRepoThroughConnector(
        testCase.repoInput,
        branch,
      );

      expect(
        within(connectedRepo).getByText(`testuser/${testCase.repo}`),
      ).toBeTruthy();
      await waitForPushEvent({
        repo: testCase.repo,
        branch,
        operation: "create",
      });

      const row = await appRow(app.appId);
      expect(row?.githubOrg).toBe("testuser");
      expect(row?.githubRepo).toBe(testCase.repo);
      expect(row?.githubBranch).toBe(branch);
    }
  }, 120_000);

  it("disconnects a linked repository and shows the setup flow again", async () => {
    await resetFakeGitHub();
    const app = await createFixtureApp("github-disconnect-repo");
    await mountAppDetails(app);
    await connectGitHub(app);
    await createRepoThroughConnector("test-new-repo-hybrid-disconnect");

    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect from repo" }),
    );

    await screen.findByTestId("github-setup-repo");
    await screen.findByText("Set up your GitHub repo");
    const row = await appRow(app.appId);
    expect(row?.githubOrg).toBeNull();
    expect(row?.githubRepo).toBeNull();
    expect(row?.githubBranch).toBeNull();
  }, 60_000);

  it("shows a reconnect prompt when GitHub credentials are removed from settings", async () => {
    await resetFakeGitHub();
    const app = await createFixtureApp("github-reconnect");
    await mountAppDetails(app);
    await connectGitHub(app);
    await createRepoThroughConnector("test-new-repo-hybrid-reconnect");

    cleanup();
    harness.mountSurface({ route: "/settings" });
    const disconnectButton = await screen.findByRole("button", {
      name: "Disconnect from GitHub",
    });
    fireEvent.click(disconnectButton);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Disconnect from GitHub" }),
      ).toBeNull(),
    );
    expect(readSettings().githubAccessToken).toBeUndefined();
    expect(readSettings().githubUser).toBeUndefined();

    cleanup();
    await mountAppDetails(app);
    const reconnectCard = await screen.findByTestId("github-unconnected-repo");
    expect(
      within(reconnectCard).getByText("Reconnect your GitHub account"),
    ).toBeTruthy();
    expect(
      within(reconnectCard).getByText(
        "This app is linked to testuser/test-new-repo-hybrid-reconnect, but GitHub credentials are missing from settings.",
      ),
    ).toBeTruthy();
    expect(
      within(reconnectCard).getByRole("button", { name: "Connect to GitHub" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sync to GitHub" })).toBeNull();
  }, 90_000);

  it("connects an existing repository and syncs selected branches", async () => {
    await resetFakeGitHub();

    const cases = [{ branch: "main" }, { branch: "new-branch", custom: true }];

    for (const testCase of cases) {
      cleanup();
      writeSettings({
        githubAccessToken: undefined,
        githubUser: undefined,
      });
      await harness.github.clearPushEvents();

      const app = await createFixtureApp(`github-existing-${testCase.branch}`);
      await mountAppDetails(app);
      await connectGitHub(app);

      fireEvent.click(
        screen.getByRole("button", { name: "Connect to existing repo" }),
      );
      await screen.findByText("Select a repository", undefined, {
        timeout: 10_000,
      });
      await harness.selectFromBaseUiSelect(
        await screen.findByTestId("github-repo-select"),
        "testuser/existing-app",
      );
      await screen.findByText("main", undefined, { timeout: 10_000 });

      if (testCase.custom) {
        await harness.selectFromBaseUiSelect(
          await screen.findByTestId("github-branch-select"),
          /Type custom branch name/,
        );
        fireEvent.change(
          await screen.findByTestId("github-custom-branch-input"),
          {
            target: { value: testCase.branch },
          },
        );
      } else {
        await harness.selectFromBaseUiSelect(
          await screen.findByTestId("github-branch-select"),
          testCase.branch,
        );
      }

      fireEvent.click(screen.getByRole("button", { name: "Connect to Repo" }));

      const connectedRepo = await screen.findByTestId(
        "github-connected-repo",
        {},
        { timeout: 30_000 },
      );
      expect(
        within(connectedRepo).getByText("testuser/existing-app"),
      ).toBeTruthy();
      await waitForPushEvent({
        repo: "existing-app",
        branch: testCase.branch,
        operation: "create",
      });

      const row = await appRow(app.appId);
      expect(row?.githubOrg).toBe("testuser");
      expect(row?.githubRepo).toBe("existing-app");
      expect(row?.githubBranch).toBe(testCase.branch);
    }
  }, 120_000);
});
