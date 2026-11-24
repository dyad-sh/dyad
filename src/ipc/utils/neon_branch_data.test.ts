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
  // The connection string comes along, so a test can route it.
  neon: (uri: string) => ({
    query: (sql: string, params?: unknown[]) => mocks.http(sql, params, uri),
  }),
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
  findNeonAuthDataNotCopied,
  grantNeonAuthCreatePermission,
  planDataCopy,
  UncopyableDataError,
  type CopyTable,
  type TableForeignKey,
  type TablePartition,
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

const partition = (qualified: string, of: string): TablePartition => {
  const [schema, name] = qualified.split(".");
  const [parentSchema, parentName] = of.split(".");
  return { schema, name, parentSchema, parentName };
};

const names = (tables: CopyTable[]) =>
  tables.map((t) => `${t.schema}.${t.name}`);

/** A one-row page, as the copy's paging query returns it. */
const rowsPage = (id: string) => ({
  json: JSON.stringify([{ id }]),
  count: 1,
  last: "(0,1)",
});

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

  it("orders a partition by the key declared on its partitioned table", () => {
    // A legacy app-owned table partitioned by year: the key is listed once,
    // on `audit`, while the rows are in `audit_2026`.
    const plan = planDataCopy({
      tables: [
        table("neon_auth.audit_2026", true),
        table("neon_auth.user", true),
      ],
      foreignKeys: [key("neon_auth.audit", "neon_auth.user", true)],
      triggered: [],
      partitions: [partition("neon_auth.audit_2026", "neon_auth.audit")],
    });
    expect(names(plan.managedTables)).toEqual([
      "neon_auth.user",
      "neon_auth.audit_2026",
    ]);
    expect(plan.droppedForeignKeys).toEqual([]);
  });

  it("orders a key into a partitioned table after its leaf partitions", () => {
    const plan = planDataCopy({
      tables: [
        table("vendor.a_items", false),
        table("vendor.z_kinds_2026_q1", false),
      ],
      foreignKeys: [key("vendor.a_items", "vendor.z_kinds", false)],
      triggered: [],
      partitions: [
        partition("vendor.z_kinds_2026", "vendor.z_kinds"),
        partition("vendor.z_kinds_2026_q1", "vendor.z_kinds_2026"),
      ],
    });
    expect(names(plan.managedTables)).toEqual([
      "vendor.z_kinds_2026_q1",
      "vendor.a_items",
    ]);
  });

  it("orders an app-owned partition by a kept key on its parent", () => {
    const plan = planDataCopy({
      tables: [
        table("public.audit_2026", true),
        table("neon_auth.user", false),
      ],
      foreignKeys: [key("neon_auth.audit", "neon_auth.user", false)],
      triggered: [],
      partitions: [partition("public.audit_2026", "neon_auth.audit")],
    });
    expect(names(plan.managedTables)).toEqual([
      "neon_auth.user",
      "public.audit_2026",
    ]);
    expect(plan.ownedTables).toEqual([]);
  });

  it("ignores keys it drops, even where they bind partitions it can't alter", () => {
    const selfKey = key("public.events", "public.events", true);
    const plan = planDataCopy({
      tables: [table("public.events_1", false)],
      foreignKeys: [selfKey],
      triggered: [],
      partitions: [partition("public.events_1", "public.events")],
    });
    expect(plan.droppedForeignKeys).toEqual([selfKey]);
    expect(names(plan.managedTables)).toEqual(["public.events_1"]);
  });

  it("tells apart tables whose names join to the same dotted name", () => {
    const dotted = { schema: "public", name: "x.y", canAlter: false };
    const nested = { schema: "public.x", name: "y", canAlter: false };
    const plan = planDataCopy({
      tables: [dotted, nested],
      foreignKeys: [
        {
          ...key("public.x", "public.y", false),
          table: "x.y",
          referencedSchema: "public.x",
          referencedTable: "y",
        },
      ],
      triggered: [],
    });
    expect(plan.managedTables).toEqual([nested, dotted]);
  });

  it("lists tables outside the copy whose kept keys refer to tables it clears", () => {
    const plan = planDataCopy({
      tables: [table("neon_auth.user", false), table("public.profiles", true)],
      foreignKeys: [
        key("neon_auth.jwks", "neon_auth.user", false),
        key("neon_auth.jwks", "neon_auth.user", false, "jwks_owner_fkey"),
        key("neon_auth.jwks", "neon_auth.project_config", false, "jwks_cfg"),
        key("vendor.log", "public.profiles", false),
        key("vendor.log", "neon_auth.user", false, "log_user_fkey"),
        // Dropped for the copy, so it doesn't bind the rows.
        key("public.drafts", "public.profiles", true),
      ],
      triggered: [],
    });
    // Every table it refers to is listed, so the copy can lock each of them.
    expect(plan.outsideReferences).toEqual([
      { table: '"neon_auth"."jwks"', references: '"neon_auth"."user"' },
      { table: '"vendor"."log"', references: '"public"."profiles"' },
      { table: '"vendor"."log"', references: '"neon_auth"."user"' },
    ]);
  });

  it.each([
    {
      what: "triggers it can't turn off",
      tables: [table("neon_auth.user", false)],
      foreignKeys: [],
      triggered: [{ schema: "neon_auth", name: "user" }],
      message:
        /"neon_auth"\."user": it has enabled user triggers.*cannot disable/,
    },
    {
      what: "a table whose rows refer to each other",
      tables: [table("neon_auth.user", false)],
      foreignKeys: [key("neon_auth.user", "neon_auth.user", false)],
      triggered: [],
      message: /"neon_auth"\."user": its rows refer to each other/,
    },
    {
      what: "a cycle",
      tables: [table("neon_auth.a", false), table("neon_auth.b", false)],
      foreignKeys: [
        key("neon_auth.a", "neon_auth.b", false),
        key("neon_auth.b", "neon_auth.a", false),
      ],
      triggered: [],
      message:
        /"neon_auth"\."a", "neon_auth"\."b": their foreign keys form a cycle/,
    },
    {
      what: "a key into a table copied with its keys off",
      tables: [table("neon_auth.user", false), table("public.teams", true)],
      foreignKeys: [key("neon_auth.user", "public.teams", false)],
      triggered: [],
      message: /"neon_auth"\."user": it refers to "public"\."teams"/,
    },
    {
      what: "a key into a partition copied with its keys off",
      tables: [table("vendor.items", false), table("public.teams_1", true)],
      foreignKeys: [key("vendor.items", "public.teams", false)],
      triggered: [],
      partitions: [partition("public.teams_1", "public.teams")],
      message: /"vendor"\."items": it refers to "public"\."teams_1"/,
    },
  ])(
    "refuses $what",
    ({ tables, foreignKeys, triggered, partitions, message }) => {
      const plan = () =>
        planDataCopy({ tables, foreignKeys, triggered, partitions });
      expect(plan).toThrow(UncopyableDataError);
      expect(plan).toThrow(message);
    },
  );
});

