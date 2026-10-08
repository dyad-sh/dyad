import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    getProjectApiKeys: vi.fn(),
    executeSupabaseSql: vi.fn().mockResolvedValue("[]"),
    warn: vi.fn(),
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
  // Pass through to global fetch (no retry) so the per-test fetch spies still
  // observe the admin API calls.
  fetchWithRetry: vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
  ),
}));
vi.mock("../../supabase_admin/supabase_management_client", () => ({
  getProjectApiKeys: mocks.getProjectApiKeys,
  executeSupabaseSql: mocks.executeSupabaseSql,
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: mocks.warn,
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  checkRls,
  createTempTestUser,
  deleteTempTestUser,
  getServiceRoleKey,
  reconcileOrphanTestUsers,
} from "./supabase_test_user";
import { DyadErrorKind } from "@/errors/dyad_error";
import { SupabaseTestUserCreationRejectedError } from "./supabase_test_user_errors";

type AppRow = any;

const UUID = "00000000-0000-4000-8000-000000000000";
const SECRET_KEY = "sb_secret_xyz789";

// What a migrated project actually returns: the legacy pair is still listed
// after it's been disabled in the dashboard, alongside the new-format keys.
const PROJECT_API_KEYS = [
  { name: "anon", type: "legacy", api_key: "eyJhbGciOiJIUzI1NiJ9.legacy-anon" },
  {
    name: "service_role",
    type: "legacy",
    api_key: "eyJhbGciOiJIUzI1NiJ9.legacy-service-role",
  },
  { name: "default", type: "publishable", api_key: "sb_publishable_abc123" },
  { name: "default", type: "secret", api_key: SECRET_KEY },
];

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
  mocks.getProjectApiKeys.mockResolvedValue(PROJECT_API_KEYS);
  mocks.executeSupabaseSql.mockResolvedValue("[]");
});

