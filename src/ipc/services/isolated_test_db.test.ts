import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTempTestBranch: vi.fn(),
  deleteTempTestBranch: vi.fn().mockResolvedValue(undefined),
  updateNeonEnvVars: vi.fn().mockResolvedValue(undefined),
  readEnvFileIfExists: vi.fn().mockResolvedValue(null),
  executeApp: vi.fn().mockResolvedValue(undefined),
  cleanUpPort: vi.fn().mockResolvedValue(undefined),
  stopAppByInfo: vi.fn().mockResolvedValue(undefined),
  runningApps: new Map<number, any>(),
}));

vi.mock("../utils/neon_test_branch", () => ({
  createTempTestBranch: mocks.createTempTestBranch,
  deleteTempTestBranch: mocks.deleteTempTestBranch,
}));
vi.mock("../utils/app_env_var_utils", () => ({
  ENV_FILE_NAME: ".env.local",
  getEnvFilePath: ({ appPath }: { appPath: string }) => `${appPath}/.env.local`,
  readEnvFileIfExists: mocks.readEnvFileIfExists,
  updateNeonEnvVars: mocks.updateNeonEnvVars,
}));
vi.mock("../utils/framework_utils", () => ({
  detectFrameworkType: vi.fn(() => "nextjs"),
}));
vi.mock("../utils/lock_utils", () => ({
  withLock: (_id: number, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../utils/process_manager", () => ({
  runningApps: mocks.runningApps,
  stopAppByInfo: mocks.stopAppByInfo,
}));
vi.mock("./app_runtime_service", () => ({
  executeApp: mocks.executeApp,
  cleanUpPort: mocks.cleanUpPort,
}));
vi.mock("../../paths/paths", () => ({
  getDyadAppPath: (p: string) => `/apps/${p}`,
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { prepareIsolatedTestDatabase } from "./isolated_test_db";

const event = { sender: {} } as any;
const emit = vi.fn();

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    path: "app1",
    supabaseProjectId: null,
    neonProjectId: null,
    installCommand: null,
    startCommand: null,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runningApps.clear();
});

describe("prepareIsolatedTestDatabase — non-Neon paths", () => {
  it("discloses (but does not block) for Supabase apps", async () => {
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({ supabaseProjectId: "sb-1" }),
      event,
      emit,
      runtimeMode: "host",
    });
    expect(prepared.isolation.mode).toBe("none");
    expect(prepared.isolation.reason).toMatch(/Supabase/);
    expect(prepared.infraError).toBeUndefined();
    expect(mocks.createTempTestBranch).not.toHaveBeenCalled();
  });

  it("runs as-is with no reason for apps with no database", async () => {
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp(),
      event,
      emit,
      runtimeMode: "host",
    });
    expect(prepared.isolation).toEqual({ mode: "none" });
    expect(prepared.infraError).toBeUndefined();
  });

  it("discloses for non-host runtimes on a Neon app (no branch created)", async () => {
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({ neonProjectId: "proj-1" }),
      event,
      emit,
      runtimeMode: "docker",
    });
    expect(prepared.isolation.mode).toBe("none");
    expect(prepared.isolation.reason).toMatch(/docker/);
    expect(mocks.createTempTestBranch).not.toHaveBeenCalled();
  });
});

describe("prepareIsolatedTestDatabase — Neon happy path", () => {
  it("creates a branch, swaps env, restarts, and reports neon-branch", async () => {
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      neonAuthBaseUrl: "https://auth",
      cookieSecret: "secret",
    });
    // Server comes up immediately.
    mocks.runningApps.set(1, { proxyUrl: "http://localhost:42100" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({ neonProjectId: "proj-1" }),
      event,
      emit,
      runtimeMode: "host",
    });

    expect(mocks.createTempTestBranch).toHaveBeenCalled();
    expect(mocks.updateNeonEnvVars).toHaveBeenCalledWith(
      expect.objectContaining({ connectionUri: "postgres://temp" }),
    );
    expect(mocks.executeApp).toHaveBeenCalled();
    expect(prepared.isolation).toEqual({ mode: "neon-branch" });
    expect(prepared.infraError).toBeUndefined();

    // Teardown deletes the branch we created (row is stale, so it's passed in).
    await prepared.teardown();
    expect(mocks.deleteTempTestBranch).toHaveBeenCalledWith(
      expect.objectContaining({ neonTestBranchId: "test-br" }),
    );
    fetchSpy.mockRestore();
  });

  it("dead-ends (infraError) and restores when branch creation fails", async () => {
    mocks.createTempTestBranch.mockRejectedValue(new Error("neon down"));

    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({ neonProjectId: "proj-1" }),
      event,
      emit,
      runtimeMode: "host",
    });

    expect(prepared.infraError).toBeDefined();
    expect(prepared.infraError?.message).toMatch(/real data was not touched/i);
    expect(prepared.isolation.mode).toBe("none");
    // Restart-back was attempted as part of the dead-end restore.
    expect(mocks.executeApp).toHaveBeenCalled();
  });
});
