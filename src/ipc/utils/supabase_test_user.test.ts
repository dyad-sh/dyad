import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const selectWhere = vi.fn().mockResolvedValue([]);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { update, select },
    update,
    set,
    where,
    select,
    from,
    selectWhere,
    getProjectApiKeys: vi
      .fn()
      .mockResolvedValue([{ type: "secret", api_key: "service-role-key" }]),
    executeSupabaseSql: vi.fn().mockResolvedValue("[]"),
  };
});

vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("../../db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => ({
  apps: { id: "id", supabaseTestUserId: "stu" },
}));
vi.mock("../../db/schema", () => ({
  apps: { id: "id", supabaseTestUserId: "stu" },
}));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn((a, b) => ({ a, b })), isNotNull: vi.fn() };
});
vi.mock("@/ipc/utils/test_utils", () => ({ IS_TEST_BUILD: false }));
vi.mock("@/ipc/utils/retryWithRateLimit", () => ({
  retryWithRateLimit: vi.fn((op: () => Promise<unknown>) => op()),
}));
vi.mock("../../supabase_admin/supabase_management_client", () => ({
  getSupabaseClientForOrganization: vi.fn(async () => ({
    getProjectApiKeys: mocks.getProjectApiKeys,
  })),
  executeSupabaseSql: mocks.executeSupabaseSql,
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
  checkRls,
  createTempTestUser,
  deleteTempTestUser,
  reconcileOrphanTestUsers,
} from "./supabase_test_user";

type AppRow = any;

const UUID = "00000000-0000-4000-8000-000000000000";

function makeApp(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: 7,
    path: "/apps/7",
    supabaseProjectId: "proj-1",
    supabaseOrganizationSlug: "org-1",
    supabaseTestUserId: null,
    ...overrides,
  };
}

function mockFetch(impl: (url: string, init?: any) => Response) {
  const spy = vi.fn((url: string, init?: any) =>
    Promise.resolve(impl(url, init)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.where.mockResolvedValue(undefined);
  mocks.selectWhere.mockResolvedValue([]);
  mocks.getProjectApiKeys.mockResolvedValue([
    { type: "secret", api_key: "service-role-key" },
  ]);
  mocks.executeSupabaseSql.mockResolvedValue("[]");
});

describe("createTempTestUser", () => {
  it("creates a confirmed admin user and persists the id immediately", async () => {
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: UUID })),
    );

    const result = await createTempTestUser(makeApp());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://proj-1.supabase.co/auth/v1/admin/users");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer service-role-key");
    const body = JSON.parse(init.body);
    expect(body.email_confirm).toBe(true);
    expect(body.app_metadata).toMatchObject({ dyad_test: true });

    expect(result).toMatchObject({
      userId: UUID,
      projectUrl: "https://proj-1.supabase.co",
    });
    expect(result.email).toMatch(/^dyad-test\+7-\d+@dyad\.test$/);
    // Persists the in-flight user id for crash reconciliation.
    expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: UUID });
  });

  it("dead-ends when prior user cleanup fails", async () => {
    const PRIOR = "11111111-1111-4111-8111-111111111111";
    // The prior leaked user's DELETE fails. The column must keep pointing at
    // the prior user, and the run must stop before creating an untracked user.
    const fetchSpy = mockFetch((_url, init) =>
      init?.method === "DELETE"
        ? new Response("nope", { status: 500 })
        : new Response(JSON.stringify({ id: UUID })),
    );

    await expect(
      createTempTestUser(makeApp({ supabaseTestUserId: PRIOR })),
    ).rejects.toThrow(/previous Supabase test user/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalledWith({ supabaseTestUserId: UUID });
  });

  it("deletes a newly-created user if persisting its id fails", async () => {
    mocks.where.mockRejectedValueOnce(new Error("sqlite locked"));
    const fetchSpy = mockFetch((_url, init) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 200 })
        : new Response(JSON.stringify({ id: UUID })),
    );

    await expect(createTempTestUser(makeApp())).rejects.toThrow(
      /sqlite locked/,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://proj-1.supabase.co/auth/v1/admin/users/${UUID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws when the app has no Supabase project", async () => {
    await expect(
      createTempTestUser(makeApp({ supabaseProjectId: null })),
    ).rejects.toThrow(/not connected to a Supabase project/);
  });

  it("throws when the app has no Supabase organization", async () => {
    await expect(
      createTempTestUser(makeApp({ supabaseOrganizationSlug: null })),
    ).rejects.toThrow(/not connected to a Supabase organization/);
  });

  it("throws when no service_role key is available", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: UUID })));
    mocks.getProjectApiKeys.mockResolvedValue([
      { type: "publishable", api_key: "anon" },
    ]);
    await expect(createTempTestUser(makeApp())).rejects.toThrow(
      /service_role key/,
    );
  });
});

