import fs from "node:fs";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    custom: vi.fn(),
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, chats } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { runningApps } from "@/ipc/utils/process_manager";
import { neonPreviewDomainService } from "@/ipc/services/neon_preview_domain_service";
import * as appEnvVars from "@/ipc/utils/app_env_var_utils";
import { ipc } from "@/ipc/types";
import * as neonManagement from "@/neon_admin/neon_management_client";
import * as dependencies from "@/ipc/processors/executeAddDependency";

type TestApp = {
  appId: number;
  name: string;
  appDir: string;
};

function readCookieSecret(envContents: string): string | undefined {
  return envContents.match(/^NEON_AUTH_COOKIE_SECRET=(.+)$/m)?.[1]?.trim();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

describe("Neon branch actions (integration)", () => {
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
    writeSettings({ neon: undefined, enableNeonBranchProtection: true });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createApp(
    baseName: string,
    framework: "next" | "vite" = "next",
  ): Promise<TestApp> {
    appCounter += 1;
    const name = `${baseName}-${appCounter}`;
    const appDir = path.join(appsRoot, slug(name));
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify(
        {
          name,
          private: true,
          scripts: { dev: framework === "next" ? "next dev" : "vite" },
          dependencies: {
            ...(framework === "next"
              ? { next: "^15.0.0" }
              : { vite: "^6.0.0" }),
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(
        appDir,
        framework === "next" ? "next.config.ts" : "vite.config.ts",
      ),
      framework === "next"
        ? "export default {};\n"
        : 'import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [] });\n',
    );

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    await harness.db.insert(chats).values({ appId: appRow.id });
    return { appId: appRow.id, name, appDir };
  }

  async function mountNeonDetails(app: TestApp) {
    harness.mountSurface({
      route: "/app-details",
      appId: app.appId,
      search: { provider: "neon" },
      withTitleBar: true,
    });
    await screen.findByTestId("app-details-page");
    await screen.findByRole("heading", { name: app.name });
  }

  function connectNeonAccount() {
    writeSettings({
      isTestMode: true,
      neon: {
        accessToken: { value: "fake-neon-access-token" },
        refreshToken: { value: "fake-neon-refresh-token" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
  }

  async function connectNeonProject() {
    await screen.findByTestId("neon-project-select", {}, { timeout: 10_000 });
    await harness.selectFromBaseUiSelect(
      await screen.findByTestId("neon-project-select"),
      /^Test Project\b/i,
    );
    await screen.findByTestId("neon-branch-select", {}, { timeout: 15_000 });
    await screen.findByText("development", undefined, { timeout: 15_000 });
  }

  async function appRow(appId: number) {
    return harness.db.query.apps.findFirst({ where: eq(apps.id, appId) });
  }

  async function waitForEnv(appDir: string, expected: string): Promise<string> {
    let contents = "";
    await waitFor(
      () => {
        contents = fs.readFileSync(path.join(appDir, ".env.local"), "utf8");
        expect(contents).toContain(expected);
      },
      { timeout: 15_000 },
    );
    return contents;
  }

  it("reconciles the bound preview when connecting Neon Auth and switching its active branch", async () => {
    writeSettings({ enableNeonBranchProtection: false });
    const app = await createApp("preview-domains");
    const origin = `http://app-${app.appId}.localhost:43999`;
    const registration = vi
      .spyOn(neonPreviewDomainService, "ensureTrustedDomain")
      .mockResolvedValue(undefined);
    const send = vi.fn();
    runningApps.set(app.appId, {
      process: null,
      processId: 99,
      mode: "host",
      lastViewedAt: 0,
      proxyUrl: origin,
      originalUrl: "http://localhost:32999",
      output: { send, enqueue: send, flush: vi.fn() },
    });
    try {
      connectNeonAccount();
      await mountNeonDetails(app);
      await connectNeonProject();
      await waitFor(() =>
        expect(registration).toHaveBeenCalledWith(
          expect.objectContaining({
            appId: app.appId,
            origin,
            target: {
              projectId: "test-project-id",
              branchId: "test-development-branch-id",
            },
          }),
        ),
      );
      await runningApps.get(app.appId)?.previewAuthRegistration?.settled;
      send.mockClear();
      await harness.selectFromBaseUiSelect(
        await screen.findByTestId("neon-branch-select"),
        /^main\b/i,
      );
      fireEvent.click(
        await screen.findByRole("button", {
          name: "I understand, use production",
        }),
      );
      await waitFor(() =>
        expect(registration).toHaveBeenCalledWith(
          expect.objectContaining({
            appId: app.appId,
            origin,
            target: {
              projectId: "test-project-id",
              branchId: "test-main-branch-id",
            },
          }),
        ),
      );
      expect(runningApps.get(app.appId)?.proxyUrl).toBe(origin);
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            previewAuth: undefined,
            message: expect.stringContaining(origin),
          }),
        ),
      );
    } finally {
      await runningApps.get(app.appId)?.previewAuthRegistration?.settled;
      runningApps.delete(app.appId);
      registration.mockRestore();
    }
  }, 90_000);

  it("clears the running Neon target even if unlink cannot clean the environment file", async () => {
    const app = await createApp("unlink-preview");
    await harness.db
      .update(apps)
      .set({ neonProjectId: "project" })
      .where(eq(apps.id, app.appId));
    const cleanupEnv = vi
      .spyOn(appEnvVars, "removeNeonEnvVars")
      .mockRejectedValueOnce(new Error("env is read-only"));
    const controller = new AbortController();
    const target = {
      provider: "neon" as const,
      projectId: "project",
      branchId: "branch",
    };
    const send = vi.fn();
    runningApps.set(app.appId, {
      process: null,
      processId: 99,
      mode: "host",
      lastViewedAt: 0,
      proxyUrl: `http://app-${app.appId}.localhost:43999`,
      originalUrl: "http://localhost:32999",
      previewAuthTarget: target,
      previewAuth: { provider: "neon", state: "pending" },
      previewAuthRegistration: {
        target,
        origin: `http://app-${app.appId}.localhost:43999`,
        controller,
        settled: Promise.resolve(),
      },
      output: { send, enqueue: send, flush: vi.fn() },
    });
    try {
      await expect(
        ipc.neon.unsetAppProject({ appId: app.appId }),
      ).rejects.toThrow("env is read-only");
      expect((await appRow(app.appId))?.neonProjectId).toBeNull();
      expect(controller.signal.aborted).toBe(true);
      expect(runningApps.get(app.appId)?.previewAuthTarget).toBeNull();
      expect(runningApps.get(app.appId)?.previewAuth).toBeUndefined();
    } finally {
      runningApps.delete(app.appId);
      cleanupEnv.mockRestore();
    }
  });

  it("does not silently connect a new app to production when a development branch is missing", async () => {
    const app = await createApp("neon-no-development", "vite");
    fs.writeFileSync(path.join(app.appDir, "AI_RULES.md"), "# App rules\n");
    const snapshotFiles = () =>
      Object.fromEntries(
        fs
          .readdirSync(app.appDir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const filePath = path.join(entry.parentPath, entry.name);
            return [
              path.relative(app.appDir, filePath),
              fs.readFileSync(filePath, "utf8"),
            ];
          }),
      );
    const originalFiles = snapshotFiles();
    const install = vi
      .spyOn(dependencies, "installPackages")
      .mockResolvedValue({
        warningMessages: [],
        installResults: "",
      });
    connectNeonAccount();
    const client = await neonManagement.getNeonClient();
    const response = await client.listProjectBranches({
      projectId: "test-project-id",
    });
    const mockClient = vi
      .spyOn(neonManagement, "getNeonClient")
      .mockResolvedValue(
        Object.assign(client, {
          listProjectBranches: vi.fn().mockResolvedValue({
            ...response,
            data: {
              ...response.data,
              branches: response.data.branches.filter(
                (branch) => branch.default,
              ),
            },
          }),
        }),
      );
    try {
      await expect(
        ipc.neon.setAppProject({
          appId: app.appId,
          projectId: "test-project-id",
        }),
      ).rejects.toThrow("Create a development branch");
      expect((await appRow(app.appId))?.neonProjectId).toBeNull();
      expect(fs.existsSync(path.join(app.appDir, ".env.local"))).toBe(false);
      expect(snapshotFiles()).toEqual(originalFiles);
      expect(install).not.toHaveBeenCalled();
      writeSettings({ enableNeonBranchProtection: false });
      await ipc.neon.setAppProject({
        appId: app.appId,
        projectId: "test-project-id",
      });
      expect((await appRow(app.appId))?.neonActiveBranchId).toBe(
        "test-main-branch-id",
      );
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({
          packages: ["nitro", "jiti"],
          appPath: app.appDir,
        }),
      );
      expect(fs.existsSync(path.join(app.appDir, "nitro.config.ts"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(app.appDir, "server/routes/api/.gitkeep")),
      ).toBe(true);
      expect(
        fs.readFileSync(path.join(app.appDir, "vite.config.ts"), "utf8"),
      ).not.toBe(originalFiles["vite.config.ts"]);
      expect(
        fs.readFileSync(path.join(app.appDir, "package.json"), "utf8"),
      ).not.toBe(originalFiles["package.json"]);
    } finally {
      mockClient.mockRestore();
      install.mockRestore();
    }
  });

  it("blocks new unsafe selections in main, preserves existing ones, and permits an explicit opt-out", async () => {
    const app = await createApp("neon-protection");
    connectNeonAccount();
    await ipc.neon.setAppProject({
      appId: app.appId,
      projectId: "test-project-id",
    });
    const originalEnv = fs.readFileSync(
      path.join(app.appDir, ".env.local"),
      "utf8",
    );
    const setActive = (branchId: string) =>
      ipc.neon.setActiveBranch({ appId: app.appId, branchId });
    const setDeploy = (branchType: "production" | "development") =>
      ipc.neon.setSelectedDatabaseBranchType({ appId: app.appId, branchType });
    await expect(setActive("test-main-branch-id")).rejects.toThrow(
      "disable Protect Neon database branches",
    );
    await expect(setDeploy("development")).rejects.toThrow(
      "disable Protect Neon database branches",
    );
    expect((await appRow(app.appId))?.neonActiveBranchId).toBe(
      "test-development-branch-id",
    );
    expect((await appRow(app.appId))?.selectedDatabaseBranchType).toBeNull();
    expect(fs.readFileSync(path.join(app.appDir, ".env.local"), "utf8")).toBe(
      originalEnv,
    );

    writeSettings({ enableNeonBranchProtection: false });
    await setActive("test-main-branch-id");
    await setDeploy("development");
    writeSettings({ enableNeonBranchProtection: true });
    await setDeploy("development");
    expect((await appRow(app.appId))?.selectedDatabaseBranchType).toBe(
      "development",
    );
    await setActive("test-main-branch-id");
    await setDeploy("production");
    await setActive("test-development-branch-id");
    await expect(setDeploy("development")).rejects.toThrow(
      "disable Protect Neon database branches",
    );
    await expect(setActive("test-main-branch-id")).rejects.toThrow(
      "disable Protect Neon database branches",
    );
  });

  it("updates Neon env vars and preserves per-branch auth secrets when switching branches", async () => {
    const app = await createApp("neon-branch");
    connectNeonAccount();
    writeSettings({ enableNeonBranchProtection: false });
    await mountNeonDetails(app);

    await connectNeonProject();

    const envBeforeSwitch = await waitForEnv(
      app.appDir,
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envBeforeSwitch).toContain(
      "POSTGRES_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envBeforeSwitch).toContain(
      "NEON_AUTH_BASE_URL=https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(envBeforeSwitch).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);

    const cookieSecretBeforeSwitch = readCookieSecret(envBeforeSwitch);
    expect(cookieSecretBeforeSwitch).toBeTruthy();

    await harness.selectFromBaseUiSelect(
      await screen.findByTestId("neon-branch-select"),
      /^main\b/i,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "I understand, use production",
      }),
    );

    const envAfterSwitch = await waitForEnv(
      app.appDir,
      "DATABASE_URL=postgresql://test:test@test-main.neon.tech/test",
    );
    expect(envAfterSwitch).toContain(
      "POSTGRES_URL=postgresql://test:test@test-main.neon.tech/test",
    );
    expect(envAfterSwitch).toContain(
      "NEON_AUTH_BASE_URL=https://test-main.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(envAfterSwitch).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);

    const cookieSecretAfterSwitch = readCookieSecret(envAfterSwitch);
    expect(cookieSecretAfterSwitch).toBeTruthy();
    expect(cookieSecretAfterSwitch).not.toBe(cookieSecretBeforeSwitch);

    let row = await appRow(app.appId);
    expect(row?.neonProjectId).toBe("test-project-id");
    expect(row?.neonDevelopmentBranchId).toBe("test-development-branch-id");
    expect(row?.neonActiveBranchId).toBe("test-main-branch-id");

    await harness.selectFromBaseUiSelect(
      await screen.findByTestId("neon-branch-select"),
      /^development\b/i,
    );

    const envAfterReturn = await waitForEnv(
      app.appDir,
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envAfterReturn).toContain(
      "POSTGRES_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envAfterReturn).toContain(
      "NEON_AUTH_BASE_URL=https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(readCookieSecret(envAfterReturn)).toBe(cookieSecretBeforeSwitch);

    row = await appRow(app.appId);
    expect(row?.neonActiveBranchId).toBe("test-development-branch-id");
  }, 90_000);
});