describe("partitioned tables with kept keys", () => {
  // A legacy app-owned neon_auth table partitioned by year: its key into
  // `user` is declared on `audit`, while its rows are in `audit_2026`.
  const AUDIT = '"neon_auth"."audit_2026"';
  const USER = '"neon_auth"."user"';
  let directory: string;

  function mockDatabase(query: typeof mocks.source) {
    query.mockImplementation(async (sql: string) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("from pg_class c") && sql.includes("c.relkind = 'r'")) {
        rows = [
          { ...table("neon_auth.audit_2026", true) },
          { ...table("neon_auth.user", true) },
        ];
      } else if (sql.includes("from pg_attribute")) {
        rows = [{ name: "id", identityAlways: false }];
      } else if (sql.includes("from pg_constraint con")) {
        rows = [{ ...key("neon_auth.audit", "neon_auth.user", true) }];
      } else if (sql.includes("from pg_inherits i")) {
        rows = [{ ...partition("neon_auth.audit_2026", "neon_auth.audit") }];
      } else if (sql.includes("json_agg")) {
        rows = [rowsPage("row-1")];
      } else if (sql.includes("select count(*)::text")) {
        rows = [{ n: "1" }];
      }
      return { rows };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-partitions-"));
    mockDatabase(mocks.source);
    mockDatabase(mocks.target);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("copies the partition after the rows its key references", async () => {
    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });
    const sql = mocks.target.mock.calls.map(([s]) => s as string);
    const at = (prefix: string) => sql.findIndex((s) => s.startsWith(prefix));
    expect(at(`delete from only ${AUDIT}`)).toBeGreaterThan(-1);
    expect(at(`delete from only ${AUDIT}`)).toBeLessThan(
      at(`delete from only ${USER}`),
    );
    expect(at(`insert into ${USER}`)).toBeLessThan(at(`insert into ${AUDIT}`));
    expect(sql.some((s) => s.includes("drop constraint"))).toBe(false);
    expect(sql).toContain("commit");
  });

  it("writes a backup that restores the partition after the rows its key references", async () => {
    const filePath = path.join(directory, "backup.sql");
    await exportBranchDataAsSql({
      sourceUri: "source",
      filePath,
      title: "B",
      hasNeonAuth: true,
    });
    const sql = await fs.readFile(filePath, "utf8");
    expect(sql.indexOf(`delete from only ${AUDIT};`)).toBeGreaterThan(-1);
    expect(sql.indexOf(`delete from only ${AUDIT};`)).toBeLessThan(
      sql.indexOf(`delete from only ${USER};`),
    );
    expect(sql.indexOf(`insert into ${USER} `)).toBeLessThan(
      sql.indexOf(`insert into ${AUDIT} `),
    );
    expect(sql).not.toContain("drop constraint");
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
        rows = [rowsPage("user-1")];
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
      copyBranchData({
        sourceUri: "source",
        targetUri: "target",
        hasNeonAuth: true,
      }),
    ).resolves.toEqual({ tables: 1, rows: 1, skipped: [] });

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
      copyBranchData({
        sourceUri: "source",
        targetUri: "target",
        hasNeonAuth: true,
      }),
    ).rejects.toThrow(/enabled user triggers.*cannot disable/);
    const sql = statements(mocks.target);
    expect(sql.some((s) => /^(delete|insert|alter|do) /i.test(s))).toBe(false);
    expect(sql).toContain("rollback");
    expect(sql).not.toContain("commit");
  });

  it("excludes disabled triggers when checking an unalterable destination", async () => {
    mockDatabase(mocks.target, false, false);
    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });
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
      copyBranchData({
        sourceUri: "source",
        targetUri: "target",
        hasNeonAuth: true,
      }),
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
          hasNeonAuth: true,
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

