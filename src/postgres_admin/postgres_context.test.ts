import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted, so the shared mock state has to be hoisted too.
const h = vi.hoisted(() => {
  const instances: Array<{
    config: { connectionString: string; ssl?: unknown };
    connect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  }> = [];
  let failOn: string | null = null;
  return {
    instances,
    /** Makes the next client reject this exact statement. */
    failStatement(sql: string | null) {
      failOn = sql;
    },
    shouldFail: (sql: string) => failOn !== null && sql === failOn,
    reset() {
      instances.length = 0;
      failOn = null;
    },
  };
});

vi.mock("pg", () => {
  class MockClient {
    connect = vi.fn(async () => undefined);
    end = vi.fn(async () => undefined);
    query = vi.fn(async (sql: string) => {
      if (h.shouldFail(sql)) throw new Error("syntax error");
      return { rows: [] };
    });
    constructor(public readonly config: { connectionString: string }) {
      h.instances.push(this as never);
    }
  }
  return { Client: MockClient };
});
vi.mock("@/ipc/utils/test_utils", () => ({ IS_TEST_BUILD: false }));

import {
  executePostgresSql,
  executePostgresStatementsInTransaction,
  testPostgresConnection,
} from "./postgres_context";

const PLAIN = "postgres://u:p@127.0.0.1:15432/db";
const WITH_SSL = "postgres://u:p@host.neon.tech/db?sslmode=require";

const executedSql = () => h.instances[0].query.mock.calls.map((c) => c[0]);

describe("postgres_context", () => {
  beforeEach(() => h.reset());

  it("enables TLS only when the connection string asks for it", async () => {
    await executePostgresSql({ connectionString: WITH_SSL, query: "SELECT 1" });
    expect(h.instances[0].config.ssl).toBeTruthy();
  });

  it("leaves TLS off for a tunnelled connection", async () => {
    await executePostgresSql({ connectionString: PLAIN, query: "SELECT 1" });
    expect(h.instances[0].config.ssl).toBeUndefined();
  });

  it("treats sslmode=disable as no TLS", async () => {
    await executePostgresSql({
      connectionString: "postgres://u:p@h/db?sslmode=disable",
      query: "SELECT 1",
    });
    expect(h.instances[0].config.ssl).toBeUndefined();
  });

  it("applies statements sequentially inside one transaction", async () => {
    await executePostgresStatementsInTransaction({
      connectionString: PLAIN,
      statements: ["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"],
    });
    // The Neon HTTP driver batches unawaited promises; pg must not, so this
    // ordering is the contract.
    expect(executedSql()).toEqual([
      "BEGIN",
      "CREATE TABLE a (id int)",
      "CREATE TABLE b (id int)",
      "COMMIT",
    ]);
  });

  it("rolls back when a statement fails", async () => {
    h.failStatement("BOOM");
    await expect(
      executePostgresStatementsInTransaction({
        connectionString: PLAIN,
        statements: ["BOOM"],
      }),
    ).rejects.toThrow(/rolled back/i);
    expect(executedSql()).toContain("ROLLBACK");
    expect(executedSql()).not.toContain("COMMIT");
  });

  it("skips work entirely when there are no statements", async () => {
    const result = await executePostgresStatementsInTransaction({
      connectionString: PLAIN,
      statements: [],
    });
    expect(result).toEqual({ executed: 0 });
    expect(h.instances).toHaveLength(0);
  });

  it("always closes the connection, including on failure", async () => {
    h.failStatement("BAD");
    await expect(
      executePostgresSql({ connectionString: PLAIN, query: "BAD" }),
    ).rejects.toThrow();
    expect(h.instances[0].end).toHaveBeenCalled();
  });

  it("reports a reachable database", async () => {
    await expect(testPostgresConnection(PLAIN)).resolves.toEqual({ ok: true });
  });

  it("reports the reason a database is unreachable", async () => {
    h.failStatement("SELECT 1");
    await expect(testPostgresConnection(PLAIN)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("syntax error"),
    });
  });
});
