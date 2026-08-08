import { describe, expect, it } from "vitest";

import {
  ALL_INTROSPECTION_SQL,
  COLUMNS_SQL,
  FOREIGN_KEYS_SQL,
  SYSTEM_SCHEMAS,
  TABLES_SQL,
} from "@/lib/data_sources/introspection_sql";
import { assertReadOnly } from "@/lib/data_sources/read_only";

describe("every introspection statement", () => {
  it("passes the read-only guard", () => {
    // The guard protects the introspection path too, so discovery must not
    // depend on an exemption from it.
    for (const sql of ALL_INTROSPECTION_SQL) {
      const result = assertReadOnly(sql);
      expect(result.ok, `rejected: ${sql.slice(0, 60)}`).toBe(true);
    }
  });

  it("is a single statement each", () => {
    for (const sql of ALL_INTROSPECTION_SQL) {
      expect(sql.split(";").filter((part) => part.trim()).length).toBe(1);
    }
  });

  it("reads only catalogue tables, never user data", () => {
    for (const sql of ALL_INTROSPECTION_SQL) {
      const readsCatalogue =
        /\bfrom\s+(pg_|information_schema)/i.test(sql) ||
        sql.trim() === "select 1 as ok" ||
        /current_database/.test(sql);
      expect(readsCatalogue, sql.slice(0, 60)).toBe(true);
    }
  });
});

describe("system schema exclusion", () => {
  it("keeps Supabase's own machinery out of discovery", () => {
    // A user connecting a project should see their tables, not auth.users
    // and forty rows of storage internals.
    for (const schema of ["auth", "storage", "realtime", "vault"]) {
      expect(SYSTEM_SCHEMAS).toContain(schema);
      expect(TABLES_SQL).toContain(`'${schema}'`);
      expect(COLUMNS_SQL).toContain(`'${schema}'`);
    }
  });

  it("excludes pg_ schemas by pattern as well as by name", () => {
    expect(TABLES_SQL).toContain("not like 'pg_%'");
  });
});

describe("row counts", () => {
  it("estimates rather than counting", () => {
    // count(*) on a large table is a full scan; discovery must never be the
    // reason a production database slows down.
    expect(TABLES_SQL).toContain("reltuples");
    expect(TABLES_SQL).not.toMatch(/count\s*\(\s*\*\s*\)/i);
  });
});

describe("foreign keys", () => {
  it("takes single-column keys only", () => {
    // The query plan can only express one column joining one column, so a
    // composite key would advertise a relationship the agent cannot use.
    expect(FOREIGN_KEYS_SQL).toContain("array_length(con.conkey, 1) = 1");
  });
});
