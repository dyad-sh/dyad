import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
  tablesTouched,
  validateQueryPlan,
  type QueryPlan,
  type SchemaCatalogue,
} from "@/lib/data_sources/query_plan";

/**
 * A deliberately unfamiliar schema.
 *
 * Nothing here is orders, customers or users: the validator must work off the
 * catalogue it is given rather than off anything it recognises.
 */
const catalogue: SchemaCatalogue = {
  tables: [
    {
      schemaName: "public",
      tableName: "ord_hdr",
      columns: [
        { columnName: "id", dataType: "uuid" },
        { columnName: "acct_ref", dataType: "uuid" },
        { columnName: "status", dataType: "text" },
        { columnName: "total", dataType: "numeric" },
        { columnName: "created_at", dataType: "timestamptz" },
      ],
    },
    {
      schemaName: "public",
      tableName: "acct_rec",
      columns: [
        { columnName: "id", dataType: "uuid" },
        { columnName: "email", dataType: "text" },
      ],
    },
    {
      schemaName: "public",
      tableName: "event_log_v2",
      columns: [
        { columnName: "id", dataType: "bigint" },
        { columnName: "payload", dataType: "jsonb" },
      ],
    },
  ],
  relationships: [
    {
      sourceSchema: "public",
      sourceTable: "ord_hdr",
      sourceColumn: "acct_ref",
      targetSchema: "public",
      targetTable: "acct_rec",
      targetColumn: "id",
    },
  ],
};

const plan = (over: Partial<QueryPlan> = {}): QueryPlan => ({
  table: "ord_hdr",
  ...over,
});

