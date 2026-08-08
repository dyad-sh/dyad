import { describe, expect, it } from "vitest";

import {
  assertReadOnly,
  sanitiseDatabaseError,
  stripCommentsAndLiterals,
} from "@/lib/data_sources/read_only";

const rejected = (sql: string) => {
  const result = assertReadOnly(sql);
  expect(result.ok).toBe(false);
  return result.ok ? null : result.rejection;
};

describe("reads that must be allowed", () => {
  it("allows a plain select", () => {
    expect(assertReadOnly("select id from ord_hdr limit 10").ok).toBe(true);
  });

  it("allows the CTEs real introspection needs", () => {
    expect(
      assertReadOnly(
        "with cols as (select * from information_schema.columns) select * from cols",
      ).ok,
    ).toBe(true);
  });

  it("allows explain", () => {
    expect(assertReadOnly("explain select 1").ok).toBe(true);
  });

  it("allows a literal that happens to contain a forbidden word", () => {
    // A row of data mentioning "delete" must not make the query unrunnable.
    expect(
      assertReadOnly("select * from t where note = 'please delete this'").ok,
    ).toBe(true);
  });

  it("allows an identifier that collides with a keyword", () => {
    expect(assertReadOnly('select * from "update"').ok).toBe(true);
  });
});

describe("writes that must be refused", () => {
  it.each([
    ["insert into t values (1)", "not_a_read"],
    ["update t set a = 1", "not_a_read"],
    ["delete from t", "not_a_read"],
    ["drop table t", "not_a_read"],
    ["truncate t", "not_a_read"],
    ["alter table t add column c int", "not_a_read"],
    ["create table t (id int)", "not_a_read"],
    ["grant all on t to public", "not_a_read"],
    ["revoke all on t from public", "not_a_read"],
    ["copy t from '/etc/passwd'", "not_a_read"],
    ["call do_something()", "not_a_read"],
    ["vacuum full", "not_a_read"],
  ])("refuses %s", (sql, code) => {
    expect(rejected(sql)?.code).toBe(code);
  });

  it("refuses a write smuggled after a read", () => {
    expect(rejected("select 1; drop table users")?.code).toBe(
      "multiple_statements",
    );
  });

  it("refuses a writable CTE", () => {
    // Starts with WITH and looks like a read, but deletes rows.
    expect(
      rejected("with gone as (delete from t returning *) select * from gone")
        ?.code,
    ).toBe("forbidden_keyword");
  });

  it("refuses a write hidden behind a line comment", () => {
    expect(rejected("select 1 -- \n; drop table t")?.code).toBe(
      "multiple_statements",
    );
  });

  it("refuses a write hidden in a block comment trick", () => {
    expect(rejected("select 1 /* harmless */; delete from t")?.code).toBe(
      "multiple_statements",
    );
  });

  it("refuses a dollar-quoted payload that then writes", () => {
    expect(rejected("select $$ x $$; truncate t")?.code).toBe(
      "multiple_statements",
    );
  });

  it("refuses transaction control", () => {
    expect(rejected("begin")?.code).toBe("not_a_read");
  });

  it("refuses set, which can change session behaviour", () => {
    expect(rejected("set role postgres")?.code).toBe("not_a_read");
  });

  it("refuses file reads dressed as a select", () => {
    expect(rejected("select pg_read_file('/etc/passwd')")?.code).toBe(
      "forbidden_keyword",
    );
  });

  it("refuses a sleep, which is a denial of service in one function", () => {
    expect(rejected("select pg_sleep(10000)")?.code).toBe("forbidden_keyword");
  });

  it("refuses an empty statement", () => {
    expect(rejected("   ")?.code).toBe("empty");
  });

  it("refuses something too long to check confidently", () => {
    expect(rejected(`select ${"a".repeat(30_000)}`)?.code).toBe("too_long");
  });
});

describe("stripCommentsAndLiterals", () => {
  it("removes nested block comments entirely", () => {
    const stripped = stripCommentsAndLiterals("select /* a /* b */ c */ 1");
    expect(stripped).not.toContain("a");
    expect(stripped).toContain("select");
  });

  it("keeps token boundaries so words cannot be glued together", () => {
    // A comment between two fragments must leave a separator behind, so the
    // keyword scan sees "dr" and "op" rather than "drop".
    const stripped = stripCommentsAndLiterals("select dr/*x*/op");
    expect(stripped).toMatch(/dr\s+op/);
    const words = stripped.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
    expect(words).not.toContain("drop");
  });

  it("does not let a comment glue a forbidden word back together", () => {
    // The end-to-end version of the same concern.
    expect(assertReadOnly("select 1; dr/*x*/op table t").ok).toBe(false);
  });

  it("empties a dollar-quoted body", () => {
    const stripped = stripCommentsAndLiterals(
      "select $tag$ drop table t $tag$",
    );
    expect(stripped).not.toContain("drop");
  });
});

describe("sanitiseDatabaseError", () => {
  it("masks the password in a connection URI", () => {
    const message = sanitiseDatabaseError(
      new Error(
        "connection to postgres://admin:hunter2@db.abcdef.supabase.co:5432/postgres failed",
      ),
    );
    expect(message).not.toContain("hunter2");
    expect(message).toContain("***");
  });

  it("masks a keyword-style password", () => {
    expect(
      sanitiseDatabaseError("FATAL: password=s3cret rejected"),
    ).not.toContain("s3cret");
  });

  it("masks a JWT-shaped key", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwxyz";
    expect(sanitiseDatabaseError(`bad key ${jwt}`)).not.toContain(jwt);
  });

  it("masks a Supabase secret key", () => {
    expect(
      sanitiseDatabaseError("rejected sb_secret_abc123XYZ_key"),
    ).not.toContain("sb_secret_abc123XYZ_key");
  });

  it("keeps the useful part of the message", () => {
    expect(
      sanitiseDatabaseError(new Error('relation "t" does not exist')),
    ).toContain("does not exist");
  });

  it("survives a non-error being thrown", () => {
    expect(sanitiseDatabaseError(undefined)).toBe("Unknown database error");
  });

  it("caps runaway error text", () => {
    expect(sanitiseDatabaseError("x".repeat(5000)).length).toBeLessThanOrEqual(
      500,
    );
  });
});
