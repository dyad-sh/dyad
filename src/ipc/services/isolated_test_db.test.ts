import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTempTestBranch: vi.fn(),
  deleteTempTestBranch: vi.fn().mockResolvedValue(undefined),
  createNeonTestAccount: vi.fn(),
  createTempTestUser: vi.fn(),
  deleteTempTestUser: vi.fn().mockResolvedValue(undefined),
  checkRls: vi.fn().mockResolvedValue({ tablesWithoutRls: [] }),
  getPublishableKey: vi.fn(),
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
vi.mock("../utils/neon_test_account", () => ({
  createNeonTestAccount: mocks.createNeonTestAccount,
}));
vi.mock("../../supabase_admin/supabase_context", () => ({
  getPublishableKey: mocks.getPublishableKey,
}));
vi.mock("../utils/supabase_test_user", () => ({
  createTempTestUser: mocks.createTempTestUser,
  deleteTempTestUser: mocks.deleteTempTestUser,
  checkRls: mocks.checkRls,
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
    supabaseOrganizationSlug: null,
    supabaseTestUserId: null,
    neonProjectId: null,
    installCommand: null,
    startCommand: null,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runningApps.clear();
  mocks.checkRls.mockResolvedValue({ tablesWithoutRls: [] });
  mocks.readEnvFileIfExists.mockResolvedValue(null);
  mocks.createTempTestUser.mockResolvedValue({
    userId: "user-1",
    email: "dyad-test+1@dyad.test",
    password: "pw",
    projectUrl: "https://sb-1.supabase.co",
  });
  mocks.getPublishableKey.mockResolvedValue("anon-key-123");
  mocks.createNeonTestAccount.mockResolvedValue({
    email: "neon-test@dyad.test",
    password: "neon-pw",
  });
});

describe("prepareIsolatedTestDatabase — Supabase test-user path", () => {
  it("creates a test user and returns credentials when RLS is fully enabled", async () => {
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({
        supabaseProjectId: "sb-1",
        supabaseOrganizationSlug: "org-1",
      }),
      event,
      emit,
      runtimeMode: "host",
    });
    expect(mocks.createTempTestUser).toHaveBeenCalled();
    expect(prepared.isolation.mode).toBe("supabase-test-user");
    expect(prepared.isolation.reason).toBeUndefined();
    expect(prepared.testCredentials).toMatchObject({
      DYAD_TEST_USER_EMAIL: "dyad-test+1@dyad.test",
      DYAD_TEST_USER_PASSWORD: "pw",
      DYAD_TEST_SUPABASE_URL: "https://sb-1.supabase.co",
    });
    expect(prepared.infraError).toBeUndefined();

    await prepared.teardown();
    expect(mocks.deleteTempTestUser).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseTestUserId: "user-1" }),
    );
  });

  it("warns (but still isolates) when some tables lack RLS", async () => {
    mocks.checkRls.mockResolvedValue({ tablesWithoutRls: ["posts", "todos"] });
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({
        supabaseProjectId: "sb-1",
        supabaseOrganizationSlug: "org-1",
      }),
      event,
      emit,
      runtimeMode: "host",
    });
    expect(prepared.isolation.mode).toBe("supabase-test-user");
    expect(prepared.isolation.reason).toMatch(/posts, todos/);
    expect(prepared.testCredentials).toBeDefined();
    expect(prepared.infraError).toBeUndefined();
  });

  it("discloses without creating a user when no organization is connected", async () => {
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({ supabaseProjectId: "sb-1" }),
      event,
      emit,
      runtimeMode: "host",
    });
    expect(prepared.isolation.mode).toBe("none");
    expect(prepared.isolation.reason).toMatch(/Supabase organization/);
    expect(mocks.createTempTestUser).not.toHaveBeenCalled();
  });

  it("dead-ends (infraError) when test-user creation fails", async () => {
    mocks.createTempTestUser.mockRejectedValue(new Error("supabase down"));
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({
        supabaseProjectId: "sb-1",
        supabaseOrganizationSlug: "org-1",
      }),
      event,
      emit,
      runtimeMode: "host",
    });
    expect(prepared.infraError).toBeDefined();
    expect(prepared.infraError?.message).toMatch(/real data was not touched/i);
    expect(prepared.isolation.mode).toBe("none");
    expect(prepared.testCredentials).toBeUndefined();
  });
});

