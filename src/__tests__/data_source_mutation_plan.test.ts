import { describe, expect, it } from "vitest";

import { validateDataMutationPlan } from "@/lib/data_sources/mutation_plan";
import type { SchemaCatalogue } from "@/lib/data_sources/query_plan";

const catalogue: SchemaCatalogue = {
  tables: [
    {
      schemaName: "public",
      tableName: "investigations",
      columns: [
        { columnName: "id", dataType: "uuid", primaryKey: true },
        { columnName: "code_name", dataType: "text", isUnique: true },
        { columnName: "status", dataType: "text" },
      ],
    },
  ],
  relationships: [],
};

describe("data-source mutation validation", () => {
  it("accepts an insert containing only discovered columns", () => {
    expect(
      validateDataMutationPlan(
        {
          action: "insert",
          table: "investigations",
          values: { code_name: "GayBlade", status: "open" },
        },
        catalogue,
      ).ok,
    ).toBe(true);
  });

  it("rejects writes to unknown tables or columns", () => {
    const result = validateDataMutationPlan(
      {
        action: "insert",
        table: "investigations",
        values: { made_up_column: "x" },
      },
      catalogue,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/made_up_column/);
  });

  it("requires updates and deletes to target a primary or unique key", () => {
    for (const action of ["update", "delete"] as const) {
      const result = validateDataMutationPlan(
        {
          action,
          table: "investigations",
          ...(action === "update" ? { values: { status: "closed" } } : {}),
          filters: [{ column: "status", operator: "=", value: "open" }],
        },
        catalogue,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toMatch(/primary|unique/);
    }
  });

  it("accepts a targeted update", () => {
    expect(
      validateDataMutationPlan(
        {
          action: "update",
          table: "investigations",
          values: { status: "closed" },
          filters: [{ column: "id", operator: "=", value: "case-1" }],
        },
        catalogue,
      ).ok,
    ).toBe(true);
  });
});
