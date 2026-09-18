import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  neon: vi.fn(),
  testBuild: false,
}));
vi.mock("@neondatabase/serverless", () => ({ neon: mocks.neon }));
vi.mock("./test_utils", () => ({
  get IS_TEST_BUILD() {
    return mocks.testBuild;
  },
}));

import { clearNeonTestData } from "./neon_test_data";

beforeEach(() => {
  mocks.query.mockReset();
  mocks.neon.mockReset().mockReturnValue({ query: mocks.query });
  mocks.testBuild = false;
});

describe("clearNeonTestData", () => {
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

    expect(mocks.neon).toHaveBeenCalledWith("postgres://temporary");
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
