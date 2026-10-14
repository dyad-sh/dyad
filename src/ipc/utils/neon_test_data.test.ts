import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  neon: vi.fn(),
  testBuild: false,
  listProjectBranchEndpoints: vi.fn(),
}));
vi.mock("@neondatabase/serverless", () => ({ neon: mocks.neon }));
vi.mock("../../neon_admin/neon_management_client", () => ({
  getNeonClient: async () => ({
    listProjectBranchEndpoints: mocks.listProjectBranchEndpoints,
  }),
}));
vi.mock("./test_utils", () => ({
  get IS_TEST_BUILD() {
    return mocks.testBuild;
  },
}));

vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn() }) },
}));

import { createNeonTestDataCleaner } from "./neon_test_data";

const target = {
  databaseUrl: "postgres://temporary",
  projectId: "project",
  branchId: "test-branch",
  protectedBranchIds: ["real-branch"],
};
async function clearNeonTestData(databaseUrl: string) {
  const clear = await createNeonTestDataCleaner({ ...target, databaseUrl });
  await clear();
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.neon.mockReset().mockReturnValue({ query: mocks.query });
  mocks.testBuild = false;
  mocks.listProjectBranchEndpoints.mockReset().mockResolvedValue({
    data: { endpoints: [{ host: "temporary", branch_id: "test-branch" }] },
  });
});

