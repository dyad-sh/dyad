import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const vercel = vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
  return {
    projects: {
      createProject: vi.fn(),
      createProjectEnv: vi.fn(),
      getProjectDomains: vi.fn(),
    },
    deployments: { createDeployment: vi.fn(), getDeployments: vi.fn() },
  };
});

// Mock the Vercel SDK boundary. The renderer, IPC handlers, SQLite, Git operations,
// and env sync remain real; test-build migration planning and execution use fixtures.
vi.mock("@/ipc/utils/vercel_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/vercel_utils")>()),
  createVercelClient: () => vercel,
  getVercelTeamSlug: async () => "test-team",
}));

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { apps, chats } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import * as migrationUtils from "@/ipc/utils/migration_utils";
import type { SchemaDiffStatement } from "ts-pg-schema-diff";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("guided deployment (renderer and real IPC)", () => {
  let harness: HybridChatHarness;
  let appId: number;
  let appDir: string;
  let counter = 0;
  let invokeStart: number;

  function git(...args: string[]) {
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
    )
      .toString()
      .trim();
  }

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      engine: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  // The fake Git server runs in this process: a synchronous network command
  // would block its event loop and deadlock the test.
  async function remoteHead() {
    const { stdout } = await promisify(execFile)(
      "git",
      ["ls-remote", "origin", "refs/heads/main"],
      { cwd: appDir, timeout: 10_000 },
    );
    return stdout.trim().split(/\s/)[0];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vercel.projects.createProjectEnv.mockResolvedValue({});
    vercel.projects.createProject.mockResolvedValue({
      id: "prj-guided-new",
      name: "guided",
      accountId: "team_actual_owner",
    });
    vercel.projects.getProjectDomains.mockResolvedValue({
      domains: [{ name: "guided.vercel.app" }],
    });
    vercel.deployments.createDeployment.mockResolvedValue({ id: "new-build" });
    vercel.deployments.getDeployments.mockResolvedValue({ deployments: [] });
    writeSettings({
      isTestMode: true,
      githubAccessToken: { value: "fake_access_token_12345" },
      githubUser: { email: "test@example.com" },
      vercelAccessToken: { value: "fake-vercel-token" },
      neon: {
        accessToken: { value: "fake-neon-access-token" },
        refreshToken: { value: "fake-neon-refresh-token" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    appDir = path.join(
      path.dirname(harness.appDir),
      `guided-deploy-${++counter}`,
    );
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "guided",
        private: true,
        dependencies: { next: "^15.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(appDir, "next.config.ts"),
      "export default {};\n",
    );
    git("init", "-b", "main");
    git("add", "-A");
    git("commit", "-m", "Initial app");
    const [app] = await harness.db
      .insert(apps)
      .values({
        name: `Guided ${counter}`,
        path: appDir,
        neonProjectId: "test-project-id",
        neonDevelopmentBranchId: "test-development-branch-id",
        neonActiveBranchId: "test-development-branch-id",
      })
      .returning();
    appId = app.id;
    await harness.db.insert(chats).values({ appId });
    invokeStart = harness.bridge.invokeLog.length;
  });

  afterEach(async () => {
    await harness.bridge.settleInFlight();
    cleanup();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await harness?.dispose();
  });

  const appRow = () =>
    harness.db.query.apps.findFirst({ where: eq(apps.id, appId) });
  const calls = (channel: string) =>
    harness.bridge.invokeLog
      .slice(invokeStart)
      .filter((entry) => entry.channel === channel);
  const button = (name: string) =>
    screen.getByRole("button", { name }) as HTMLButtonElement;
  const click = async (name: string) => {
    await screen.findByRole("button", { name });
    await waitFor(() => expect(button(name).disabled).toBe(false));
    fireEvent.click(button(name));
  };
  async function open() {
    harness.mountSurface({ route: "/deploy", appId });
    await click("Deploy");
    await screen.findByRole("dialog", { name: `Deploy Guided ${counter}` });
  }
  async function createRepo() {
    fireEvent.change(
      await screen.findByTestId("github-create-repo-name-input"),
      { target: { value: `guided-deploy-${counter}` } },
    );
    await screen.findByText(
      "Repository name is available!",
      {},
      { timeout: 10_000 },
    );
    await click("Create Repo");
    const repo = await screen.findByTestId(
      "github-connected-repo",
      {},
      { timeout: 30_000 },
    );
    await within(repo).findByText("Successfully pushed to GitHub!");
    await waitFor(() => expect(button("Sync to GitHub").disabled).toBe(false));
    await harness.bridge.settleInFlight();
  }
  async function confirmMigration() {
    await screen.findByText('DROP TABLE "mock_legacy"');
    await click("I understand, continue");
    await screen.findByText(/This will modify the main schema in Test Project/);
    await click("I understand, migrate to production");
  }

  it("leaves planning when a slow schema diff completes, including after a branch refetch", async () => {
    const pending = deferred<readonly SchemaDiffStatement[]>();
    const planner = vi
      .spyOn(migrationUtils, "generateNeonMigrationStatements")
      .mockReturnValueOnce(pending.promise);
    try {
      await open();
      await click("Production database");
      expect(button("Development database").disabled).toBe(false);
      await click("Migrate to Production");
      await screen.findByText("Computing migration plan...");
      await waitFor(() => expect(planner).toHaveBeenCalledOnce());
      expect(button("Development database").disabled).toBe(false);
      expect(button("Close").disabled).toBe(false);
      expect(button("Cancel").disabled).toBe(false);
      expect(button("Continue to GitHub").disabled).toBe(true);

      await act(async () => {
        await harness.queryClient().refetchQueries({
          queryKey: queryKeys.neon.project({ appId }),
        });
      });
      expect(screen.getByText("Computing migration plan...")).toBeTruthy();
      expect(planner).toHaveBeenCalledOnce();
      expect(calls("migration:migrate")).toHaveLength(0);

      await act(async () => {
        pending.resolve([
          {
            sql: 'ALTER TABLE "tasks" ADD COLUMN "title" text',
            type: "additive",
          },
        ]);
      });
      await screen.findByText('ALTER TABLE "tasks" ADD COLUMN "title" text');
      await waitFor(() =>
        expect(button("Development database").disabled).toBe(false),
      );
      expect(screen.queryByText("Computing migration plan...")).toBeNull();
      expect(button("Continue to GitHub").disabled).toBe(true);
      await click("Continue");
      await click("Migrate to Production");
      await screen.findByText(
        "Migration applied successfully. You can continue.",
      );
      await click("Continue to GitHub");
      await screen.findByRole("heading", {
        name: "Step 2 — GitHub repository",
      });
    } finally {
      pending.resolve([]);
    }
  });

  it.each([
    "prepareMigrationContext",
    "generateNeonMigrationStatements",
  ] as const)(
    "clears planning after %s fails and retries through the real handler",
    async (stage) => {
      const failure = deferred<never>();
      vi.spyOn(migrationUtils, stage).mockReturnValueOnce(failure.promise);
      try {
        await open();
        await click("Production database");
        await click("Migrate to Production");
        await screen.findByText("Computing migration plan...");
        await act(async () =>
          failure.reject(new Error("Database connection timed out")),
        );
        await screen.findByText("Couldn't compute migration plan.");
        expect(screen.queryByText("Computing migration plan...")).toBeNull();
        await waitFor(() =>
          expect(button("Development database").disabled).toBe(false),
        );
        expect(button("Continue to GitHub").disabled).toBe(true);
        expect(calls("migration:migrate")).toHaveLength(0);
        await click("Show details");
        await screen.findByText(/Database connection timed out/);
        await click("Retry");
        await confirmMigration();
        await screen.findByText(
          "Migration applied successfully. You can continue.",
        );
        expect(calls("migration:preview")).toHaveLength(2);
        await click("Continue to GitHub");
        await screen.findByRole("heading", {
          name: "Step 2 — GitHub repository",
        });
      } finally {
        failure.reject(new Error("Release pending test request"));
      }
    },
  );

  it.each(["empty plan", "failure"] as const)(
    "cancels stalled planning and ignores a late %s while a replacement plan is pending",
    async (outcome) => {
      const cancelled = deferred<readonly SchemaDiffStatement[]>();
      const replacement = deferred<readonly SchemaDiffStatement[]>();
      const planner = vi
        .spyOn(migrationUtils, "generateNeonMigrationStatements")
        .mockReturnValueOnce(cancelled.promise)
        .mockReturnValueOnce(replacement.promise);
      try {
        await open();
        await click("Production database");
        await click("Migrate to Production");
        await screen.findByText("Computing migration plan...");
        await waitFor(() => expect(planner).toHaveBeenCalledTimes(1));
        await click("Cancel");
        await waitFor(() =>
          expect(button("Development database").disabled).toBe(false),
        );
        expect(screen.queryByText("Computing migration plan...")).toBeNull();
        expect(document.activeElement).toBe(button("Migrate to Production"));
        expect(button("Continue to GitHub").disabled).toBe(true);

        // Start another review without waiting for the cancelled IPC call.
        await click("Migrate to Production");
        await waitFor(() => expect(planner).toHaveBeenCalledTimes(2));
        await act(async () => {
          if (outcome === "empty plan") cancelled.resolve([]);
          else cancelled.reject(new Error("Cancelled planner failed late"));
        });
        await waitFor(() =>
          expect(calls("migration:preview")[0].status).toBe("fulfilled"),
        );
        expect(screen.getByText("Computing migration plan...")).toBeTruthy();
        expect(
          screen.queryByText("Couldn't compute migration plan."),
        ).toBeNull();
        expect(screen.queryByText(/No schema changes needed/)).toBeNull();
        expect(button("Continue to GitHub").disabled).toBe(true);
        expect(calls("migration:migrate")).toHaveLength(0);

        await act(async () => replacement.resolve([]));
        await screen.findByText("No schema changes needed. You can continue.");
        expect(screen.queryByText("Computing migration plan...")).toBeNull();
        await click("Continue to GitHub");
        await screen.findByRole("heading", {
          name: "Step 2 — GitHub repository",
        });
        expect((await appRow())?.selectedDatabaseBranchType).toBe("production");
        expect(calls("migration:migrate")).toHaveLength(0);
      } finally {
        cancelled.resolve([]);
        replacement.resolve([]);
      }
    },
  );

  it("requires explicit migration approval, keeps cancellation in the database step, and persists production", async () => {
    await open();
    await click("Development database");
    await waitFor(() =>
      expect(button("Continue to GitHub").disabled).toBe(false),
    );
    await click("Production database");
    expect(button("Continue to GitHub").disabled).toBe(true);
    await click("Migrate to Production");
    await screen.findByText("Destructive changes detected");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await click("I understand, continue");
    await click("Cancel");
    expect(calls("migration:migrate")).toHaveLength(0);
    expect(button("Continue to GitHub").disabled).toBe(true);
    expect((await appRow())?.selectedDatabaseBranchType).toBeNull();
    await click("Migrate to Production");
    await confirmMigration();
    await screen.findByText(
      "Migration applied successfully. You can continue.",
    );
    expect(calls("migration:migrate")).toHaveLength(1);
    expect(calls("migration:migrate")[0].result).toEqual(
      expect.objectContaining({ ok: true }),
    );
    await click("Continue to GitHub");
    await screen.findByRole("heading", { name: "Step 2 — GitHub repository" });
    expect((await appRow())?.selectedDatabaseBranchType).toBe("production");
    expect(screen.queryByText('DROP TABLE "mock_legacy"')).toBeNull();
    expect(button("Continue to deployment").disabled).toBe(true);
  }, 60_000);

  it("uses the main database and corrects a previously selected development database without migrating", async () => {
    await harness.db
      .update(apps)
      .set({
        neonActiveBranchId: "test-main-branch-id",
        selectedDatabaseBranchType: "development",
      })
      .where(eq(apps.id, appId));
    await open();
    await screen.findByText(/You are on the main database branch/);
    await click("Continue to GitHub");
    await screen.findByRole("heading", { name: "Step 2 — GitHub repository" });
    expect((await appRow())?.selectedDatabaseBranchType).toBe("production");
    expect(calls("migration:preview")).toHaveLength(0);
    expect(calls("migration:migrate")).toHaveLength(0);
  });

  it("verifies GitHub, retries environment setup, and only finishes the Vercel build started by this flow", async () => {
    await open();
    await click("Development database");
    await click("Continue to GitHub");
    await createRepo();
    expect((await appRow())?.selectedDatabaseBranchType).toBe("development");
    expect(calls("migration:preview")).toHaveLength(0);

    // Committing after setup makes GitHub stale even though a repo is linked.
    fs.writeFileSync(path.join(appDir, "latest.txt"), "latest code\n");
    git("add", "latest.txt");
    git("commit", "-m", "Latest code");
    await click("Continue to deployment");
    await screen.findByText(/This app and GitHub are not in sync yet/);
    expect(
      screen.queryByRole("heading", { name: "Step 3 — Deployment" }),
    ).toBeNull();
    await click("Sync to GitHub");
    await waitFor(
      async () => {
        expect(button("Sync to GitHub").disabled).toBe(false);
        expect(await remoteHead()).toBe(git("rev-parse", "HEAD"));
      },
      { timeout: 20_000 },
    );
    await harness.bridge.settleInFlight();

    // Seed an already-created Vercel project after opening the wizard: linking
    // a provider during setup must preserve the first-deployment steps.
    await harness.db
      .update(apps)
      .set({
        vercelProjectId: "prj-guided",
        vercelProjectName: "guided",
        vercelTeamId: "team-guided",
      })
      .where(eq(apps.id, appId));
    vercel.projects.createProjectEnv.mockRejectedValueOnce(
      new Error("Environment service unavailable"),
    );
    const deployment = (uid: string, readyState: string) => ({
      uid,
      readyState,
      url: `${uid}.vercel.app`,
      target: "production",
      createdAt: 1,
    });
    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [deployment("old-build", "READY")],
    });
    await act(async () => {
      await harness
        .queryClient()
        .invalidateQueries({ queryKey: queryKeys.apps.detail({ appId }) });
    });
    await click("Continue to deployment");
    await screen.findByRole("heading", { name: "Step 3 — Deployment" });
    await screen.findByText(/Environment service unavailable/);
    expect(vercel.deployments.createDeployment).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    await click("Retry environment setup");
    await screen.findByText("Building on Vercel…");
    expect(vercel.projects.createProjectEnv).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idOrName: "prj-guided",
        teamId: "team-guided",
        upsert: "true",
        requestBody: expect.arrayContaining([
          expect.objectContaining({
            key: "DATABASE_URL",
            value: "postgresql://test:test@test-development.neon.tech/test",
          }),
          expect.objectContaining({
            key: "NEON_AUTH_COOKIE_SECRET",
            value: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]),
      }),
    );
    expect(vercel.deployments.createDeployment).toHaveBeenCalledWith({
      teamId: "team-guided",
      requestBody: {
        name: "guided",
        project: "prj-guided",
        target: "production",
        gitSource: {
          type: "github",
          org: "testuser",
          repo: `guided-deploy-${counter}`,
          ref: "main",
        },
      },
    });
    expect(vercel.deployments.getDeployments).toHaveBeenCalledWith({
      projectId: "prj-guided",
      teamId: "team-guided",
      limit: 5,
    });
    expect(
      vercel.projects.createProjectEnv.mock.invocationCallOrder.at(-1)!,
    ).toBeLessThan(
      vercel.deployments.createDeployment.mock.invocationCallOrder[0],
    );
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();

    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [
        deployment("old-build", "READY"),
        deployment("new-build", "ERROR"),
      ],
    });
    await act(async () => {
      await harness.queryClient().invalidateQueries({
        queryKey: queryKeys.vercel.deployments({ appId }),
      });
    });
    await screen.findByText(/The Vercel deployment did not finish/);
    vercel.deployments.createDeployment.mockResolvedValue({
      id: "retry-build",
    });
    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [deployment("retry-build", "READY")],
    });
    await click("Retry deployment");
    await screen.findByText(
      "Deployment verified and environment variables configured.",
    );
    await click("Finish");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(vercel.deployments.createDeployment).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("commits and syncs dirty local files from the GitHub step before continuing", async () => {
    await open();
    await click("Development database");
    await click("Continue to GitHub");
    await createRepo();
    fs.writeFileSync(path.join(appDir, "latest.txt"), "latest code\n");
    await click("Continue to deployment");
    await screen.findByText(/This app and GitHub are not in sync yet/);
    await click("Commit changes and sync to GitHub");
    await waitFor(
      async () => {
        expect(git("status", "--porcelain")).toBe("");
        expect(await remoteHead()).toBe(git("rev-parse", "HEAD"));
      },
      { timeout: 20_000 },
    );
    expect(git("log", "-1", "--format=%s")).toBe("Prepare deployment");
    expect(
      screen.getByRole("heading", { name: "Step 2 — GitHub repository" }),
    ).toBeTruthy();
    await click("Continue to deployment");
    await screen.findByRole("heading", { name: "Step 3 — Deployment" });
  }, 60_000);

  it("creates one production build after configuring a new Vercel project's environment", async () => {
    // Creation learns the domain, but Vercel's next listing is still empty.
    vercel.projects.getProjectDomains.mockResolvedValue({ domains: [] });
    vercel.projects.getProjectDomains.mockResolvedValueOnce({
      domains: [{ name: "guided.vercel.app" }],
    });
    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [
        {
          uid: "new-build",
          readyState: "READY",
          state: "READY",
          target: "production",
          url: "guided.vercel.app",
          createdAt: 1,
        },
      ],
    });
    await open();
    await click("Development database");
    await click("Continue to GitHub");
    await createRepo();
    await click("Continue to deployment");
    await click("Create Project");
    await screen.findByText(
      "Deployment verified and environment variables configured.",
      {},
      { timeout: 15_000 },
    );
    await harness.bridge.settleInFlight();
    expect(calls("vercel:create-project")).toHaveLength(1);
    expect(vercel.projects.createProjectEnv).toHaveBeenCalledOnce();
    expect(vercel.deployments.createDeployment).toHaveBeenCalledOnce();
    expect(
      vercel.projects.createProjectEnv.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vercel.deployments.createDeployment.mock.invocationCallOrder[0],
    );
    expect(calls("vercel:create-deployment")).toHaveLength(1);
    expect((await appRow())?.vercelProjectId).toBe("prj-guided-new");
    expect((await appRow())?.vercelTeamId).toBe("team_actual_owner");
    expect(vercel.projects.createProjectEnv).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team_actual_owner" }),
    );
    expect(calls("vercel:sync-neon-config").at(-1)?.result).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          domainsAdded: ["https://guided.vercel.app"],
        }),
      }),
    );
  }, 60_000);

  it("checks GitHub before changing a hosted production schema, then commits and pushes the approved update", async () => {
    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [{ uid: "new-build", readyState: "READY" }],
    });
    await harness.db
      .update(apps)
      .set({
        vercelProjectId: "prj-hosted",
        vercelTeamId: "team-hosted",
        selectedDatabaseBranchType: "production",
      })
      .where(eq(apps.id, appId));
    await open();
    await click("Review and deploy");
    await screen.findByTestId("github-create-repo-name-input");
    expect(calls("github:verify-connection").at(-1)?.result).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(calls("migration:preview")).toHaveLength(0);
    await createRepo();
    await harness.github.clearPushEvents();
    fs.writeFileSync(
      path.join(appDir, "hosted-update.txt"),
      "approved update\n",
    );
    await click("Review and deploy");
    await screen.findByText('DROP TABLE "mock_legacy"');
    expect(calls("migration:migrate")).toHaveLength(0);
    expect(await harness.github.pushEvents()).toEqual([]);
    await confirmMigration();
    await screen.findByText(
      /Latest code verified on GitHub/,
      {},
      { timeout: 30_000 },
    );
    await harness.bridge.settleInFlight();
    expect(git("log", "-1", "--format=%s")).toBe("Prepare deployment");
    expect(git("status", "--porcelain")).toBe("");
    expect(await remoteHead()).toBe(git("rev-parse", "HEAD"));
    expect(vercel.projects.createProjectEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        idOrName: "prj-hosted",
        teamId: "team-hosted",
      }),
    );
    expect(calls("vercel:sync-neon-config")).toHaveLength(1);
    expect(await harness.github.pushEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repo: `guided-deploy-${counter}`,
          branch: "main",
          operation: "push",
        }),
      ]),
    );
    await screen.findByText(
      "Deployment verified and environment variables configured.",
    );
    expect(vercel.deployments.createDeployment).toHaveBeenCalledOnce();
    await click("Finish");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }, 60_000);

  it("repairs a legacy Vercel scope and builds even when GitHub has no new commits", async () => {
    await harness.db
      .update(apps)
      .set({
        vercelProjectId: "prj-hosted",
        vercelTeamId: "team_unrelated",
        selectedDatabaseBranchType: "development",
      })
      .where(eq(apps.id, appId));
    for (const request of [
      vercel.projects.createProjectEnv,
      vercel.projects.getProjectDomains,
      vercel.deployments.createDeployment,
      vercel.deployments.getDeployments,
    ]) {
      const succeed = request.getMockImplementation()!;
      request.mockImplementation((params) =>
        params.teamId ? Promise.reject({ statusCode: 404 }) : succeed(params),
      );
    }
    await open();
    await click("Review and deploy");
    await createRepo();
    const initialHead = git("rev-parse", "HEAD");
    await harness.github.clearPushEvents();
    await click("Review and deploy");
    await screen.findByText("Building on Vercel…", {}, { timeout: 30_000 });
    expect(git("rev-parse", "HEAD")).toBe(initialHead);
    expect(await remoteHead()).toBe(initialHead);
    expect(await harness.github.pushEvents()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    for (const request of [
      vercel.projects.createProjectEnv,
      vercel.projects.getProjectDomains,
      vercel.deployments.createDeployment,
      vercel.deployments.getDeployments,
    ]) {
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "team_unrelated" }),
      );
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: undefined }),
      );
    }
    expect(
      vercel.projects.createProjectEnv.mock.invocationCallOrder.at(-1)!,
    ).toBeLessThan(
      vercel.deployments.createDeployment.mock.invocationCallOrder[0],
    );
    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [{ uid: "new-build", readyState: "ERROR" }],
    });
    await act(async () => {
      await harness.queryClient().invalidateQueries({
        queryKey: queryKeys.vercel.deployments({ appId }),
      });
    });
    await screen.findByText(/The Vercel deployment did not finish/);
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    vercel.deployments.createDeployment.mockResolvedValue({
      id: "retry-build",
    });
    vercel.deployments.getDeployments.mockResolvedValue({
      deployments: [{ uid: "retry-build", readyState: "READY" }],
    });
    await click("Retry deployment");
    await screen.findByText(
      "Deployment verified and environment variables configured.",
    );
    await click("Finish");
  }, 60_000);

  it.each(["team_project_owner", "user_personal"])(
    "connects an existing project using its actual owner (%s)",
    async (accountId) => {
      const originalFetch = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        if (String(input).endsWith("/v9/projects"))
          return Promise.resolve(
            Response.json({
              projects: [{ id: "prj-existing", name: "existing", accountId }],
            }),
          );
        return originalFetch(input, init);
      });
      await ipc.vercel.connectExistingProject({
        appId,
        projectId: "prj-existing",
      });
      const teamId = accountId.startsWith("team_") ? accountId : null;
      expect((await appRow())?.vercelTeamId).toBe(teamId);
      const result = await ipc.vercel.syncNeonConfig({
        appId,
      });
      expect(result).toMatchObject({ envPushed: true });
      expect(vercel.projects.createProjectEnv).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: teamId ?? undefined }),
      );
    },
  );

  it.each(["behind", "diverged"])(
    "blocks production migration when local history is %s GitHub",
    async (history) => {
      await harness.db
        .update(apps)
        .set({
          vercelProjectId: "prj-hosted",
          selectedDatabaseBranchType: "production",
        })
        .where(eq(apps.id, appId));
      await open();
      await click("Review and deploy");
      await createRepo();
      const base = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(appDir, "remote.txt"), "remote update\n");
      git("add", "remote.txt");
      git("commit", "-m", "Remote update");
      await promisify(execFile)("git", ["push", "origin", "main"], {
        cwd: appDir,
        timeout: 10_000,
      });
      git("reset", "--hard", base);
      if (history === "diverged") {
        fs.writeFileSync(path.join(appDir, "local.txt"), "local update\n");
        git("add", "local.txt");
        git("commit", "-m", "Local update");
      }
      const localHead = git("rev-parse", "HEAD");
      await harness.github.clearPushEvents();
      await click("Review and deploy");
      await screen.findByText(/GitHub has changes that are not in this app/);
      expect(calls("migration:preview")).toHaveLength(0);
      expect(calls("migration:migrate")).toHaveLength(0);
      expect(git("rev-parse", "HEAD")).toBe(localHead);
      expect(await harness.github.pushEvents()).toEqual([]);
    },
    60_000,
  );
});