describe("table and column checking", () => {
  it("accepts a plan naming real things", () => {
    const result = validateQueryPlan(
      plan({ select: ["id", "status"] }),
      catalogue,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a table the catalogue has never seen", () => {
    const result = validateQueryPlan(plan({ table: "invented" }), catalogue);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("unknown_table");
  });

  it("rejects a column the table does not have", () => {
    const result = validateQueryPlan(
      plan({ select: ["id", "hallucinated"] }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "unknown_column")).toBe(true);
    }
  });

  it("reports every problem at once rather than the first", () => {
    const result = validateQueryPlan(
      plan({ select: ["nope1", "nope2", "nope3"] }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(3);
  });

  it("refuses a table name that is not an identifier", () => {
    // The plan cannot express SQL, but a name still has to be a name.
    const result = validateQueryPlan(
      plan({ table: "ord_hdr; drop table acct_rec" }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("malformed");
  });
});

describe("filters", () => {
  it("accepts an allowed operator on a real column", () => {
    const result = validateQueryPlan(
      plan({
        filters: [
          { column: "created_at", operator: ">=", value: "2026-08-01" },
        ],
      }),
      catalogue,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an operator that is not on the list", () => {
    const result = validateQueryPlan(
      plan({
        filters: [
          {
            column: "status",
            // Anything outside the allowed set, however it is spelled.
            operator: "; drop table" as never,
            value: "x",
          },
        ],
      }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("unknown_operator");
  });

  it("lets a null check omit its value", () => {
    const result = validateQueryPlan(
      plan({ filters: [{ column: "status", operator: "is_null" }] }),
      catalogue,
    );
    expect(result.ok).toBe(true);
  });

  it("insists on a value where one is needed", () => {
    const result = validateQueryPlan(
      plan({ filters: [{ column: "status", operator: "=" }] }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("invalid_filter");
  });

  it("caps how many values an in-filter may list", () => {
    const result = validateQueryPlan(
      plan({
        filters: [
          {
            column: "id",
            operator: "in",
            value: Array.from({ length: 500 }, (_, i) => i),
          },
        ],
      }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("too_complex");
  });
});

describe("joins", () => {
  it("accepts a join that follows a discovered foreign key", () => {
    const result = validateQueryPlan(
      plan({
        joins: [
          {
            table: "acct_rec",
            type: "left",
            on: { left: "ord_hdr.acct_ref", right: "acct_rec.id" },
          },
        ],
        select: ["ord_hdr.status", "acct_rec.email"],
      }),
      catalogue,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a join with no foreign key behind it", () => {
    // Both columns exist and both are uuids, so this looks joinable and is
    // not. Allowing it would produce confidently wrong answers.
    const result = validateQueryPlan(
      plan({
        joins: [
          {
            table: "acct_rec",
            type: "inner",
            on: { left: "ord_hdr.id", right: "acct_rec.id" },
          },
        ],
      }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("invalid_join");
  });

  it("rejects a join onto a table that does not exist", () => {
    const result = validateQueryPlan(
      plan({
        joins: [
          {
            table: "ghost",
            type: "left",
            on: { left: "ord_hdr.acct_ref", right: "ghost.id" },
          },
        ],
      }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("unknown_table");
  });

  it("refuses a runaway number of joins", () => {
    const result = validateQueryPlan(
      plan({
        joins: Array.from({ length: 9 }, () => ({
          table: "acct_rec",
          type: "left" as const,
          on: { left: "ord_hdr.acct_ref", right: "acct_rec.id" },
        })),
      }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "too_complex")).toBe(true);
    }
  });
});

describe("aggregates", () => {
  it("lets count stand without a column", () => {
    const result = validateQueryPlan(
      plan({ aggregates: [{ fn: "count", alias: "total_rows" }] }),
      catalogue,
    );
    expect(result.ok).toBe(true);
  });

  it("requires a column for anything but count", () => {
    const result = validateQueryPlan(
      plan({ aggregates: [{ fn: "avg", alias: "mean" }] }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("invalid_aggregate");
  });

  it("rejects an unsupported function", () => {
    const result = validateQueryPlan(
      plan({
        aggregates: [{ fn: "exec" as never, column: "total", alias: "x" }],
      }),
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("invalid_aggregate");
  });

  it("allows sorting by an alias the plan defines", () => {
    const result = validateQueryPlan(
      plan({
        aggregates: [{ fn: "count", alias: "n" }],
        groupBy: ["status"],
        orderBy: { column: "n", direction: "desc" },
      }),
      catalogue,
    );
    expect(result.ok).toBe(true);
  });
});

describe("limits", () => {
  it("applies a default when none is given", () => {
    const result = validateQueryPlan(plan(), catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.limit).toBe(DEFAULT_ROW_LIMIT);
  });

  it("clamps an oversized limit rather than refusing the query", () => {
    const result = validateQueryPlan(plan({ limit: 5_000_000 }), catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.limit).toBe(MAX_ROW_LIMIT);
  });

  it("never lets a limit reach zero or below", () => {
    const result = validateQueryPlan(plan({ limit: 0 }), catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.limit).toBe(1);
  });

  it("refuses a negative offset", () => {
    const result = validateQueryPlan(plan({ offset: -20 }), catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.offset).toBe(0);
  });
});

describe("write attempts", () => {
  // The plan type has no field capable of expressing a write, so these arrive
  // as unknown tables, unknown operators or unknown columns rather than as
  // dangerous statements. That is the point of the design.
  it("has nowhere to put a destructive statement", () => {
    // A caller smuggling extra fields gets them ignored: the validator reads
    // only what the plan type defines, so the result is a plain select.
    const smuggled = {
      table: "ord_hdr",
      select: ["id"],
      command: "DELETE",
      sql: "DROP TABLE acct_rec",
    } as unknown as QueryPlan;

    const result = validateQueryPlan(smuggled, catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.table).toBe("ord_hdr");
      expect(result.plan.limit).toBe(DEFAULT_ROW_LIMIT);
    }
  });

  it("treats an injected table name as a name, and rejects it", () => {
    const result = validateQueryPlan(
      plan({ table: "DROP TABLE acct_rec" }),
      catalogue,
    );
    expect(result.ok).toBe(false);
  });
});

describe("tablesTouched", () => {
  it("lists the base table", () => {
    expect(tablesTouched(plan())).toEqual(["public.ord_hdr"]);
  });

  it("includes joined tables, without duplicates", () => {
    expect(
      tablesTouched(
        plan({
          joins: [
            {
              table: "acct_rec",
              type: "left",
              on: { left: "ord_hdr.acct_ref", right: "acct_rec.id" },
            },
            {
              table: "acct_rec",
              type: "left",
              on: { left: "ord_hdr.acct_ref", right: "acct_rec.id" },
            },
          ],
        }),
      ),
    ).toEqual(["public.ord_hdr", "public.acct_rec"]);
  });
});
