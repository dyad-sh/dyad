import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectApiKeys,
  runSupabaseQuery,
} from "./supabase_management_client";
import {
  getSupabaseClientCode,
  getSupabaseSelfHostedPromptOptions,
  getSupabaseTableSchema,
} from "./supabase_context";
import { getSupabaseSelfHostedInstanceSummary } from "./supabase_self_hosted_store";
import {
  recordSupabaseSelfHostedFunctionDeploy,
  resetSupabaseSelfHostedFunctionUpdates,
} from "./supabase_self_hosted_function_updates";
import { DyadErrorKind } from "@/errors/dyad_error";

vi.mock(
  "@/supabase_admin/supabase_self_hosted_store",
  () => import("@/testing/supabase_self_hosted_store_cloud_only"),
);

vi.mock("./supabase_management_client", () => ({
  runSupabaseQuery: vi.fn(),
  getProjectApiKeys: vi.fn(),
}));

const runSupabaseQueryMock = vi.mocked(runSupabaseQuery);
const getProjectApiKeysMock = vi.mocked(getProjectApiKeys);

const PUBLISHABLE_KEY = "sb_publishable_abc123";

// What a migrated project actually returns: the legacy pair is still listed
// after it's been disabled in the dashboard, alongside the new-format keys.
const PROJECT_API_KEYS = [
  {
    name: "anon",
    type: "legacy" as const,
    api_key: "eyJhbGciOiJIUzI1NiJ9.anon",
  },
  {
    name: "service_role",
    type: "legacy" as const,
    api_key: "eyJhbGciOiJIUzI1NiJ9.service-role",
  },
  { name: "default", type: "publishable" as const, api_key: PUBLISHABLE_KEY },
  { name: "default", type: "secret" as const, api_key: "sb_secret_xyz789" },
];

const EMPTY_SNAPSHOT = {
  serverVersion: [{ server_version_num: "150000" }],
  schemas: [{ schema_name: "public" }],
  extensions: [],
  enums: [],
  tables: [],
  columns: [],
  checkConstraints: [],
  policies: [],
  tablePrivileges: [],
  indexes: [],
  foreignKeyConstraints: [],
  sequences: [],
  functions: [],
  procedures: [],
  functionDependencies: [],
  triggers: [],
  views: [],
  materializedViews: [],
};

describe("getSupabaseTableSchema", () => {
  beforeEach(() => {
    runSupabaseQueryMock.mockReset();
  });

  it("renders table schema from one Supabase schema snapshot query", async () => {
    runSupabaseQueryMock.mockResolvedValue([
      {
        schema_snapshot: {
          ...EMPTY_SNAPSHOT,
          tables: [
            {
              oid: "123",
              table_name: "users",
              table_schema_name: "public",
              replica_identity: "d",
              rls_enabled: false,
              rls_forced: false,
              parent_table_name: "",
              parent_table_schema_name: "",
              partition_key_def: "",
              partition_for_values: "",
            },
          ],
          columns: [
            {
              table_oid: "123",
              column_name: "id",
              is_not_null: true,
              has_missing_val_optimization: false,
              column_size: 8,
              identity_type: "",
              start_value: null,
              increment_value: null,
              max_value: null,
              min_value: null,
              cache_size: null,
              is_cycle: null,
              collation_name: "",
              collation_schema_name: "",
              default_value: "",
              generation_expression: "",
              is_generated: false,
              column_type: "bigint",
              dependent_func_schema_names: [],
              dependent_func_names: [],
              dependent_func_identity_arguments: [],
            },
          ],
        },
      },
    ]);

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
        tableName: "users",
      }),
    ).resolves.toBe(
      'CREATE SCHEMA "public";\n\nCREATE TABLE "public"."users" (\n\t"id" bigint NOT NULL\n);',
    );

    expect(runSupabaseQueryMock).toHaveBeenCalledTimes(1);
    expect(runSupabaseQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabaseProjectId: "project-id",
        query: expect.stringMatching(
          /snapshot_scope\.table_schema_name IN \('public'\)[\s\S]*snapshot_scope\.table_name = 'users'[\s\S]*AS schema_snapshot/u,
        ),
      }),
    );
  });

  it("returns the empty-table comment when public has no tables", async () => {
    runSupabaseQueryMock.mockResolvedValue([
      { schema_snapshot: EMPTY_SNAPSHOT },
    ]);

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
      }),
    ).resolves.toBe("-- No public tables found.");
  });

  it("wraps an unexpected Management API response as an external error", async () => {
    runSupabaseQueryMock.mockResolvedValue({ error: "unexpected" });

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining(
        "Unexpected Supabase runQuery response shape (object keys: error)",
      ),
    });
  });

  it("reports an empty schema snapshot response clearly", async () => {
    runSupabaseQueryMock.mockResolvedValue([]);

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining(
        "Supabase schema snapshot query returned no rows",
      ),
    });
  });
});

