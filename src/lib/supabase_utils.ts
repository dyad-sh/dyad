/**
 * Shared utilities for Supabase database viewer functionality.
 */

/**
 * Format a cell value for display.
 * Handles null, undefined, objects, and long strings.
 */
export function formatCellValue(value: unknown): string {
  if (value === null) {
    return "NULL";
  }
  if (value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      // Truncate long JSON
      return json.length > 100 ? json.slice(0, 100) + "..." : json;
    } catch {
      return "[Object]";
    }
  }
  const str = String(value);
  // Truncate long strings
  return str.length > 100 ? str.slice(0, 100) + "..." : str;
}

/**
 * Validate table name against allowed pattern.
 * Table names must start with a letter or underscore,
 * followed by alphanumeric characters or underscores.
 */
export function isValidTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Calculate pagination info.
 */
export function getPaginationInfo(
  total: number | null,
  limit: number,
  offset: number,
): {
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
  currentPage: number;
  totalPages: number | null;
} {
  // For empty tables, start should be 0 to avoid showing "1-0"
  const isEmpty = total === 0;
  const start = isEmpty ? 0 : offset + 1;
  const end = total !== null ? Math.min(offset + limit, total) : offset + limit;
  const hasPrev = offset > 0;
  const hasNext = total !== null ? offset + limit < total : false;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = total !== null ? Math.ceil(total / limit) : null;

  return { start, end, hasPrev, hasNext, currentPage, totalPages };
}

/**
 * Safely parse JSON with error handling.
 * @param result - The JSON string to parse
 * @param context - Context for error messages (e.g., "Supabase listTables response")
 * @returns Parsed JSON value
 * @throws Error with context if parsing fails
 */
export function safeJsonParse<T = unknown>(result: string, context: string): T {
  try {
    return JSON.parse(result) as T;
  } catch {
    throw new Error(
      `Failed to parse ${context}: ${result.slice(0, 100)}${result.length > 100 ? "..." : ""}`,
    );
  }
}
