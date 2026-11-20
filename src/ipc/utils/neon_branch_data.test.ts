import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  target: vi.fn(),
  http: vi.fn(),
}));

vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@neondatabase/serverless")>()),
  neon: () => ({ query: mocks.http }),
  Pool: class {
    constructor(private options: { connectionString: string }) {}
    async connect() {
      return {
        query:
          this.options.connectionString === "source"
            ? mocks.source
            : mocks.target,
        release: vi.fn(),
      };
    }
    async end() {}
  },
}));
vi.mock("./test_utils", () => ({ IS_TEST_BUILD: false }));

import {
  copyBranchData,
  exportBranchDataAsSql,
  findMigrationBlockers,
  planDataCopy,
  UncopyableDataError,
  type CopyTable,
  type TableForeignKey,
} from "./neon_branch_data";

const table = (qualified: string, canAlter: boolean): CopyTable => {
  const [schema, name] = qualified.split(".");
  return { schema, name, canAlter };
};

const key = (
  from: string,
  to: string,
  canAlter: boolean,
  name = `${from.split(".")[1]}_fkey`,
): TableForeignKey => {
  const [schema, tableName] = from.split(".");
  const [referencedSchema, referencedTable] = to.split(".");
  return {
    schema,
    table: tableName,
    name,
    definition: `FOREIGN KEY (x) REFERENCES ${to}(id)`,
    referencedSchema,
    referencedTable,
    canAlter,
  };
};

const names = (tables: CopyTable[]) =>
  tables.map((t) => `${t.schema}.${t.name}`);

// Neon Auth's tables and keys as a provisioned branch has them: owned by the
// neon_auth role, which the app role is not a member of.
const NEON_AUTH_TABLES = [
  "neon_auth.account",
  "neon_auth.invitation",
  "neon_auth.member",
  "neon_auth.organization",
  "neon_auth.session",
  "neon_auth.user",
  "neon_auth.verification",
].map((t) => table(t, false));
const NEON_AUTH_KEYS = [
  key("neon_auth.account", "neon_auth.user", false),
  key("neon_auth.invitation", "neon_auth.user", false, "invitation_inviter"),
  key(
    "neon_auth.invitation",
    "neon_auth.organization",
    false,
    "invitation_org",
  ),
  key("neon_auth.member", "neon_auth.user", false, "member_user"),
  key("neon_auth.member", "neon_auth.organization", false, "member_org"),
  key("neon_auth.session", "neon_auth.user", false),
];