describe("copyBranchData extra foreign keys", () => {
  // Keys captured before neon_auth was dropped. `profiles_user_fkey` and
  // `audit_user_fkey` went with it; `profiles_org_fkey` is still on the target.
  const userKey = key(
    "public.profiles",
    "neon_auth.user",
    true,
    "profiles_user_fkey",
  );
  const orgKey = key(
    "public.profiles",
    "public.orgs",
    true,
    "profiles_org_fkey",
  );
  const auditKey = key(
    "public.audit",
    "neon_auth.user",
    false,
    "audit_user_fkey",
  );
  const goneKey = key("public.gone", "neon_auth.user", true, "gone_user_fkey");
  const authKey = key("neon_auth.session", "neon_auth.user", false);

  function mockDatabase(
    query: typeof mocks.source,
    // Tables on the target that exist and whether the role may alter them.
    target: Record<string, boolean> = {},
  ) {
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("from pg_class c") && sql.includes("c.relkind = 'r'")) {
        rows = [{ ...table("public.profiles", true) }];
      } else if (sql.includes("from pg_attribute")) {
        rows = [{ name: "id", identityAlways: false }];
      } else if (sql.includes("from pg_constraint con")) {
        rows = [{ ...orgKey }];
      } else if (sql.includes("to_regclass($1)::oid")) {
        const name = String(params?.[0]).replace(/"/g, "");
        rows = [{ exists: name in target, canAlter: target[name] ?? false }];
      } else if (sql.includes("json_agg")) {
        rows = [rowsPage("p-1")];
      } else if (sql.includes("select count(*)::text")) {
        rows = [{ n: "1" }];
      }
      return { rows };
    });
  }

  const statements = () =>
    mocks.target.mock.calls.map(([sql]) => sql as string);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase(mocks.source);
  });

  it("restores keys dropped with neon_auth and skips the rest", async () => {
    mockDatabase(mocks.target, { "public.profiles": true });
    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
      extraForeignKeys: [userKey, orgKey, goneKey, authKey],
    });
    const added = statements().filter((s) => s.includes(" add constraint "));
    expect(added).toEqual([
      `alter table "public"."profiles" add constraint "profiles_org_fkey" ${orgKey.definition}`,
      `alter table "public"."profiles" add constraint "profiles_user_fkey" ${userKey.definition}`,
    ]);
    expect(statements()).toContain("commit");
  });

  it("refuses a dropped key it can't add back before changing anything", async () => {
    mockDatabase(mocks.target, {
      "public.profiles": true,
      "public.audit": false,
    });
    const copy = copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
      extraForeignKeys: [userKey, auditKey],
    });
    await expect(copy).rejects.toThrow(UncopyableDataError);
    await expect(copy).rejects.toThrow(
      /"public"\."audit": its foreign key audit_user_fkey .* can't add it back/,
    );
    const sql = statements();
    expect(sql.some((s) => /^(delete|insert|alter|do) /i.test(s))).toBe(false);
    expect(sql).toContain("rollback");
    expect(sql).not.toContain("commit");
  });
});

