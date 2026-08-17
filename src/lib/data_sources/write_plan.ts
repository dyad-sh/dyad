import type { SchemaCatalogue } from "./query_plan";

/**
 * The structured write plan, and the validator that stands between the model
 * and a customer's data.
 *
 * The same inversion as the query plan: the model never writes SQL. It emits
 * one of these, and this file decides whether it becomes an INSERT. A plan can
 * only express "put these values in these columns of this table", so there is
 * no syntax in which a second statement, a subquery or a DROP can be written
 * in the first place.
 *
 * Writing is deliberately narrower than reading. This can insert rows and
 * nothing else — no updates, no deletes, no schema changes — because those are
 * the operations that destroy data that was already there, and an insert the
 * user did not want is undone by deleting it.
 *
 * Pure, and free of both the driver and Electron, so the rules can be tested
 * exhaustively without a connection.
 */

/** What a cell may hold. Anything else is a structure, and structures are not values. */
export type WriteValue = string | number | boolean | null;

export type WritePlan = {
  table: string;
  /** One object per row: column name to value. */
  rows: Array<Record<string, WriteValue>>;
};

export type WriteValidationError = { message: string };

/** No plan may write more than this many rows at once. */
export const MAX_WRITE_ROWS = 50;

function isWriteValue(value: unknown): value is WriteValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Whether a plan may run, and the plan it may run as.
 *
 * Every name is checked against the discovered schema. A column the schema
 * does not have is a rejection rather than something to be created: this
 * inserts data, it does not change shape.
 */
export function validateWritePlan(
  plan: WritePlan,
  catalogue: SchemaCatalogue,
):
  | { ok: true; plan: WritePlan; columns: string[] }
  | {
      ok: false;
      errors: WriteValidationError[];
    } {
  const errors: WriteValidationError[] = [];

  const table = catalogue.tables.find(
    (known) => known.tableName === plan.table,
  );
  if (!table) {
    return {
      ok: false,
      errors: [
        {
          message: `Table "${plan.table}" is not in the discovered schema.`,
        },
      ],
    };
  }

  if (!Array.isArray(plan.rows) || plan.rows.length === 0) {
    return { ok: false, errors: [{ message: "No rows to insert." }] };
  }
  if (plan.rows.length > MAX_WRITE_ROWS) {
    return {
      ok: false,
      errors: [
        {
          message: `Too many rows at once: ${plan.rows.length}. The limit is ${MAX_WRITE_ROWS}.`,
        },
      ],
    };
  }

  const known = new Set(table.columns.map((column) => column.columnName));

  // Every row writes the same columns. A ragged plan usually means the model
  // lost track of its own shape, and guessing which column a missing value
  // belonged to is exactly the kind of invention this file exists to prevent.
  const columns = Object.keys(plan.rows[0]);
  if (columns.length === 0) {
    return {
      ok: false,
      errors: [{ message: "The first row has no columns." }],
    };
  }

  for (const column of columns) {
    if (!known.has(column)) {
      errors.push({
        message: `Column "${column}" is not in "${plan.table}".`,
      });
    }
  }

  plan.rows.forEach((row, index) => {
    const rowColumns = Object.keys(row);
    if (
      rowColumns.length !== columns.length ||
      !columns.every((column) => column in row)
    ) {
      errors.push({
        message: `Row ${index + 1} has different columns from the first row.`,
      });
      return;
    }
    for (const column of columns) {
      if (!isWriteValue(row[column])) {
        errors.push({
          message: `Row ${index + 1}, column "${column}": only text, numbers, true/false and null can be written.`,
        });
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan, columns };
}

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported identifier: ${value}`);
  }
  return value;
}

/**
 * One parameterised INSERT for a validated plan.
 *
 * Identifiers have already been matched against the discovered schema and are
 * checked again here against a strict pattern; every value is a bind
 * parameter, so nothing a value contains can become SQL.
 */
export function writeSqlFromPlan(
  plan: WritePlan,
  columns: string[],
): { sql: string; params: WriteValue[] } {
  const table = identifier(plan.table);
  const columnList = columns.map(identifier);
  const placeholders = `(${columnList.map(() => "?").join(", ")})`;

  const params: WriteValue[] = [];
  for (const row of plan.rows) {
    for (const column of columns) {
      params.push(row[column]);
    }
  }

  return {
    sql: `INSERT INTO ${table} (${columnList.join(", ")}) VALUES ${plan.rows
      .map(() => placeholders)
      .join(", ")}`,
    params,
  };
}

/** A sentence describing what a plan would do, for the user to approve. */
export function describeWritePlan(plan: WritePlan, columns: string[]): string {
  const rows = plan.rows.length === 1 ? "1 row" : `${plan.rows.length} rows`;
  return `Insert ${rows} into "${plan.table}" (${columns.join(", ")})`;
}
