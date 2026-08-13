import { describe, expect, it } from "vitest";

import {
  InvalidSchemaError,
  schemaToStatements,
  validateProposedSchema,
  type ProposedSchema,
} from "@/lib/data_sources/d1_schema_design";

/**
 * The model proposes a structure and this writes the SQL, so these tests are
 * about the boundary holding: a name the model invented must never be able to
 * become syntax, and a design that would fail remotely should fail here with a
 * sentence someone can act on.
 */

const schema = (tables: ProposedSchema["tables"]): ProposedSchema => ({
  tables,
  summary: "",
});

const column = (
  name: string,
  extra: Partial<ProposedSchema["tables"][0]["columns"][0]> = {},
) => ({
  name,
  type: "TEXT" as const,
  nullable: true,
  primaryKey: false,
  unique: false,
  description: "",
  references: null,
  ...extra,
});

describe("validating a proposed design", () => {
  it("refuses a name that would have to be escaped", () => {
    for (const name of ["custo mers", "customers; DROP TABLE x", '"users"']) {
      expect(
        () =>
          validateProposedSchema(
            schema([{ name, description: "", columns: [column("id")] }]),
          ),
        name,
      ).toThrow(InvalidSchemaError);
    }

    expect(() =>
      validateProposedSchema(
        schema([{ name: "t", description: "", columns: [column("bad name")] }]),
      ),
    ).toThrow(InvalidSchemaError);
  });

  it("refuses duplicates rather than letting the database decide", () => {
    expect(() =>
      validateProposedSchema(
        schema([
          { name: "t", description: "", columns: [column("id")] },
          { name: "T", description: "", columns: [column("id")] },
        ]),
      ),
    ).toThrow(/both called/);

    expect(() =>
      validateProposedSchema(
        schema([
          {
            name: "t",
            description: "",
            columns: [column("id"), column("ID")],
          },
        ]),
      ),
    ).toThrow(/two columns/);
  });

  it("refuses a foreign key to a table that is not in the design", () => {
    // Otherwise this fails at creation time, remotely, less helpfully.
    expect(() =>
      validateProposedSchema(
        schema([
          {
            name: "orders",
            description: "",
            columns: [
              column("customer_id", {
                references: { table: "customers", column: "id" },
              }),
            ],
          },
        ]),
      ),
    ).toThrow(/not in this design/);
  });
});

describe("turning a design into SQL", () => {
  it("writes a table with its constraints", () => {
    const [sql] = schemaToStatements(
      schema([
        {
          name: "customers",
          description: "",
          columns: [
            column("id", { type: "INTEGER", primaryKey: true }),
            column("email", { nullable: false, unique: true }),
            column("name"),
          ],
        },
      ]),
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS customers");
    expect(sql).toContain("id INTEGER PRIMARY KEY");
    expect(sql).toContain("email TEXT NOT NULL UNIQUE");
    expect(sql).toContain("name TEXT");
  });

  it("creates a referenced table before the table referring to it", () => {
    const statements = schemaToStatements(
      schema([
        {
          name: "orders",
          description: "",
          columns: [
            column("id", { type: "INTEGER", primaryKey: true }),
            column("customer_id", {
              type: "INTEGER",
              references: { table: "customers", column: "id" },
            }),
          ],
        },
        {
          name: "customers",
          description: "",
          columns: [column("id", { type: "INTEGER", primaryKey: true })],
        },
      ]),
    );

    // SQLite checks the reference when the table is created, so order matters.
    expect(statements[0]).toContain("customers");
    expect(statements[1]).toContain("orders");
    expect(statements[1]).toContain("REFERENCES customers(id)");
  });

  it("terminates on a cycle rather than recursing forever", () => {
    const statements = schemaToStatements(
      schema([
        {
          name: "a",
          description: "",
          columns: [
            column("b_id", { references: { table: "b", column: "id" } }),
          ],
        },
        {
          name: "b",
          description: "",
          columns: [
            column("a_id", { references: { table: "a", column: "id" } }),
          ],
        },
      ]),
    );
    expect(statements).toHaveLength(2);
  });

  it("does not mark a primary key as NOT NULL as well", () => {
    // Valid but noisy, and SQLite already implies it.
    const [sql] = schemaToStatements(
      schema([
        {
          name: "t",
          description: "",
          columns: [
            column("id", {
              type: "INTEGER",
              primaryKey: true,
              nullable: false,
            }),
          ],
        },
      ]),
    );
    expect(sql).toContain("id INTEGER PRIMARY KEY");
    expect(sql).not.toContain("PRIMARY KEY NOT NULL");
  });
});
