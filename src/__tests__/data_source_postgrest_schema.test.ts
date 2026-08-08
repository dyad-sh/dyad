import { describe, expect, it } from "vitest";

import {
  classifyHttpStatus,
  generateKeyId,
  looksLikeSupabaseKey,
  parsePostgrestSchema,
} from "@/lib/data_sources/postgrest_schema";

/**
 * A deliberately unfamiliar project.
 *
 * Nothing here is orders or customers: discovery must work off the document,
 * not off names it happens to recognise.
 */
const document = {
  definitions: {
    ord_hdr: {
      required: ["id", "acct_ref"],
      properties: {
        id: {
          format: "uuid",
          type: "string",
          description: "Note:\nThis is a Primary Key<pk/>",
        },
        acct_ref: {
          format: "uuid",
          type: "string",
          description:
            "Note:\nThis is a Foreign Key to `acct_rec.id`.<fk table='acct_rec' column='id'/>",
        },
        status: { format: "text", type: "string" },
        payload: { format: "jsonb", type: "string" },
        created_at: { format: "timestamp with time zone", type: "string" },
      },
    },
    acct_rec: {
      required: ["id"],
      properties: {
        id: {
          format: "uuid",
          type: "string",
          description: "Note:\nThis is a Primary Key<pk/>",
        },
        email: { format: "text", type: "string", description: "Contact email" },
      },
    },
    active_summary: {
      properties: {
        total: { format: "bigint", type: "integer" },
      },
    },
  },
};

describe("parsePostgrestSchema", () => {
  const parsed = parsePostgrestSchema(document);

  it("finds every table in the document", () => {
    expect(parsed.tables.map((table) => table.tableName)).toEqual([
      "acct_rec",
      "active_summary",
      "ord_hdr",
    ]);
  });

  it("reads the real Postgres type rather than flattening to string", () => {
    const table = parsed.tables.find((each) => each.tableName === "ord_hdr")!;
    const byName = Object.fromEntries(
      table.columns.map((column) => [column.columnName, column.dataType]),
    );
    expect(byName.id).toBe("uuid");
    expect(byName.payload).toBe("jsonb");
    expect(byName.created_at).toBe("timestamp with time zone");
  });

  it("detects primary keys from the marker", () => {
    const table = parsed.tables.find((each) => each.tableName === "acct_rec")!;
    expect(table.columns.find((c) => c.columnName === "id")!.primaryKey).toBe(
      true,
    );
    expect(
      table.columns.find((c) => c.columnName === "email")!.primaryKey,
    ).toBe(false);
  });

  it("builds the relationship map from foreign key markers", () => {
    expect(parsed.relationships).toEqual([
      {
        sourceTable: "ord_hdr",
        sourceColumn: "acct_ref",
        targetTable: "acct_rec",
        targetColumn: "id",
      },
    ]);
  });

  it("treats a definition with no primary key as a view", () => {
    const view = parsed.tables.find(
      (each) => each.tableName === "active_summary",
    )!;
    expect(view.tableType).toBe("view");
  });

  it("marks required columns as not nullable", () => {
    const table = parsed.tables.find((each) => each.tableName === "ord_hdr")!;
    expect(
      table.columns.find((c) => c.columnName === "acct_ref")!.nullable,
    ).toBe(false);
    expect(table.columns.find((c) => c.columnName === "status")!.nullable).toBe(
      true,
    );
  });

  it("strips the machine markers out of descriptions", () => {
    const table = parsed.tables.find((each) => each.tableName === "ord_hdr")!;
    const description = table.columns.find(
      (c) => c.columnName === "acct_ref",
    )!.description;
    expect(description).not.toContain("<fk");
    expect(description).not.toMatch(/^Note:/);
    expect(description).toContain("Foreign Key");
  });
});

describe("malformed documents", () => {
  it("survives an empty document", () => {
    expect(parsePostgrestSchema({})).toEqual({ tables: [], relationships: [] });
  });

  it("survives null", () => {
    expect(parsePostgrestSchema(null).tables).toEqual([]);
  });

  it("skips a definition with no properties without losing the rest", () => {
    const parsed = parsePostgrestSchema({
      definitions: {
        broken: { description: "no properties here" },
        fine: { properties: { id: { type: "string" } } },
      },
    });
    expect(parsed.tables.map((table) => table.tableName)).toEqual(["fine"]);
  });

  it("skips a non-object property rather than throwing", () => {
    const parsed = parsePostgrestSchema({
      definitions: {
        t: { properties: { a: "nonsense", b: { type: "string" } } },
      },
    });
    expect(parsed.tables[0]!.columns.map((c) => c.columnName)).toEqual(["b"]);
  });
});

describe("classifyHttpStatus", () => {
  it("separates a bad key from an unreachable project", () => {
    // The user can fix one of these in ten seconds and not the other, so
    // "failed" for both would be useless.
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("auth");
    expect(classifyHttpStatus(404)).toBe("not_found");
    expect(classifyHttpStatus(503)).toBe("unreachable");
  });

  it("returns null for success", () => {
    expect(classifyHttpStatus(200)).toBeNull();
    expect(classifyHttpStatus(204)).toBeNull();
  });
});

describe("looksLikeSupabaseKey", () => {
  it("accepts the current key formats", () => {
    expect(looksLikeSupabaseKey("sb_publishable_abcdefgh1234")).toBe(true);
    expect(looksLikeSupabaseKey("sb_secret_abcdefgh1234")).toBe(true);
  });

  it("accepts a legacy JWT key", () => {
    expect(
      looksLikeSupabaseKey("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"),
    ).toBe(true);
  });

  it("rejects a project URL pasted into the key box", () => {
    expect(looksLikeSupabaseKey("https://abc.supabase.co")).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(looksLikeSupabaseKey("   ")).toBe(false);
  });
});

describe("generateKeyId", () => {
  it("produces the documented shape", () => {
    expect(generateKeyId(() => 0.5)).toMatch(/^SUP-[0-9A-F]{6}$/);
  });

  it("is random rather than derived from the secret", () => {
    // Anything derived from a key is a small leak of that key.
    const ids = new Set(Array.from({ length: 50 }, () => generateKeyId()));
    expect(ids.size).toBeGreaterThan(40);
  });
});
