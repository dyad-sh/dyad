import { describe, expect, it } from "vitest";

import {
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

  it("never alters neon_auth tables, even where the role could", () => {
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
      message: /neon_auth\.user: it has triggers/,
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
