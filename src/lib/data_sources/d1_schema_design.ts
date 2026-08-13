import { z } from "zod";

/**
 * A database design, as a structure rather than as SQL.
 *
 * The model proposes this shape and the application writes the SQL from it.
 * That ordering is the whole safety argument: nothing the model writes is
 * executed, so a prompt injected through a description cannot become a
 * statement. What it can do is propose a table, which a person then approves.
 */

/** SQLite's storage classes, plus the two spellings people expect. */
export const D1_COLUMN_TYPES = [
  "TEXT",
  "INTEGER",
  "REAL",
  "BLOB",
  "NUMERIC",
] as const;

export const ProposedColumnSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(D1_COLUMN_TYPES),
  nullable: z.boolean().default(true),
  primaryKey: z.boolean().default(false),
  unique: z.boolean().default(false),
  /** Plain-language note, shown to the user and stored as nothing else. */
  description: z.string().max(200).default(""),
  references: z
    .object({ table: z.string().min(1), column: z.string().min(1) })
    .nullable()
    .default(null),
});

export const ProposedTableSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(200).default(""),
  columns: z.array(ProposedColumnSchema).min(1).max(40),
});

export const ProposedSchemaSchema = z.object({
  tables: z.array(ProposedTableSchema).min(1).max(25),
  /** What the model decided and why, in one or two sentences. */
  summary: z.string().max(600).default(""),
});

export type ProposedColumn = z.infer<typeof ProposedColumnSchema>;
export type ProposedTable = z.infer<typeof ProposedTableSchema>;
export type ProposedSchema = z.infer<typeof ProposedSchemaSchema>;

export class InvalidSchemaError extends Error {}

/** Identifiers must be plain names; anything else is refused, not quoted. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A proposal that can safely become SQL, or a thrown error.
 *
 * Checked rather than trusted even though the model produced it: a name with a
 * quote or a space in it would have to be escaped into the statement, and
 * refusing is both simpler and safer than escaping.
 */
export function validateProposedSchema(schema: ProposedSchema): ProposedSchema {
  const tableNames = new Set<string>();

  for (const table of schema.tables) {
    if (!IDENTIFIER.test(table.name)) {
      throw new InvalidSchemaError(
        `"${table.name}" is not a usable table name.`,
      );
    }
    if (tableNames.has(table.name.toLowerCase())) {
      throw new InvalidSchemaError(`Two tables are both called ${table.name}.`);
    }
    tableNames.add(table.name.toLowerCase());

    const columnNames = new Set<string>();
    for (const column of table.columns) {
      if (!IDENTIFIER.test(column.name)) {
        throw new InvalidSchemaError(
          `"${column.name}" is not a usable column name in ${table.name}.`,
        );
      }
      if (columnNames.has(column.name.toLowerCase())) {
        throw new InvalidSchemaError(
          `${table.name} has two columns called ${column.name}.`,
        );
      }
      columnNames.add(column.name.toLowerCase());

      if (column.references && !IDENTIFIER.test(column.references.table)) {
        throw new InvalidSchemaError(
          `${table.name}.${column.name} points at an unusable table name.`,
        );
      }
    }
  }

  // A foreign key to a table that is not in the design would fail at creation
  // time, remotely, with a less helpful message than this one.
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.references) continue;
      if (!tableNames.has(column.references.table.toLowerCase())) {
        throw new InvalidSchemaError(
          `${table.name}.${column.name} points at ${column.references.table}, which is not in this design.`,
        );
      }
    }
  }

  return schema;
}

/**
 * CREATE TABLE statements for a validated design.
 *
 * Written here, from the structure, rather than taken from the model. Tables
 * are ordered so that a table is created before anything referring to it,
 * since SQLite checks foreign keys at creation.
 */
export function schemaToStatements(schema: ProposedSchema): string[] {
  const validated = validateProposedSchema(schema);
  const byName = new Map(
    validated.tables.map((table) => [table.name.toLowerCase(), table]),
  );

  const ordered: ProposedTable[] = [];
  const placed = new Set<string>();

  const place = (table: ProposedTable, seen: Set<string>) => {
    const key = table.name.toLowerCase();
    if (placed.has(key)) return;
    // A cycle between two tables is legal in SQLite and simply means one of
    // them is created first; visiting is stopped rather than treated as an
    // error.
    if (seen.has(key)) return;
    seen.add(key);

    for (const column of table.columns) {
      const target = column.references
        ? byName.get(column.references.table.toLowerCase())
        : undefined;
      if (target && target.name.toLowerCase() !== key) place(target, seen);
    }

    placed.add(key);
    ordered.push(table);
  };

  for (const table of validated.tables) place(table, new Set());

  return ordered.map((table) => {
    const columns = table.columns.map((column) => {
      const parts = [column.name, column.type];
      if (column.primaryKey) parts.push("PRIMARY KEY");
      if (!column.nullable && !column.primaryKey) parts.push("NOT NULL");
      if (column.unique && !column.primaryKey) parts.push("UNIQUE");
      if (column.references) {
        parts.push(
          `REFERENCES ${column.references.table}(${column.references.column})`,
        );
      }
      return `  ${parts.join(" ")}`;
    });

    return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${columns.join(",\n")}\n)`;
  });
}