describe("prepareIsolatedTestDatabase — non-Neon paths", () => {
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
  it("checks the direct dev server instead of the HTML-rewriting proxy", async () => {
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      neonAuthBaseUrl: "https://auth",
      cookieSecret: "secret",
    });
    mocks.runningApps.set(1, {
      processId: 42,
      originalUrl: "http://localhost:32100",
      proxyUrl: "http://localhost:42100",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === "http://localhost:32100") {
          return new Response("ok");
        }
        throw new Error(`Proxy response could not be parsed: ${url}`);
      });
    try {
      const prepared = await prepareIsolatedTestDatabase({
        app: makeApp({ neonProjectId: "proj-1" }),
        event,
        emit,
        runtimeMode: "host",
      });

      expect(prepared.infraError).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:32100",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fetchSpy).not.toHaveBeenCalledWith(
        "http://localhost:42100",
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("creates a branch, swaps env, restarts, and reports neon-branch", async () => {
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      neonAuthBaseUrl: "https://auth",
      cookieSecret: "secret",
    });
    // Server comes up immediately.
    mocks.runningApps.set(1, { proxyUrl: "http://localhost:42100" });
    // try/finally so a failing assertion can't leak the mocked fetch into
    // other tests (vi.clearAllMocks in beforeEach doesn't restore spies).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    try {
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
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the branch tracked when restoring .env.local fails", async () => {
    mocks.readEnvFileIfExists.mockResolvedValue("POSTGRES_URL=real\n");
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      neonAuthBaseUrl: "https://auth",
      cookieSecret: "secret",
    });
    mocks.runningApps.set(1, { proxyUrl: "http://localhost:42100" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    try {
      const prepared = await prepareIsolatedTestDatabase({
        app: makeApp({ neonProjectId: "proj-1" }),
        event,
        emit,
        runtimeMode: "host",
      });

      mocks.deleteTempTestBranch.mockClear();
      mocks.executeApp.mockClear();
      emit.mockClear();

      await prepared.teardown();

      expect(mocks.executeApp).not.toHaveBeenCalled();
      expect(mocks.deleteTempTestBranch).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        expect.stringMatching(/temporary Neon branch was kept tracked/i),
        "setup",
      );
    } finally {
      fetchSpy.mockRestore();
    }
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
    // Branch creation failed before the env was swapped, so there is nothing to
    // restore — teardown correctly skips the restart (no executeApp call).
    expect(mocks.executeApp).not.toHaveBeenCalled();
  });
});

describe("prepareIsolatedTestDatabase — auth provisioning", () => {
  function withServerUp() {
    mocks.runningApps.set(1, { proxyUrl: "http://localhost:42100" });
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
  }

  it("provisions a Neon Better Auth account when the branch has auth", async () => {
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      neonAuthBaseUrl: "https://auth",
      cookieSecret: "secret",
    });
    const fetchSpy = withServerUp();
    try {
      const prepared = await prepareIsolatedTestDatabase({
        app: makeApp({ neonProjectId: "proj-1" }),
        event,
        emit,
        runtimeMode: "host",
      });

      expect(mocks.createNeonTestAccount).toHaveBeenCalledWith({
        neonAuthBaseUrl: "https://auth",
        appId: 1,
      });
      expect(prepared.testCredentials).toEqual({
        DYAD_TEST_USER_EMAIL: "neon-test@dyad.test",
        DYAD_TEST_USER_PASSWORD: "neon-pw",
      });
      expect(prepared.authSetup).toEqual({
        mode: "neon-better-auth",
        email: "neon-test@dyad.test",
        password: "neon-pw",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("continues unauthenticated when Neon account provisioning fails", async () => {
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      neonAuthBaseUrl: "https://auth",
      cookieSecret: "secret",
    });
    mocks.createNeonTestAccount.mockRejectedValue(new Error("signup blocked"));
    const fetchSpy = withServerUp();
    try {
      const prepared = await prepareIsolatedTestDatabase({
        app: makeApp({ neonProjectId: "proj-1" }),
        event,
        emit,
        runtimeMode: "host",
      });

      // Still isolated (never dead-ends on best-effort auth), just no auth.
      expect(prepared.isolation).toEqual({ mode: "neon-branch" });
      expect(prepared.infraError).toBeUndefined();
      expect(prepared.testCredentials).toBeUndefined();
      expect(prepared.authSetup).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("skips account provisioning for a Neon app without Neon Auth", async () => {
    mocks.createTempTestBranch.mockResolvedValue({
      branchId: "test-br",
      databaseUrl: "postgres://temp",
      // No neonAuthBaseUrl → the app doesn't use Neon Auth.
    });
    const fetchSpy = withServerUp();
    try {
      const prepared = await prepareIsolatedTestDatabase({
        app: makeApp({ neonProjectId: "proj-1" }),
        event,
        emit,
        runtimeMode: "host",
      });

      expect(mocks.createNeonTestAccount).not.toHaveBeenCalled();
      expect(prepared.authSetup).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("includes the Supabase anon key and authSetup when it can be fetched", async () => {
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({
        supabaseProjectId: "sb-1",
        supabaseOrganizationSlug: "org-1",
      }),
      event,
      emit,
      runtimeMode: "host",
    });

    expect(mocks.getPublishableKey).toHaveBeenCalledWith({
      projectId: "sb-1",
      organizationSlug: "org-1",
    });
    expect(prepared.testCredentials).toMatchObject({
      DYAD_TEST_SUPABASE_ANON_KEY: "anon-key-123",
    });
    expect(prepared.authSetup).toEqual({
      mode: "supabase-password",
      email: "dyad-test+1@dyad.test",
      password: "pw",
      projectUrl: "https://sb-1.supabase.co",
      anonKey: "anon-key-123",
    });
  });

  it("continues unauthenticated when the Supabase anon key can't be fetched", async () => {
    mocks.getPublishableKey.mockRejectedValue(new Error("no key"));
    const prepared = await prepareIsolatedTestDatabase({
      app: makeApp({
        supabaseProjectId: "sb-1",
        supabaseOrganizationSlug: "org-1",
      }),
      event,
      emit,
      runtimeMode: "host",
    });

    // Still isolated via the test user; just no programmatic sign-in.
    expect(prepared.isolation.mode).toBe("supabase-test-user");
    expect(prepared.authSetup).toBeUndefined();
    expect(prepared.testCredentials).not.toHaveProperty(
      "DYAD_TEST_SUPABASE_ANON_KEY",
    );
    expect(prepared.testCredentials).toMatchObject({
      DYAD_TEST_USER_EMAIL: "dyad-test+1@dyad.test",
    });
  });
});
