import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    db: { update },
    update,
    set,
    where,
    generateCookieSecret: vi.fn(() => "generated".padEnd(64, "0")),
    readEnvVarsOrEmpty: vi.fn(),
  };
});

vi.mock("@/db", () => ({
  db: mocks.db,
}));

vi.mock("@/db/schema", () => ({
  apps: { id: "id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((a, b) => ({ a, b })),
  };
});

vi.mock("@/ipc/utils/app_env_var_utils", () => ({
  generateCookieSecret: mocks.generateCookieSecret,
  readEnvVarsOrEmpty: mocks.readEnvVarsOrEmpty,
  updateNeonEnvVars: vi.fn(),
}));

vi.mock("@/neon_admin/neon_management_client", () => ({
  getNeonClient: vi.fn(),
}));

vi.mock("@/neon_admin/neon_context", () => ({
  getConnectionUri: vi.fn(),
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

import {
  getOrCreateNeonAuthCookieSecret,
  syncActiveNeonAuthCookieSecretFromEnv,
} from "@/ipc/utils/neon_utils";

type AppRow = {
  id: number;
  path: string;
  neonProjectId: string | null;
  neonDevelopmentBranchId: string | null;
  neonPreviewBranchId: string | null;
  neonActiveBranchId: string | null;
  neonProductionAuthCookieSecret: string | null;
  neonDevelopmentAuthCookieSecret: string | null;
};

function makeApp(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: 1,
    path: "my-app",
    neonProjectId: "proj-1",
    neonDevelopmentBranchId: "br-dev",
    neonPreviewBranchId: "br-preview",
    neonActiveBranchId: "br-dev",
    neonProductionAuthCookieSecret: null,
    neonDevelopmentAuthCookieSecret: null,
    ...overrides,
  };
}

describe("getOrCreateNeonAuthCookieSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the persisted production secret without DB write or env read", async () => {
    const appData = makeApp({
      neonProductionAuthCookieSecret: "persisted-prod",
      neonActiveBranchId: "br-prod",
    });

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "production",
    });

    expect(result).toBe("persisted-prod");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.readEnvVarsOrEmpty).not.toHaveBeenCalled();
    expect(mocks.generateCookieSecret).not.toHaveBeenCalled();
  });

  it("returns the persisted development secret without DB write or env read", async () => {
    const appData = makeApp({
      neonDevelopmentAuthCookieSecret: "persisted-dev",
    });

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "development",
    });

    expect(result).toBe("persisted-dev");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.readEnvVarsOrEmpty).not.toHaveBeenCalled();
  });

  it("adopts the existing .env.local secret when querying the active dev branch and persists it", async () => {
    const appData = makeApp({
      neonDevelopmentAuthCookieSecret: null,
      neonActiveBranchId: "br-dev",
    });
    mocks.readEnvVarsOrEmpty.mockResolvedValueOnce([
      { key: "NEON_AUTH_COOKIE_SECRET", value: "adopted-secret" },
    ]);

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "development",
    });

    expect(result).toBe("adopted-secret");
    expect(mocks.readEnvVarsOrEmpty).toHaveBeenCalledWith({
      appPath: "my-app",
    });
    expect(mocks.generateCookieSecret).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith({
      neonDevelopmentAuthCookieSecret: "adopted-secret",
    });
  });

  it("does NOT read .env.local when querying a branch that is not currently active", async () => {
    const appData = makeApp({
      neonProductionAuthCookieSecret: null,
      // dev is active; querying production
      neonActiveBranchId: "br-dev",
    });

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "production",
    });

    expect(mocks.readEnvVarsOrEmpty).not.toHaveBeenCalled();
    expect(mocks.generateCookieSecret).toHaveBeenCalledOnce();
    expect(result).toBe("generated".padEnd(64, "0"));
    expect(mocks.set).toHaveBeenCalledWith({
      neonProductionAuthCookieSecret: "generated".padEnd(64, "0"),
    });
  });

  it("generates fresh when the active branch's env file has no NEON_AUTH_COOKIE_SECRET", async () => {
    const appData = makeApp({
      neonDevelopmentAuthCookieSecret: null,
      neonActiveBranchId: "br-dev",
    });
    mocks.readEnvVarsOrEmpty.mockResolvedValueOnce([
      { key: "DATABASE_URL", value: "postgresql://..." },
    ]);

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "development",
    });

    expect(result).toBe("generated".padEnd(64, "0"));
    expect(mocks.set).toHaveBeenCalledWith({
      neonDevelopmentAuthCookieSecret: "generated".padEnd(64, "0"),
    });
  });

  it("adopts the development env secret when neonActiveBranchId is null but development is the implicit active branch", async () => {
    const appData = makeApp({
      neonDevelopmentAuthCookieSecret: null,
      neonActiveBranchId: null,
    });
    mocks.readEnvVarsOrEmpty.mockResolvedValueOnce([
      { key: "NEON_AUTH_COOKIE_SECRET", value: "legacy-dev-secret" },
    ]);

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "development",
    });

    expect(result).toBe("legacy-dev-secret");
    expect(mocks.readEnvVarsOrEmpty).toHaveBeenCalledWith({
      appPath: "my-app",
    });
    expect(mocks.generateCookieSecret).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith({
      neonDevelopmentAuthCookieSecret: "legacy-dev-secret",
    });
  });

  it("generates fresh when neonActiveBranchId is null and there is no implicit development branch", async () => {
    const appData = makeApp({
      neonDevelopmentBranchId: null,
      neonDevelopmentAuthCookieSecret: null,
      neonActiveBranchId: null,
    });

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "development",
    });

    expect(mocks.readEnvVarsOrEmpty).not.toHaveBeenCalled();
    expect(result).toBe("generated".padEnd(64, "0"));
  });

  it("classifies production as active when activeId is neither dev nor preview", async () => {
    // active is the prod branch id (e.g. some neon default branch id)
    const appData = makeApp({
      neonProductionAuthCookieSecret: null,
      neonActiveBranchId: "br-prod",
    });
    mocks.readEnvVarsOrEmpty.mockResolvedValueOnce([
      { key: "NEON_AUTH_COOKIE_SECRET", value: "adopted-prod" },
    ]);

    const result = await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "production",
    });

    expect(result).toBe("adopted-prod");
    expect(mocks.set).toHaveBeenCalledWith({
      neonProductionAuthCookieSecret: "adopted-prod",
    });
  });

  it("does not treat production as active when active branch is the preview branch", async () => {
    const appData = makeApp({
      neonProductionAuthCookieSecret: null,
      neonActiveBranchId: "br-preview",
    });

    await getOrCreateNeonAuthCookieSecret({
      appData: appData as any,
      branchType: "production",
    });

    expect(mocks.readEnvVarsOrEmpty).not.toHaveBeenCalled();
    expect(mocks.generateCookieSecret).toHaveBeenCalledOnce();
  });
});

