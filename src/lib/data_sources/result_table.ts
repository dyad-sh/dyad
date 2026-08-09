/**
 * Turns returned rows into a table the renderer can lay out.
 *
 * Formatting happens once, here, rather than per cell in the component: a
 * timestamp shown one way in one column and another way in the next is the
 * kind of inconsistency nobody reports and everybody notices.
 *
 * Column order follows the first row's keys, which is the order the query
 * asked for. Sorting them alphabetically would be tidier and would separate
 * columns the user deliberately put next to each other.
 */

/** Wide enough to read, short enough that one cell cannot dominate a row. */
const MAX_CELL_LENGTH = 300;

/** Beyond this a table stops being readable and starts being a data dump. */
export const MAX_TABLE_COLUMNS = 40;

/**
 * One value as display text.
 *
 * Null and undefined become an empty string, which the renderer shows as a
 * dash: an empty cell is ambiguous between "no value" and "failed to render",
 * and the two deserve to look different.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);

  if (typeof value === "string") {
    // ISO timestamps are the most common unreadable value in a result set.
    // Rendered in the user's locale, they become scannable.
    const timestamp =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(
        value,
      );
    if (timestamp) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });
      }
    }
    return value.length > MAX_CELL_LENGTH
      ? `${value.slice(0, MAX_CELL_LENGTH)}…`
      : value;
  }

  // Objects and arrays are JSON columns. Compact rather than pretty-printed,
  // because a cell is one line.
  try {
    const json = JSON.stringify(value);
    return json.length > MAX_CELL_LENGTH
      ? `${json.slice(0, MAX_CELL_LENGTH)}…`
      : json;
  } catch {
    return String(value);
  }
}

export type ResultTable = {
  columns: string[];
  rows: string[][];
  /** Columns dropped because the result was impractically wide. */
  truncatedColumns: number;
};

/**
 * Builds the table.
 *
 * Every returned row is kept. Only columns are ever dropped, and only past a
 * generous ceiling, because a missing row changes the answer while a missing
 * column past the fortieth changes only how much scrolling there is.
 */
export function buildResultTable(rows: unknown[]): ResultTable {
  const objects = rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );

  if (objects.length === 0) {
    // A scalar result, such as a single aggregate, still deserves a table.
    if (rows.length > 0) {
      return {
        columns: ["value"],
        rows: rows.map((row) => [formatCell(row)]),
        truncatedColumns: 0,
      };
    }
    return { columns: [], rows: [], truncatedColumns: 0 };
  }

  // Union of keys in first-seen order, so a row missing a field does not hide
  // a column that later rows have.
  const seen: string[] = [];
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }

  const columns = seen.slice(0, MAX_TABLE_COLUMNS);

  return {
    columns,
    rows: objects.map((row) => columns.map((key) => formatCell(row[key]))),
    truncatedColumns: Math.max(0, seen.length - columns.length),
  };
}