describe("tables outside the copy with kept keys", () => {
  // A table the copy leaves alone whose kept key refers to `user`, which it
  // clears: its rows would block the delete or cascade from it.
  const JWKS = '"neon_auth"."jwks"';
  const USER = '"neon_auth"."user"';
  let directory: string;

  function mockDatabase(query: typeof mocks.source, hasRows: boolean) {
    query.mockImplementation(async (sql: string) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("from pg_class c") && sql.includes("c.relkind = 'r'")) {
        rows = [{ ...table("neon_auth.user", false) }];
      } else if (sql.includes("from pg_attribute")) {
        rows = [{ name: "id", identityAlways: false }];
      } else if (sql.includes("from pg_constraint con")) {
        rows = [{ ...key("neon_auth.jwks", "neon_auth.user", false) }];
      } else if (
        sql === `select exists (select 1 from only ${JWKS}) as "hasRows"`
      ) {
        rows = [{ hasRows }];
      } else if (sql.includes("json_agg")) {
        rows = [rowsPage("user-1")];
      } else if (sql.includes("select count(*)::text")) {
        rows = [{ n: "1" }];
      }
      return { rows };
    });
  }

  const statements = () =>
    mocks.target.mock.calls.map(([sql]) => sql as string);

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-outside-"));
    mockDatabase(mocks.source, true);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("refuses before changing anything when that table has rows", async () => {
    mockDatabase(mocks.target, true);
    const copy = copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });
    await expect(copy).rejects.toThrow(UncopyableDataError);
    await expect(copy).rejects.toThrow(
      `Can't copy ${USER}: rows of ${JWKS}, which isn't copied`,
    );
    const sql = statements();
    expect(sql.some((s) => /^(delete|insert|alter|do) /i.test(s))).toBe(false);
    expect(sql).not.toContain("commit");
  });

  it("copies when that table is empty", async () => {
    mockDatabase(mocks.target, false);
    await expect(
      copyBranchData({
        sourceUri: "source",
        targetUri: "target",
        hasNeonAuth: true,
      }),
    ).resolves.toEqual({ tables: 1, rows: 1, skipped: [] });
    expect(statements()).toContain("commit");
  });

  it("locks the table it refers to before checking it, so no row lands after the check", async () => {
    mockDatabase(mocks.target, false);
    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });
    const sql = statements();
    const lock = sql.indexOf(`lock table ${USER} in exclusive mode`);
    const check = sql.indexOf(
      `select exists (select 1 from only ${JWKS}) as "hasRows"`,
    );
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(check);
    expect(check).toBeLessThan(sql.indexOf(`delete from only ${USER}`));
  });

  it("writes a backup that checks that table on the restore target first", async () => {
    const filePath = path.join(directory, "backup.sql");
    await exportBranchDataAsSql({
      sourceUri: "source",
      filePath,
      title: "B",
      hasNeonAuth: true,
    });
    const sql = await fs.readFile(filePath, "utf8");
    const check = sql.indexOf(`if to_regclass('${JWKS}') is not null then`);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(sql.indexOf(`delete from only ${USER};`));
    const lock = sql.indexOf(`execute 'lock table ${USER} in exclusive mode';`);
    expect(lock).toBeGreaterThan(check);
    expect(lock).toBeLessThan(
      sql.indexOf(`execute 'select exists (select 1 from only ${JWKS})'`),
    );
    expect(sql).toContain(
      `raise exception using message = 'Can''t copy ${USER}: rows of ${JWKS}, which isn''t copied`,
    );
  });
});