describe("deleteTempTestUser", () => {
  it("sweeps owned rows, deletes the user, and clears the column on success", async () => {
    // Discover query returns one owner column; subsequent DELETEs return ok.
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("information_schema.columns")) {
          return JSON.stringify([
            { table_name: "todos", column_name: "user_id" },
          ]);
        }
        return "{}";
      },
    );
    const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));

    await deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }));

    // Scoped DELETE ran against the discovered table/column. The cleanup SQL is
    // a `DO $dyad_cleanup$ ... EXECUTE format('DELETE FROM ...') ...` block, so match on
    // the DELETE substring rather than the statement prefix.
    const deleteCall = mocks.executeSupabaseSql.mock.calls.find(([arg]) =>
      arg.query.includes("DELETE FROM"),
    );
    expect(deleteCall?.[0].query).toContain("public.%I");
    expect(deleteCall?.[0].query).toContain(`'todos'`);
    expect(deleteCall?.[0].query).toContain(`'user_id'`);
    expect(deleteCall?.[0].query).toContain(`'${UUID}'`);
    expect(deleteCall?.[0].query).toContain("DO $dyad_cleanup$");

    // User deleted via the admin API, then column cleared.
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://proj-1.supabase.co/auth/v1/admin/users/${UUID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: null });
  });

  it("does not clear the column when the user delete fails", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    await deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }));
    expect(mocks.set).not.toHaveBeenCalledWith({ supabaseTestUserId: null });
  });

  it("skips owner cleanup rows with unsafe table or column names", async () => {
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("information_schema.columns")) {
          return JSON.stringify([
            { table_name: "todos;drop", column_name: "user_id" },
            { table_name: "todos", column_name: "user$id" },
            { table_name: "safe_table", column_name: "owner_id" },
          ]);
        }
        return "{}";
      },
    );
    mockFetch(() => new Response(null, { status: 200 }));

    await deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }));

    const deleteCalls = mocks.executeSupabaseSql.mock.calls.filter(([arg]) =>
      arg.query.includes("DELETE FROM"),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0].query).toContain("'safe_table'");
    expect(deleteCalls[0][0].query).toContain("'owner_id'");
  });

  it("does not run SQL cleanup for a non-UUID user id", async () => {
    const fetchSpy = mockFetch(() => new Response(null));

    await deleteTempTestUser(makeApp({ supabaseTestUserId: "abc' OR true" }));

    expect(mocks.executeSupabaseSql).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when no test user is set", async () => {
    const fetchSpy = mockFetch(() => new Response(null));
    await deleteTempTestUser(makeApp({ supabaseTestUserId: null }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("reconcileOrphanTestUsers", () => {
  it("deletes orphaned users found at startup", async () => {
    mocks.selectWhere.mockResolvedValue([
      makeApp({ supabaseTestUserId: UUID }),
    ]);
    const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));
    await reconcileOrphanTestUsers();
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://proj-1.supabase.co/auth/v1/admin/users/${UUID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("continues reconciling other orphaned users when one delete throws", async () => {
    const first = makeApp({ id: 1, supabaseTestUserId: UUID });
    const secondId = "11111111-1111-4111-8111-111111111111";
    const second = makeApp({ id: 2, supabaseTestUserId: secondId });
    mocks.selectWhere.mockResolvedValue([first, second]);
    mocks.where.mockRejectedValueOnce(new Error("db write failed"));
    const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));

    await reconcileOrphanTestUsers();

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://proj-1.supabase.co/auth/v1/admin/users/${secondId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("never throws when the query fails", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("db down"));
    await expect(reconcileOrphanTestUsers()).resolves.toBeUndefined();
  });
});

describe("checkRls", () => {
  it("reports tables without RLS", async () => {
    mocks.executeSupabaseSql.mockResolvedValue(
      JSON.stringify([
        { table_name: "todos", rls_enabled: true },
        { table_name: "posts", rls_enabled: false },
      ]),
    );
    const result = await checkRls({
      projectId: "proj-1",
      organizationSlug: "org-1",
    });
    expect(result.tablesWithoutRls).toEqual(["posts"]);
    expect(result.unverified).toBeUndefined();
  });

  it("marks the result unverified when the response can't be parsed", async () => {
    mocks.executeSupabaseSql.mockResolvedValue("not-json");
    const result = await checkRls({
      projectId: "proj-1",
      organizationSlug: "org-1",
    });
    expect(result.unverified).toBe(true);
    expect(result.tablesWithoutRls).toEqual([]);
  });
});