describe("planDataCopy", () => {
  it("fills Neon Auth's tables parents first and keeps their keys", () => {
    const appTables = [
      table("public.posts", true),
      table("public.profiles", true),
    ];
    const appKeys = [
      key("public.profiles", "neon_auth.user", true),
      key("public.posts", "public.profiles", true),
    ];
    const plan = planDataCopy({
      // Shuffled, to show the order does not depend on the input's.
      tables: [...appTables, ...NEON_AUTH_TABLES].reverse(),
      foreignKeys: [...NEON_AUTH_KEYS, ...appKeys],
      // An app table's triggers are turned off for the copy, as before.
      triggered: [{ schema: "public", name: "posts" }],
    });

    expect(names(plan.managedTables)).toEqual([
      "neon_auth.organization",
      "neon_auth.user",
      "neon_auth.account",
      "neon_auth.invitation",
      "neon_auth.member",
      "neon_auth.session",
      "neon_auth.verification",
    ]);
    // Only the app's own keys are dropped, including its key into Neon Auth.
    expect(plan.droppedForeignKeys).toEqual(appKeys);
    expect(names(plan.ownedTables)).toEqual([
      "public.profiles",
      "public.posts",
    ]);
  });

  it("keeps neon_auth foreign keys, even where the role could drop them", () => {
    // A backup file is restored as whatever role runs it, so Neon Auth's
    // tables are planned the same way wherever they were exported from.
    const plan = planDataCopy({
      tables: NEON_AUTH_TABLES.map((t) => ({ ...t, canAlter: true })),
      foreignKeys: NEON_AUTH_KEYS.map((k) => ({ ...k, canAlter: true })),
      triggered: [],
    });
    expect(plan.droppedForeignKeys).toEqual([]);
    expect(plan.ownedTables).toEqual([]);
    expect(names(plan.managedTables)[0]).toBe("neon_auth.organization");
  });

  it("allows disabling legacy app-owned auth triggers while keeping foreign keys", () => {
    const plan = planDataCopy({
      tables: NEON_AUTH_TABLES.map((t) => ({ ...t, canAlter: true })),
      foreignKeys: NEON_AUTH_KEYS.map((k) => ({ ...k, canAlter: true })),
      triggered: [{ schema: "neon_auth", name: "user" }],
    });
    expect(plan.droppedForeignKeys).toEqual([]);
    expect(names(plan.managedTables)).toContain("neon_auth.user");
  });

  it("leaves any other table the role may not alter alone too", () => {
    const plan = planDataCopy({
      tables: [table("vendor.items", false), table("vendor.kinds", false)],
      foreignKeys: [key("vendor.items", "vendor.kinds", false)],
      triggered: [],
    });
    expect(names(plan.managedTables)).toEqual(["vendor.kinds", "vendor.items"]);
    expect(plan.droppedForeignKeys).toEqual([]);
  });

  it("ignores keys into tables outside the copy", () => {
    // E.g. Neon Auth's service tables, which each branch keeps its own of.
    const plan = planDataCopy({
      tables: [table("neon_auth.account", false)],
      foreignKeys: [key("neon_auth.account", "neon_auth.jwks", false)],
      triggered: [],
    });
    expect(names(plan.managedTables)).toEqual(["neon_auth.account"]);
  });

  it.each([
    {
      what: "triggers it can't turn off",
      tables: [table("neon_auth.user", false)],
      foreignKeys: [],
      triggered: [{ schema: "neon_auth", name: "user" }],
      message: /neon_auth\.user: it has enabled user triggers.*cannot disable/,
    },
    {
      what: "a table whose rows refer to each other",
      tables: [table("neon_auth.user", false)],
      foreignKeys: [key("neon_auth.user", "neon_auth.user", false)],
      triggered: [],
      message: /neon_auth\.user: its rows refer to each other/,
    },
    {
      what: "a cycle",
      tables: [table("neon_auth.a", false), table("neon_auth.b", false)],
      foreignKeys: [
        key("neon_auth.a", "neon_auth.b", false),
        key("neon_auth.b", "neon_auth.a", false),
      ],
      triggered: [],
      message: /neon_auth\.a, neon_auth\.b: their foreign keys form a cycle/,
    },
    {
      what: "a key into a table copied with its keys off",
      tables: [table("neon_auth.user", false), table("public.teams", true)],
      foreignKeys: [key("neon_auth.user", "public.teams", false)],
      triggered: [],
      message: /neon_auth\.user: it refers to public\.teams/,
    },
  ])("refuses $what", ({ tables, foreignKeys, triggered, message }) => {
    const plan = () => planDataCopy({ tables, foreignKeys, triggered });
    expect(plan).toThrow(UncopyableDataError);
    expect(plan).toThrow(message);
  });
});