describe("copyBranchData table names", () => {
  it("copies tables whose names join to the same dotted name", async () => {
    vi.clearAllMocks();
    for (const query of [mocks.source, mocks.target]) {
      query.mockImplementation(async (sql: string) => {
        let rows: Record<string, unknown>[] = [];
        if (
          sql.includes("from pg_class c") &&
          sql.includes("c.relkind = 'r'")
        ) {
          rows = [
            { schema: "public", name: "x.y", canAlter: true },
            { schema: "public.x", name: "y", canAlter: true },
          ];
        } else if (sql.includes("from pg_attribute")) {
          rows = [{ name: "id", identityAlways: false }];
        } else if (sql.includes("json_agg")) {
          rows = [rowsPage("r-1")];
        } else if (sql.includes("select count(*)::text")) {
          rows = [{ n: "1" }];
        }
        return { rows };
      });
    }
    await expect(
      copyBranchData({
        sourceUri: "source",
        targetUri: "target",
        hasNeonAuth: true,
      }),
    ).resolves.toEqual({ tables: 2, rows: 2, skipped: [] });
    const inserts = mocks.target.mock.calls
      .map(([sql]) => sql as string)
      .filter((s) => s.startsWith("insert into"))
      .map((s) => s.split(" (")[0]);
    expect(inserts.sort()).toEqual([
      'insert into "public"."x.y"',
      'insert into "public.x"."y"',
    ]);
  });
});

describe("row-level security", () => {
  // A table the role doesn't own: without BYPASSRLS, its policies would
  // filter both the rows copied and the counts that verify them.
  const NOTES = '"public"."notes"';
  let directory: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-rls-"));
    for (const query of [mocks.source, mocks.target]) {
      query.mockImplementation(async (sql: string) => {
        let rows: Record<string, unknown>[] = [];
        if (
          sql.includes("from pg_class c") &&
          sql.includes("c.relkind = 'r'")
        ) {
          rows = [{ ...table("public.notes", false) }];
        } else if (sql.includes("from pg_attribute")) {
          rows = [{ name: "id", identityAlways: false }];
        } else if (sql.includes("json_agg")) {
          rows = [rowsPage("n-1")];
        } else if (sql.includes("select count(*)::text")) {
          rows = [{ n: "1" }];
        }
        return { rows };
      });
    }
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const statements = (query: typeof mocks.source) =>
    query.mock.calls.map(([sql]) => sql as string);

  it("turns it off on both branches before reading or writing any rows", async () => {
    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });
    for (const query of [mocks.source, mocks.target]) {
      const sql = statements(query);
      expect(sql[0]).toMatch(/^begin/);
      expect(sql[1]).toBe("set local row_security = off");
    }
    expect(statements(mocks.target)).toContain(`delete from only ${NOTES}`);
  });

  it("writes a backup that turns it off on the source and the restore target", async () => {
    const filePath = path.join(directory, "backup.sql");
    await exportBranchDataAsSql({
      sourceUri: "source",
      filePath,
      title: "B",
      hasNeonAuth: true,
    });
    expect(statements(mocks.source).slice(0, 2)).toEqual([
      "begin isolation level repeatable read read only",
      "set local row_security = off",
    ]);
    const sql = await fs.readFile(filePath, "utf8");
    const off = sql.indexOf("\nset local row_security = off;\n");
    expect(off).toBeGreaterThan(sql.indexOf("\nbegin;\n"));
    expect(off).toBeLessThan(sql.indexOf(`delete from only ${NOTES};`));
  });
});