describe("createTempTestUser", () => {
  const databaseCreateError = {
    code: 500,
    error_code: "unexpected_failure",
    msg: "Database error creating new user",
  };
  // Actual HTTP 500 response from the organization-required signup trigger.
  const constraintCreateError = {
    code: "23514",
    message: "organization_id is required to create a user",
  };

  it.each([
    databaseCreateError,
    {
      code: "unexpected_failure",
      message: "Database error creating new user",
    },
    constraintCreateError,
    ...["23000", "23001", "23502", "23503", "23505", "23P01", "P0001"].map(
      (code) => ({ code, message: "Fixture prerequisite failed" }),
    ),
    { code: 500, error_code: "23514", msg: "Fixture prerequisite failed" },
  ])(
    "classifies a database-create rejection only after verifying no user exists (%j)",
    async (body) => {
      const request = mockFetch(
        () => new Response(JSON.stringify(body), { status: 500 }),
      );
      mocks.executeSupabaseSql.mockResolvedValueOnce('[{"user_exists":false}]');
      const controller = new AbortController();

      await expect(
        createTempTestUser(makeApp(), { signal: controller.signal }),
      ).rejects.toBeInstanceOf(SupabaseTestUserCreationRejectedError);

      const { email } = JSON.parse(request.mock.calls[0][1].body);
      expect(mocks.executeSupabaseSql).toHaveBeenCalledWith({
        supabaseProjectId: "proj-1",
        organizationSlug: "org-1",
        query: `SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = '${email}') AS user_exists;`,
        signal: controller.signal,
      });
      expect(mocks.set).not.toHaveBeenCalled();
    },
  );

  it.each<[number, string]>([
    [401, JSON.stringify(databaseCreateError)],
    [403, JSON.stringify(databaseCreateError)],
    [503, JSON.stringify(databaseCreateError)],
    [403, JSON.stringify(constraintCreateError)],
    [503, JSON.stringify(constraintCreateError)],
    [500, "Database error creating new user"],
    [
      500,
      JSON.stringify({
        ...databaseCreateError,
        msg: "Database error checking email",
      }),
    ],
    [
      500,
      JSON.stringify({ ...databaseCreateError, error_code: "request_timeout" }),
    ],
    [500, JSON.stringify({ msg: "Database error creating new user" })],
    [500, "null"],
    ...[
      "08006",
      "57014",
      "40003",
      "XX000",
      "42501",
      "28P01",
      "P0000",
      "23",
      "23514-extra",
      23514,
    ].map((code): [number, string] => [
      500,
      JSON.stringify({ ...constraintCreateError, code }),
    ]),
  ])(
    "keeps unrelated or unknown HTTP failures fatal (%s, %s)",
    async (status, body) => {
      mockFetch(() => new Response(body, { status }));
      const error = await createTempTestUser(makeApp()).catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SupabaseTestUserCreationRejectedError);
      expect(mocks.executeSupabaseSql).not.toHaveBeenCalled();
    },
  );

  it.each([
    '[{"user_exists":true}]',
    "[]",
    "{}",
    '[{"user_exists":"false"}]',
    "invalid",
  ])(
    "does not allow fallback without a confirmed absent user (%s)",
    async (result) => {
      mockFetch(
        () =>
          new Response(JSON.stringify(constraintCreateError), { status: 500 }),
      );
      mocks.executeSupabaseSql.mockResolvedValueOnce(result);
      const error = await createTempTestUser(makeApp()).catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SupabaseTestUserCreationRejectedError);
    },
  );

  it("propagates verification failures", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify(constraintCreateError), { status: 500 }),
    );
    const error = new Error("verification unavailable");
    mocks.executeSupabaseSql.mockRejectedValueOnce(error);
    await expect(createTempTestUser(makeApp())).rejects.toBe(error);
  });

  it("honors cancellation while verifying a database-create rejection", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify(constraintCreateError), { status: 500 }),
    );
    const controller = new AbortController();
    const reason = new Error("cancelled");
    mocks.executeSupabaseSql.mockImplementationOnce(async () => {
      controller.abort(reason);
      return '[{"user_exists":false}]';
    });
    await expect(
      createTempTestUser(makeApp(), { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it.each([
    new TypeError("fetch failed"),
    new DOMException("Request timed out", "TimeoutError"),
  ])(
    "does not treat uncertain network outcomes as rejected creations (%s)",
    async (error) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      await expect(createTempTestUser(makeApp())).rejects.toBe(error);
      expect(mocks.executeSupabaseSql).not.toHaveBeenCalled();
    },
  );

  it("keeps a successful response without a user ID fatal", async () => {
    mockFetch(() => new Response("{}"));
    await expect(createTempTestUser(makeApp())).rejects.toThrow(
      "did not return an id",
    );
    expect(mocks.executeSupabaseSql).not.toHaveBeenCalled();
  });

  it("records a user created while cancellation is draining the request", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise<Response>((resolve) => {
            expect(init.signal).toBeUndefined();
            finish = resolve;
            started();
          }),
      ),
    );
    const creating = createTempTestUser(makeApp(), {
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    finish(new Response(JSON.stringify({ id: UUID })));
    expect((await creating).userId).toBe(UUID);
    expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: UUID });
  });
  it("reuses a run-scoped admin key across every case's create and delete", async () => {
    const adminKey = await getServiceRoleKey({
      projectId: "proj-1",
      organizationSlug: "org-1",
    });
    const fetchSpy = mockFetch(
      (_url, init) =>
        new Response(
          JSON.stringify(init.method === "POST" ? { id: UUID } : {}),
          { status: 200 },
        ),
    );
    for (let index = 0; index < 2; index++) {
      const user = await createTempTestUser(makeApp(), { adminKey });
      await deleteTempTestUser(makeApp({ supabaseTestUserId: user.userId }), {
        adminKey,
      });
    }
    expect(mocks.getProjectApiKeys).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchSpy.mock.calls)
      expect(init.headers.apikey).toBe(SECRET_KEY);
  });
  it("creates a confirmed admin user and persists the id immediately", async () => {
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: UUID })),
    );

    const result = await createTempTestUser(makeApp());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://proj-1.supabase.co/auth/v1/admin/users");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe(SECRET_KEY);
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

  it("throws when no secret or service_role key is available", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: UUID })));
    mocks.getProjectApiKeys.mockResolvedValue([
      { name: "default", type: "publishable", api_key: "sb_publishable_abc" },
    ]);
    await expect(createTempTestUser(makeApp())).rejects.toThrow(
      /No secret key \(or legacy service_role key\)/,
    );
  });

  // Supabase doesn't document the ordering of /api-keys, so the secret key must
  // win on type, never on position. Picking by position is what sent a DISABLED
  // legacy service_role JWT and 401'd every isolated run.
  it.each([
    ["legacy keys first", PROJECT_API_KEYS],
    ["new-format keys first", [...PROJECT_API_KEYS].reverse()],
  ])(
    "authenticates with the new-format secret key when the response lists %s",
    async (_label, keys) => {
      mocks.getProjectApiKeys.mockResolvedValue(keys);
      const fetchSpy = mockFetch(
        () => new Response(JSON.stringify({ id: UUID })),
      );

      await createTempTestUser(makeApp());

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers.apikey).toBe(SECRET_KEY);
      // A new-format secret key is not a JWT. Supabase parses whatever is on
      // Authorization: Bearer as one and rejects the call with "Invalid JWT",
      // so the key has to travel on `apikey` alone.
      expect(init.headers.Authorization).toBeUndefined();
    },
  );

  // `type` is optional on the Management API response. Requiring it alongside
  // the prefix would drop a perfectly good sb_secret_ key straight to the legacy
  // tier, silently un-migrating a project that had already moved.
  it("picks the new-format secret key even when the response omits its type", async () => {
    mocks.getProjectApiKeys.mockResolvedValue([
      { name: "anon", type: "legacy", api_key: "eyJ.legacy-anon" },
      {
        name: "service_role",
        type: "legacy",
        api_key: "eyJ.legacy-service-role",
      },
      { name: "default", api_key: SECRET_KEY },
    ]);
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: UUID })),
    );

    await createTempTestUser(makeApp());

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.apikey).toBe(SECRET_KEY);
    expect(init.headers.Authorization).toBeUndefined();
  });

  // A JWT can never carry the sb_secret_ prefix, so the prefix classifies this
  // on its own. Consulting `type` too could only add false negatives — this
  // shape would lose its bearer header and 401 every Auth Admin call.
  it("still sends the bearer header for a legacy JWT labelled as a secret key", async () => {
    mocks.getProjectApiKeys.mockResolvedValue([
      { name: "anon", type: "legacy", api_key: "eyJ.legacy-anon" },
      {
        name: "service_role",
        type: "secret",
        api_key: "eyJ.legacy-service-role",
      },
    ]);
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: UUID })),
    );

    await createTempTestUser(makeApp());

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.apikey).toBe("eyJ.legacy-service-role");
    expect(init.headers.Authorization).toBe("Bearer eyJ.legacy-service-role");
  });

  it("reveals the secret key value when fetching the project's keys", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: UUID })));

    await createTempTestUser(makeApp());

    // Without reveal, Supabase redacts every secret key value and the legacy
    // JWT is the only usable key left on the project.
    expect(mocks.getProjectApiKeys).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", reveal: true }),
    );
  });

  it("falls back to the legacy service_role key on an unmigrated project", async () => {
    mocks.getProjectApiKeys.mockResolvedValue([
      { name: "anon", type: "legacy", api_key: "eyJ.legacy-anon" },
      {
        name: "service_role",
        type: "legacy",
        api_key: "eyJ.legacy-service-role",
      },
    ]);
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: UUID })),
    );

    await createTempTestUser(makeApp());

    // The legacy service_role key IS a JWT, so it still needs the bearer
    // header — that's what authorizes the admin call on an unmigrated project.
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer eyJ.legacy-service-role");
    expect(init.headers.apikey).toBe("eyJ.legacy-service-role");
  });

  it("explains how to fix a project whose legacy keys are disabled", async () => {
    // Reproduce the precondition the 401 actually needs: the project has no
    // new-format secret key, so pickSecretKey falls back to the legacy
    // service_role JWT — which the project has since disabled. With the
    // default sb_secret_ fixture in place this branch could never fire.
    mocks.getProjectApiKeys.mockResolvedValue([
      { name: "anon", type: "legacy", api_key: "eyJ.legacy-anon" },
      {
        name: "service_role",
        type: "legacy",
        api_key: "eyJ.legacy-service-role",
      },
    ]);
    const fetchSpy = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            message: "Legacy API keys are disabled",
            hint: "Your legacy API keys (anon, service_role) were disabled on 2026-07-19T03:56:05.137208+00:00.",
          }),
          { status: 401 },
        ),
    );

    const error = await createTempTestUser(makeApp()).catch((e) => e);

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.apikey).toBe("eyJ.legacy-service-role");

    expect(error.message).toMatch(/Create a secret key in Supabase/);
    // User-fixable setup problem, not a Dyad failure worth reporting.
    expect(error.kind).toBe(DyadErrorKind.Precondition);
  });
});