describe("syncActiveNeonAuthCookieSecretFromEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the active development branch's current env secret over a stale DB value", async () => {
    const appData = makeApp({
      neonDevelopmentAuthCookieSecret: "stale-generated-secret",
      neonActiveBranchId: "br-dev",
    });
    mocks.readEnvVarsOrEmpty.mockResolvedValueOnce([
      { key: "NEON_AUTH_COOKIE_SECRET", value: "actual-env-secret" },
    ]);

    const result = await syncActiveNeonAuthCookieSecretFromEnv({
      appData: appData as any,
      branchType: "development",
    });

    expect(result).toBe("actual-env-secret");
    expect(mocks.generateCookieSecret).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith({
      neonDevelopmentAuthCookieSecret: "actual-env-secret",
    });
  });

  it("does not write when the requested branch type is not active", async () => {
    const appData = makeApp({
      neonProductionAuthCookieSecret: null,
      neonActiveBranchId: "br-dev",
    });

    const result = await syncActiveNeonAuthCookieSecretFromEnv({
      appData: appData as any,
      branchType: "production",
    });

    expect(result).toBeUndefined();
    expect(mocks.readEnvVarsOrEmpty).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not write when the active env file has no cookie secret", async () => {
    const appData = makeApp({
      neonDevelopmentAuthCookieSecret: null,
      neonActiveBranchId: "br-dev",
    });
    mocks.readEnvVarsOrEmpty.mockResolvedValueOnce([
      { key: "DATABASE_URL", value: "postgresql://..." },
    ]);

    const result = await syncActiveNeonAuthCookieSecretFromEnv({
      appData: appData as any,
      branchType: "development",
    });

    expect(result).toBeUndefined();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