describe("Neon migration data", () => {
  // Exact only as text: both exceed what a JS number holds.
  const EXACT_ROWS =
    '[{"id":9007199254740993,"amount":0.1000000000000000000001}]';

  /**
   * Answers the catalog and data queries the copy and export make, for
   * `tables` (qualified name → insertable columns) holding one row each.
   */
  function fakeDatabase(tables: Record<string, string[]>) {
    return async (sql: string, params: unknown[] = []) => {
      let rows: Record<string, unknown>[] = [];
      if (sql.includes("c.relkind = 'r'")) {
        rows = Object.keys(tables).map((qualified) => ({
          ...table(qualified, true),
        }));
      } else if (sql.includes("from pg_attribute")) {
        const [schema, name] = String(params[0])
          .split(".")
          .map((part) => part.replace(/"/g, ""));
        rows = (tables[`${schema}.${name}`] ?? []).map((column) => ({
          name: column,
          identityAlways: false,
        }));
      } else if (sql.includes("with page as")) {
        rows = [{ json: EXACT_ROWS, count: 1, last: "(0,1)" }];
      } else if (sql.includes("count(*)::text as n")) {
        rows = [{ n: "1" }];
      } else if (sql.includes("to_regclass")) {
        rows = [{ exists: true }];
      }
      return { rows };
    };
  }

  const statements = (query: typeof mocks.source) =>
    query.mock.calls.map(([sql]) => sql as string);

  beforeEach(() => {
    mocks.source.mockReset().mockResolvedValue({ rows: [] });
    mocks.target.mockReset().mockResolvedValue({ rows: [] });
    // The HTTP driver resolves to the rows themselves.
    mocks.http
      .mockReset()
      .mockImplementation(
        async (sql: string, params: unknown[], uri: string) =>
          (await (uri === "source" ? mocks.source : mocks.target)(sql, params))
            .rows,
      );
  });

  it("grants permission for future Auth without resetting SQL objects", async () => {
    await grantNeonAuthCreatePermission("target");
    const sql = statements(mocks.http).join("\n");
    expect(sql).toMatch(/grant create on database .* to neon_service/i);
    expect(sql).not.toMatch(/drop\s+(schema|role)/i);
  });

  it.each(["invites", "jwks", "project_config"])(
    "refuses to skip neon_auth.%s on a database-only migration",
    async (name) => {
      mocks.source.mockImplementation(async (sql: string) => ({
        rows: sql.includes("c.relkind = 'r'")
          ? [{ ...table(`neon_auth.${name}`, true) }]
          : [],
      }));
      await expect(
        copyBranchData({
          sourceUri: "source",
          targetUri: "target",
          hasNeonAuth: false,
        }),
      ).rejects.toThrow(`"neon_auth"."${name}": the table is missing`);
      expect(statements(mocks.target)).toContain("rollback");
      expect(statements(mocks.target)).not.toContain("commit");
    },
  );

  it("copies bigint and numeric values exactly", async () => {
    mocks.source.mockImplementation(
      fakeDatabase({ "public.ids": ["id", "amount"] }),
    );
    mocks.target.mockImplementation(
      fakeDatabase({ "public.ids": ["id", "amount"] }),
    );

    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: false,
    });

    expect(mocks.target).toHaveBeenCalledWith(
      expect.stringMatching(/^insert into "public"\."ids"/),
      [EXACT_ROWS],
    );
    expect(statements(mocks.target)).toContain("commit");
  });

  it("backs up bigint and numeric values exactly", async () => {
    mocks.source.mockImplementation(
      fakeDatabase({ "public.ids": ["id", "amount"] }),
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "neon-backup-"));
    try {
      const filePath = path.join(dir, "backup.sql");
      await exportBranchDataAsSql({
        sourceUri: "source",
        filePath,
        title: "Test backup",
        hasNeonAuth: false,
      });
      expect(await fs.readFile(filePath, "utf8")).toContain(
        `$dyad$${EXACT_ROWS}$dyad$`,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reports what re-provisioned Neon Auth no longer has, and copies the rest", async () => {
    mocks.source.mockImplementation(
      fakeDatabase({
        "neon_auth.legacy": ["body"],
        "neon_auth.user": ["id", "old_flag"],
        "public.ids": ["id", "amount"],
      }),
    );
    mocks.target.mockImplementation(
      fakeDatabase({
        "neon_auth.user": ["id"],
        "public.ids": ["id", "amount"],
      }),
    );

    const result = await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });

    expect(result.skipped).toEqual([
      '"neon_auth"."legacy"',
      '"neon_auth"."user"."old_flag"',
    ]);
    const inserts = statements(mocks.target).filter((s) =>
      s.startsWith("insert into"),
    );
    expect(inserts).toEqual([
      expect.stringMatching(/^insert into "neon_auth"\."user" \("id"\)/),
      expect.stringMatching(/^insert into "public"\."ids"/),
    ]);
    expect(statements(mocks.target)).toContain("commit");
  });

  it("finds what a copy left out of re-provisioned Neon Auth, as the copy reports it", async () => {
    mocks.source.mockImplementation(
      fakeDatabase({
        "neon_auth.legacy": ["body"],
        "neon_auth.user": ["id", "old_flag"],
        "public.ids": ["id", "amount"],
      }),
    );
    mocks.target.mockImplementation(
      fakeDatabase({
        "neon_auth.user": ["id"],
        "public.ids": ["id", "amount"],
      }),
    );

    const copied = await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: true,
    });

    expect(copied.skipped).toHaveLength(2);
    await expect(
      findNeonAuthDataNotCopied("source", "target"),
    ).resolves.toEqual(copied.skipped);
  });

  it("pages by ctid under a name no user column can take", async () => {
    // A column named like the alias the page query once used.
    mocks.source.mockImplementation(
      fakeDatabase({ "public.odd": ["dyad$ctid", "id"] }),
    );
    mocks.target.mockImplementation(
      fakeDatabase({ "public.odd": ["dyad$ctid", "id"] }),
    );

    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: false,
    });

    const page = statements(mocks.source).find((s) => s.includes("with page"));
    expect(page).toMatch(/select ctid, "dyad\$ctid", "id" from only/);
    expect(page).toMatch(/max\(ctid\)/);
    expect(page).not.toMatch(/ as "dyad\$ctid"/);
  });

  it("reads whole rows even when a column is named like the row alias", async () => {
    mocks.source.mockImplementation(
      fakeDatabase({ "public.odd": ["r", "id"] }),
    );
    mocks.target.mockImplementation(
      fakeDatabase({ "public.odd": ["r", "id"] }),
    );

    await copyBranchData({
      sourceUri: "source",
      targetUri: "target",
      hasNeonAuth: false,
    });

    const page = statements(mocks.source).find((s) => s.includes("with page"));
    expect(page).toMatch(/from \(select "r", "id" from page\) r\)/);
    // A bare `r` would resolve to the column, not the row.
    expect(page).toMatch(/to_json\(r\.\*\)/);
    expect(page).not.toMatch(/to_json\(r\)/);
  });

  it("refuses to drop app columns even when Neon Auth is re-provisioned", async () => {
    mocks.source.mockImplementation(
      fakeDatabase({ "public.ids": ["id", "amount"] }),
    );
    mocks.target.mockImplementation(fakeDatabase({ "public.ids": ["id"] }));

    await expect(
      copyBranchData({
        sourceUri: "source",
        targetUri: "target",
        hasNeonAuth: true,
      }),
    ).rejects.toThrow(/"public"\."ids": column "amount" is missing/);
    expect(statements(mocks.target)).not.toContain("commit");
  });
});