describe("deleteTempTestUser", () => {
  afterEach(() => vi.useRealTimers());

  it.each([200, 404])(
    "recovers from a lost deletion response followed by %s",
    async (status) => {
      vi.useFakeTimers();
      const request = vi
        .fn()
        .mockRejectedValueOnce(
          new TypeError("fetch failed", {
            cause: Object.assign(new Error("socket hang up"), {
              code: "ECONNRESET",
            }),
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status }));
      vi.stubGlobal("fetch", request);
      const deleting = deleteTempTestUser(
        makeApp({ supabaseTestUserId: UUID }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.set).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      await expect(deleting).resolves.toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
      expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: null });
    },
  );

  it("retains the test user for recovery when all network retries fail", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", request);
    const deleting = deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }));
    await vi.runAllTimersAsync();
    await expect(deleting).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(4);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    "does not retry an HTTP %s rejection",
    async (status) => {
      const request = mockFetch(() => new Response("rejected", { status }));
      await expect(
        deleteTempTestUser(makeApp({ supabaseTestUserId: UUID })),
      ).resolves.toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
      expect(mocks.set).not.toHaveBeenCalled();
    },
  );

  it("retries network failures in owner discovery and row deletion before deleting the user", async () => {
    vi.useFakeTimers();
    mocks.executeSupabaseSql
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        JSON.stringify([{ table_name: "todos", column_name: "user_id" }]),
      )
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("{}");
    const request = mockFetch(() => new Response(null));
    const deleting = deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await expect(deleting).resolves.toBe(true);
    expect(mocks.executeSupabaseSql).toHaveBeenCalledTimes(4);
    const calls = mocks.executeSupabaseSql.mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[2]).toEqual(calls[3]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: null });
  });

  it("preserves cancellation during deletion without clearing the recovery marker", async () => {
    const controller = new AbortController();
    const reason = new Error("Test case lifecycle is closing.");
    const request = vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", request);
    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }), {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(request).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("sweeps owned rows, deletes the user, and clears the column on success", async () => {
    // Discover query returns one owner column; subsequent DELETEs return ok.
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("FROM pg_class")) {
          return JSON.stringify([
            { table_name: "todos", column_name: "user_id" },
          ]);
        }
        return "{}";
      },
    );
    const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));

    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID })),
    ).resolves.toBe(true);

    // Scoped DELETE ran against the discovered table/column. The cleanup SQL is
    // a `pg_temp.dyad_cleanup()` function wrapping `EXECUTE format('DELETE
    // FROM ...')`, so match on the DELETE substring rather than the prefix.
    const deleteCall = mocks.executeSupabaseSql.mock.calls.find(([arg]) =>
      arg.query.includes("DELETE FROM"),
    );
    expect(deleteCall?.[0].query).toContain("public.%I");
    expect(deleteCall?.[0].query).toContain(`'todos'`);
    expect(deleteCall?.[0].query).toContain(`'user_id'`);
    expect(deleteCall?.[0].query).toContain(`'${UUID}'`);
    expect(deleteCall?.[0].query).toContain("AS $dyad_cleanup$");

    // User deleted via the admin API, then column cleared.
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://proj-1.supabase.co/auth/v1/admin/users/${UUID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: null });
  });

  it("does not clear the column when the user delete fails", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID })),
    ).resolves.toBe(false);
    expect(mocks.set).not.toHaveBeenCalledWith({ supabaseTestUserId: null });
  });

  it("skips owner cleanup rows with unsafe table or column names", async () => {
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("FROM pg_class")) {
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

  it("discovers owner columns on real tables only, never views", async () => {
    mockFetch(() => new Response(null, { status: 200 }));

    await deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }));

    const discoverQuery = mocks.executeSupabaseSql.mock.calls[0][0].query;
    expect(discoverQuery).toContain("c.relkind IN ('r', 'p')");
    expect(discoverQuery).toContain("NOT c.relispartition");
    expect(discoverQuery).not.toContain("information_schema");
  });

  it("sweeps every discovered owner column in one isolated-failure batch", async () => {
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("FROM pg_class")) {
          return JSON.stringify([
            { table_name: "todos", column_name: "user_id" },
            { table_name: "quotes", column_name: "owner_id" },
            { table_name: "notes", column_name: "created_by" },
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
    const batch: string = deleteCalls[0][0].query;
    expect(batch.match(/DELETE FROM/g)).toHaveLength(3);
    // Each DELETE sits in its own exception block so one failing table
    // doesn't roll back the rest.
    expect(batch.match(/EXCEPTION WHEN others/g)).toHaveLength(3);
    for (const [table, column] of [
      ["todos", "user_id"],
      ["quotes", "owner_id"],
      ["notes", "created_by"],
    ]) {
      expect(batch).toContain(`'${table}', '${column}', '${UUID}'`);
    }
  });

  it("logs each per-table failure the batched sweep reports", async () => {
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("FROM pg_class")) {
          return JSON.stringify([
            { table_name: "todos", column_name: "user_id" },
            { table_name: "quotes", column_name: "owner_id" },
          ]);
        }
        return JSON.stringify([
          {
            failures: [
              "public.quotes.owner_id: update or delete on table violates foreign key constraint",
            ],
          },
        ]);
      },
    );
    mockFetch(() => new Response(null, { status: 200 }));

    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID })),
    ).resolves.toBe(true);

    const batch = mocks.executeSupabaseSql.mock.calls.find(([arg]) =>
      arg.query.includes("DELETE FROM"),
    )?.[0].query;
    expect(batch).toContain(
      "CREATE OR REPLACE FUNCTION pg_temp.dyad_cleanup()",
    );
    expect(batch).toContain(
      "failures := failures || ('public.quotes.owner_id: '",
    );
    expect(batch).toContain("SELECT pg_temp.dyad_cleanup() AS failures;");
    expect(mocks.warn).toHaveBeenCalledWith(
      "Best-effort cleanup for test user failed: public.quotes.owner_id: update or delete on table violates foreign key constraint",
    );
    // A committed batch is never rerun per table.
    expect(
      mocks.executeSupabaseSql.mock.calls.filter(([arg]) =>
        arg.query.includes("DELETE FROM"),
      ),
    ).toHaveLength(1);
  });

  it("treats an unexpected batch response as success without per-table detail", async () => {
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) =>
        query.includes("FROM pg_class")
          ? JSON.stringify([{ table_name: "todos", column_name: "user_id" }])
          : "not-json",
    );
    mockFetch(() => new Response(null, { status: 200 }));

    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID })),
    ).resolves.toBe(true);
    expect(
      mocks.executeSupabaseSql.mock.calls.filter(([arg]) =>
        arg.query.includes("DELETE FROM"),
      ),
    ).toHaveLength(1);
    expect(mocks.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Best-effort cleanup"),
    );
  });

  it("falls back to per-table deletes when the batch is rolled back", async () => {
    // A statement timeout cancels the whole DO block (`WHEN others` doesn't
    // catch QUERY_CANCELED), undoing deletes that had already succeeded.
    const queries: string[] = [];
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        queries.push(query);
        if (query.includes("FROM pg_class")) {
          return JSON.stringify([
            { table_name: "todos", column_name: "user_id" },
            { table_name: "quotes", column_name: "owner_id" },
          ]);
        }
        if (query.includes("EXCEPTION WHEN others")) {
          throw new Error(
            "Bad Request (400): canceling statement due to statement timeout",
          );
        }
        if (query.includes("'quotes'")) {
          throw new Error("Bad Request (400): violates foreign key");
        }
        return "{}";
      },
    );
    const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));

    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID })),
    ).resolves.toBe(true);

    const perTable = queries.filter(
      (query) =>
        query.includes("DELETE FROM") &&
        !query.includes("EXCEPTION WHEN others"),
    );
    expect(perTable).toHaveLength(2);
    expect(perTable[0]).toContain("'todos', 'user_id'");
    expect(perTable[1]).toContain("'quotes', 'owner_id'");
    // Per-table cleanup is still best-effort: one failing table doesn't stop
    // the user delete.
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://proj-1.supabase.co/auth/v1/admin/users/${UUID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.set).toHaveBeenCalledWith({ supabaseTestUserId: null });
  });

  it("keeps the recovery marker when the fallback outruns the lifecycle budget", async () => {
    const controller = new AbortController();
    const reason = new Error("Isolated test data operation timed out.");
    mocks.executeSupabaseSql.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query.includes("FROM pg_class")) {
          return JSON.stringify([
            { table_name: "todos", column_name: "user_id" },
            { table_name: "quotes", column_name: "owner_id" },
          ]);
        }
        if (query.includes("EXCEPTION WHEN others")) {
          throw new Error("canceling statement due to statement timeout");
        }
        controller.abort(reason);
        throw new Error("canceling statement due to statement timeout");
      },
    );
    const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));

    await expect(
      deleteTempTestUser(makeApp({ supabaseTestUserId: UUID }), {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
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