describe("clearNeonTestData", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["discovery", "truncate"])(
    "retries a wrapped connection error during %s",
    async (phase) => {
      vi.useFakeTimers();
      const error = Object.assign(
        new Error("Error connecting to database: fetch failed"),
        {
          sourceError: new TypeError("fetch failed", {
            cause: Object.assign(new Error("socket hang up"), {
              code: "ECONNRESET",
            }),
          }),
        },
      );
      const tables = [{ schema_name: "public", table_name: "todos" }];
      if (phase === "truncate") mocks.query.mockResolvedValueOnce(tables);
      mocks.query
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(tables)
        .mockResolvedValueOnce([]);
      const clearing = clearNeonTestData(target.databaseUrl);
      await vi.runAllTimersAsync();
      await expect(clearing).resolves.toBeUndefined();
      expect(mocks.query).toHaveBeenCalledTimes(phase === "truncate" ? 4 : 3);
      expect(mocks.query).toHaveBeenLastCalledWith(
        'TRUNCATE TABLE "public"."todos" RESTART IDENTITY RESTRICT',
      );
      expect(mocks.listProjectBranchEndpoints).toHaveBeenCalledTimes(1);
    },
  );

  it("propagates exhausted network retries so the next case stays blocked", async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error("Error connecting to database"), {
      sourceError: new TypeError("fetch failed"),
    });
    mocks.query.mockRejectedValue(error);
    const rejected = expect(clearNeonTestData(target.databaseUrl)).rejects.toBe(
      error,
    );
    await vi.runAllTimersAsync();
    await rejected;
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });

  it("preserves cancellation from the Neon driver without retrying", async () => {
    const controller = new AbortController();
    const reason = new Error("Test case lifecycle is closing.");
    const clear = await createNeonTestDataCleaner(target);
    mocks.query.mockImplementation(async () => {
      controller.abort(reason);
      throw Object.assign(new Error("Error connecting to database"), {
        sourceError: reason,
      });
    });
    await expect(clear(controller.signal)).rejects.toBe(reason);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("preserves Neon Auth configuration and signing keys while clearing auth and application data", async () => {
    // The managed schema from the affected app: project_config and jwks live
    // alongside ordinary Better Auth records, so truncating the whole schema
    // made the next signup fail with 'Project config not found'.
    const authTables = [
      "account",
      "invitation",
      "member",
      "organization",
      "session",
      "user",
      "verification",
    ];
    mocks.query
      .mockResolvedValueOnce([
        ...authTables.map((table_name) => ({
          schema_name: "neon_auth",
          table_name,
        })),
        { schema_name: "neon_auth", table_name: "project_config" },
        { schema_name: "neon_auth", table_name: "jwks" },
        { schema_name: "public", table_name: "todos" },
        { schema_name: "auth", table_name: "users" },
        { schema_name: "custom", table_name: "project_config" },
        { schema_name: "custom", table_name: "jwks" },
      ])
      .mockResolvedValueOnce([]);

    await clearNeonTestData("postgres://temporary");

    expect(mocks.neon).toHaveBeenCalledWith(
      "postgres://temporary",
      expect.anything(),
    );
    const cleanup = mocks.query.mock.calls[1][0];
    expect(cleanup).not.toContain('"neon_auth"."project_config"');
    expect(cleanup).not.toContain('"neon_auth"."jwks"');
    for (const table of authTables)
      expect(cleanup).toContain(`"neon_auth"."${table}"`);
    for (const table of [
      '"public"."todos"',
      '"auth"."users"',
      '"custom"."project_config"',
      '"custom"."jwks"',
    ])
      expect(cleanup).toContain(table);
    // CASCADE could still erase excluded configuration through a foreign key.
    expect(cleanup).toMatch(/^TRUNCATE TABLE .+ RESTART IDENTITY RESTRICT$/);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("does nothing when only managed configuration tables exist", async () => {
    mocks.query.mockResolvedValueOnce([
      { schema_name: "neon_auth", table_name: "project_config" },
      { schema_name: "neon_auth", table_name: "jwks" },
    ]);
    await clearNeonTestData("postgres://temporary");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("preserves extension data and migration bookkeeping", async () => {
    mocks.query
      .mockResolvedValueOnce([
        {
          schema_name: "public",
          table_name: "spatial_ref_sys",
          extension_owned: true,
        },
        { schema_name: "drizzle", table_name: "custom_history" },
        { schema_name: "supabase_migrations", table_name: "schema_migrations" },
        { schema_name: "public", table_name: "__drizzle_migrations" },
        { schema_name: "public", table_name: "_prisma_migrations" },
        { schema_name: "public", table_name: "todos", extension_owned: false },
      ])
      .mockResolvedValueOnce([]);
    await clearNeonTestData(target.databaseUrl);
    expect(mocks.query.mock.calls[1][0]).toBe(
      'TRUNCATE TABLE "public"."todos" RESTART IDENTITY RESTRICT',
    );
    expect(mocks.query.mock.calls[0][0]).toContain("d.deptype = 'e'");
  });

  it.each([
    { branchId: "real-branch" },
    { databaseUrl: "postgres://production" },
    { branchId: "different-branch" },
  ])(
    "refuses unsafe database targets before any SQL (%j)",
    async (override) => {
      await expect(
        createNeonTestDataCleaner({ ...target, ...override }),
      ).rejects.toThrow("Refusing to clear");
      expect(mocks.neon).not.toHaveBeenCalled();
    },
  );

  it("validates once per run and forwards cancellation to SQL requests", async () => {
    const clear = await createNeonTestDataCleaner(target);
    mocks.query.mockResolvedValue([]);
    const signal = new AbortController().signal;
    await clear(signal);
    await clear(signal);
    expect(mocks.listProjectBranchEndpoints).toHaveBeenCalledTimes(1);
    expect(mocks.neon).toHaveBeenCalledWith(target.databaseUrl, {
      fetchOptions: { signal },
    });
  });

  it("accepts the pooler hostname of the verified temporary endpoint", async () => {
    mocks.listProjectBranchEndpoints.mockResolvedValue({
      data: {
        endpoints: [
          { host: "ep-test.region.neon.tech", branch_id: target.branchId },
        ],
      },
    });
    mocks.query.mockResolvedValue([]);
    const clear = await createNeonTestDataCleaner({
      ...target,
      databaseUrl:
        "postgres://user:password@ep-test-pooler.region.neon.tech/database",
    });
    await clear();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("quotes discovered identifiers and discovers new tables on the next cleanup", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { schema_name: 'custom"schema', table_name: 'table"; --' },
      ])
      .mockResolvedValueOnce([]);
    await clearNeonTestData("postgres://temporary");
    expect(mocks.query.mock.calls[1][0]).toBe(
      'TRUNCATE TABLE "custom""schema"."table""; --" RESTART IDENTITY RESTRICT',
    );
    mocks.query
      .mockResolvedValueOnce([
        { schema_name: "later", table_name: "new_table" },
      ])
      .mockResolvedValueOnce([]);
    await clearNeonTestData("postgres://temporary");
    expect(mocks.query.mock.calls[3][0]).toBe(
      'TRUNCATE TABLE "later"."new_table" RESTART IDENTITY RESTRICT',
    );
  });

  it("propagates a cleanup failure so another case cannot run with dirty data", async () => {
    mocks.query
      .mockResolvedValueOnce([{ schema_name: "neon_auth", table_name: "user" }])
      .mockRejectedValueOnce(new Error("preserved table references user"));
    await expect(clearNeonTestData("postgres://temporary")).rejects.toThrow(
      "preserved table references user",
    );
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("skips database access for Dyad's fake-provider E2E build", async () => {
    mocks.testBuild = true;
    await clearNeonTestData("postgres://fake");
    expect(mocks.neon).not.toHaveBeenCalled();
  });
});