describe("branch data triggers", () => {
  let directory: string;

  function mockDatabase(
    query: typeof mocks.source,
    canAlter: boolean,
    triggered: boolean,
  ) {
    query.mockImplementation(async (sql: string) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("from pg_class c") && sql.includes("c.relkind = 'r'")) {
        rows = [{ ...table("neon_auth.user", canAlter) }];
      } else if (sql.includes("from pg_attribute")) {
        rows = [{ name: "id", identityAlways: false }];
      } else if (sql.includes("select distinct n.nspname")) {
        rows = triggered ? [{ schema: "neon_auth", name: "user" }] : [];
      } else if (sql.includes("json_agg")) {
        rows = [{ rows: [{ id: "user-1", x_ctid: "(0,1)" }], last: "(0,1)" }];
      } else if (sql.includes("select count(*)::text")) {
        rows = [{ n: "1" }];
      }
      return { rows };
    });
  }

  const statements = (query: typeof mocks.source) =>
    query.mock.calls.map(([sql]) => sql as string);

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-trigger-copy-"));
    mockDatabase(mocks.source, true, true);
    mockDatabase(mocks.target, true, true);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("disables legacy destination triggers before deleting rows and restores them before commit", async () => {
    // Source ownership does not grant or restrict permissions on the target.
    mockDatabase(mocks.source, false, true);
    await expect(
      copyBranchData({ sourceUri: "source", targetUri: "target" }),
    ).resolves.toEqual({ tables: 1, rows: 1 });

    const sql = statements(mocks.target);
    const disable = sql.findIndex((s) => s.includes("disable trigger %I"));
    const remove = sql.findIndex((s) => s.startsWith("delete from only"));
    const insert = sql.findIndex((s) => s.startsWith("insert into"));
    const restore = sql.findIndex((s) => s.includes("enable replica trigger"));
    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(remove);
    expect(remove).toBeLessThan(insert);
    expect(insert).toBeLessThan(restore);
    expect(restore).toBeLessThan(sql.indexOf("commit"));
    expect(sql[disable]).toContain("t.tgenabled <> 'D'");
    expect(sql[restore]).toContain("enable always trigger");
    expect(sql[restore]).toContain("user_trigger.state");
    expect(statements(mocks.source)).not.toContain(sql[disable]);
  });

  it("rejects enabled triggers the destination role cannot disable before changing anything", async () => {
    mockDatabase(mocks.target, false, true);
    await expect(
      copyBranchData({ sourceUri: "source", targetUri: "target" }),
    ).rejects.toThrow(/enabled user triggers.*cannot disable/);
    const sql = statements(mocks.target);
    expect(sql.some((s) => /^(delete|insert|alter|do) /i.test(s))).toBe(false);
    expect(sql).toContain("rollback");
    expect(sql).not.toContain("commit");
  });

  it("excludes disabled triggers when checking an unalterable destination", async () => {
    mockDatabase(mocks.target, false, false);
    await copyBranchData({ sourceUri: "source", targetUri: "target" });
    const discovery = statements(mocks.target).find((s) =>
      s.includes("select distinct n.nspname"),
    );
    expect(discovery).toContain("not t.tgisinternal and t.tgenabled <> 'D'");
    expect(statements(mocks.target)).toContain("commit");
  });

  it("rolls back trigger changes along with a failed row copy", async () => {
    const query = mocks.target.getMockImplementation()!;
    mocks.target.mockImplementation(async (sql: string) => {
      if (sql.startsWith("insert into")) throw new Error("insert failed");
      return query(sql);
    });
    await expect(
      copyBranchData({ sourceUri: "source", targetUri: "target" }),
    ).rejects.toThrow("insert failed");
    const sql = statements(mocks.target);
    expect(sql.some((s) => s.includes("disable trigger %I"))).toBe(true);
    expect(sql.at(-1)).toBe("rollback");
    expect(sql).not.toContain("commit");
  });

  it.each([true, false])(
    "exports auth rows with source triggers (source canAlter=%s) and checks the restore destination",
    async (canAlter) => {
      mockDatabase(mocks.source, canAlter, true);
      const filePath = path.join(directory, "backup.sql");
      await expect(
        exportBranchDataAsSql({
          sourceUri: "source",
          filePath,
          title: "Backup",
        }),
      ).resolves.toEqual({ tables: 1, rows: 1 });
      const sql = await fs.readFile(filePath, "utf8");
      expect(sql).toContain('"id":"user-1"');
      expect(sql.indexOf("disable trigger %I")).toBeLessThan(
        sql.indexOf('delete from only "neon_auth"."user"'),
      );
      expect(sql).toContain("pg_has_role(current_user, c.relowner, 'USAGE')");
      expect(sql).toContain("if not user_trigger.can_alter then");
      expect(sql).toContain("not t.tgisinternal and t.tgenabled <> 'D'");
      expect(sql).toContain("user_trigger.state");
      expect(sql).toContain("enable replica trigger");
      expect(sql).toContain("enable always trigger");
      expect(sql.trimEnd()).toMatch(/end \$\$;\ncommit;$/);
      // Export must never attempt to disable triggers on its read-only source.
      expect(
        statements(mocks.source).some((s) => /^(alter|do) /i.test(s)),
      ).toBe(false);
    },
  );

  it("reports auth trigger definitions that reprovisioning would lose, including disabled ones", async () => {
    mocks.http
      .mockResolvedValueOnce([
        { object: 'the trigger sync_profile on neon_auth."user"' },
      ])
      .mockResolvedValueOnce([{ count: 0 }]);
    await expect(
      findMigrationBlockers("source", { neonAuth: true }),
    ).resolves.toEqual([
      'the trigger sync_profile on neon_auth."user" (it uses Neon Auth\'s tables)',
    ]);
    const sql = mocks.http.mock.calls[0][0];
    expect(sql).toContain("from pg_trigger t");
    expect(sql).toContain("not t.tgisinternal");
    expect(sql).not.toContain("t.tgenabled");
  });
});