describe("getSupabaseClientCode", () => {
  beforeEach(() => {
    getProjectApiKeysMock.mockReset();
  });

  // Supabase doesn't document the ordering of /api-keys, so the publishable key
  // must win on type, never on position. Picking by position bakes a DISABLED
  // legacy anon JWT into the generated app, and every request it makes — including
  // sign-in — fails with "Legacy API keys are disabled".
  it.each([
    ["legacy keys first", PROJECT_API_KEYS],
    ["new-format keys first", [...PROJECT_API_KEYS].reverse()],
  ])(
    "embeds the new-format publishable key when the response lists %s",
    async (_label, keys) => {
      getProjectApiKeysMock.mockResolvedValue(keys);

      const code = await getSupabaseClientCode({
        projectId: "project-id",
        organizationSlug: null,
      });

      expect(code).toContain(`"${PUBLISHABLE_KEY}"`);
      expect(code).not.toContain("eyJhbGciOiJIUzI1NiJ9.anon");
    },
  );

  it("never embeds a secret key", async () => {
    getProjectApiKeysMock.mockResolvedValue(PROJECT_API_KEYS);

    const code = await getSupabaseClientCode({
      projectId: "project-id",
      organizationSlug: null,
    });

    expect(code).not.toContain("sb_secret_");
  });

  it("falls back to the legacy anon key on an unmigrated project", async () => {
    getProjectApiKeysMock.mockResolvedValue([
      { name: "anon", type: "legacy", api_key: "eyJ.legacy-anon" },
      {
        name: "service_role",
        type: "legacy",
        api_key: "eyJ.legacy-service-role",
      },
    ]);

    const code = await getSupabaseClientCode({
      projectId: "project-id",
      organizationSlug: null,
    });

    expect(code).toContain('"eyJ.legacy-anon"');
  });

  it("does not request that secret key values be revealed", async () => {
    getProjectApiKeysMock.mockResolvedValue(PROJECT_API_KEYS);

    await getSupabaseClientCode({
      projectId: "project-id",
      organizationSlug: null,
    });

    expect(getProjectApiKeysMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ reveal: true }),
    );
  });
});

describe("getSupabaseSelfHostedPromptOptions", () => {
  it("lists pending functions by name, whatever order they go live in", () => {
    vi.mocked(getSupabaseSelfHostedInstanceSummary).mockReturnValue({
      id: "instance-1",
      name: "Home lab",
      url: "https://supabase.example.com",
      studioUrl: null,
      ssh: { host: "203.0.113.7", port: 22, username: "root" },
    });
    const now = Date.now();
    try {
      for (const [functionName, offset] of [
        ["send-email", 0],
        ["charge", 1_000],
      ] as const) {
        recordSupabaseSelfHostedFunctionDeploy({
          projectId: "instance-1",
          functionName,
          replacedExisting: true,
          workerLifetimeMs: 60_000,
          nowMs: now + offset,
        });
      }

      expect(
        getSupabaseSelfHostedPromptOptions("instance-1")?.pendingFunctions,
      ).toEqual(["charge", "send-email"]);
    } finally {
      vi.mocked(getSupabaseSelfHostedInstanceSummary).mockReset();
      resetSupabaseSelfHostedFunctionUpdates();
    }
  });
});
