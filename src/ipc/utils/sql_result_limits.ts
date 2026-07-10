import {
  getSqlDataDeletionAnalysis,
  getSqlSchemaMutationAnalysis,
} from "@/lib/sqlSchemaMutation";
import { takeUtf8Prefix, truncateUtf8 } from "./result_limits";

export type SqlResultLimits = {
  maxRows: number;
  maxBytes: number;
  maxCellBytes: number;
};

export const AGENT_SQL_RESULT_LIMITS: SqlResultLimits = {
  maxRows: 100,
  maxBytes: 128 * 1024,
  maxCellBytes: 8 * 1024,
};

export type SerializedSqlResult = {
  json: string;
  notice: string;
  text: string;
  truncated: boolean;
  totalRows: number | null;
  returnedRows: number | null;
};

type SanitizeState = {
  limits: SqlResultLimits;
  remainingStringBytes: number;
  nodes: number;
  truncated: boolean;
  seen: WeakSet<object>;
};

const MAX_RESULT_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 200;
const MAX_RESULT_NODES = 2_000;
const MAX_OBJECT_KEY_BYTES = 256;

function markTruncated(state: SanitizeState, marker: string): string {
  state.truncated = true;
  return marker;
}

function sanitizeString(value: string, state: SanitizeState): string {
  const allowedBytes = Math.max(
    0,
    Math.min(state.limits.maxCellBytes, state.remainingStringBytes),
  );
  const result = truncateUtf8(value, allowedBytes);
  state.remainingStringBytes -= Buffer.byteLength(result.text, "utf8");
  if (result.truncated) state.truncated = true;
  return result.text;
}

function sanitizeSqlValue(
  value: unknown,
  state: SanitizeState,
  depth: number,
): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_RESULT_NODES) {
    return markTruncated(state, "[result item limit reached]");
  }
  if (depth > MAX_RESULT_DEPTH) {
    return markTruncated(state, "[result depth limit reached]");
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeString(value, state);
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return sanitizeString(value.toString(), state);
  }
  if (typeof value === "undefined") return null;
  if (typeof value === "function" || typeof value === "symbol") {
    return sanitizeString(String(value), state);
  }
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) {
    return markTruncated(
      state,
      `[binary value omitted: ${value.byteLength} bytes]`,
    );
  }
  if (value instanceof ArrayBuffer) {
    return markTruncated(
      state,
      `[binary value omitted: ${value.byteLength} bytes]`,
    );
  }

  if (typeof value !== "object") return String(value);
  if (state.seen.has(value)) {
    return markTruncated(state, "[circular value omitted]");
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const itemLimit = depth === 0 ? state.limits.maxRows : MAX_COLLECTION_ITEMS;
    const result: unknown[] = [];
    const count = Math.min(value.length, itemLimit);
    for (let index = 0; index < count; index += 1) {
      result.push(sanitizeSqlValue(value[index], state, depth + 1));
    }
    if (value.length > count) state.truncated = true;
    return result;
  }

  const result: Record<string, unknown> = {};
  let keyCount = 0;
  for (const rawKey in value) {
    if (!Object.prototype.hasOwnProperty.call(value, rawKey)) continue;
    if (keyCount >= MAX_COLLECTION_ITEMS) {
      state.truncated = true;
      break;
    }
    const key = truncateUtf8(rawKey, MAX_OBJECT_KEY_BYTES).text;
    if (key !== rawKey) state.truncated = true;
    result[key] = sanitizeSqlValue(
      (value as Record<string, unknown>)[rawKey],
      state,
      depth + 1,
    );
    keyCount += 1;
  }
  return result;
}

function fitJsonPreview(json: string, maxBytes: number): string {
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return json;

  // JSON escaping can expand a character to six bytes (for example, a control
  // character becomes `\u0000`). Keep the fallback comfortably inside the
  // budget while still returning valid JSON.
  const previewBytes = Math.max(0, Math.floor((maxBytes - 64) / 6));
  const fallback = JSON.stringify({
    preview: takeUtf8Prefix(json, previewBytes),
    truncated: true,
  });
  if (Buffer.byteLength(fallback, "utf8") <= maxBytes) return fallback;
  return '{"truncated":true}';
}

/**
 * Serialize a database result without materializing an unbounded JSON string.
 * The bounded clone limits rows, nested collections, cell text, and depth
 * before JSON.stringify runs.
 */
export function serializeSqlResult(
  value: unknown,
  limits: SqlResultLimits,
): SerializedSqlResult {
  const totalRows = Array.isArray(value) ? value.length : null;
  const noticeReserve = Math.min(256, Math.floor(limits.maxBytes / 3));
  const jsonBudget = Math.max(20, limits.maxBytes - noticeReserve);
  const state: SanitizeState = {
    limits,
    remainingStringBytes: limits.maxBytes,
    nodes: 0,
    truncated: false,
    seen: new WeakSet(),
  };
  const sanitized = sanitizeSqlValue(value, state, 0);
  let json = JSON.stringify(sanitized);
  if (Buffer.byteLength(json, "utf8") > jsonBudget) {
    state.truncated = true;
    json = fitJsonPreview(json, jsonBudget);
  }

  const returnedRows = Array.isArray(sanitized) ? sanitized.length : null;
  let notice = "";
  if (state.truncated) {
    const rowText =
      totalRows === null
        ? `at most ${limits.maxRows} rows`
        : `${returnedRows} of ${totalRows} rows`;
    const fullNotice = `\n\n[TRUNCATED: SQL result limited to ${rowText} and ${limits.maxBytes} UTF-8 bytes.]`;
    notice = takeUtf8Prefix(
      fullNotice,
      Math.max(0, limits.maxBytes - Buffer.byteLength(json, "utf8")),
    );
  }

  return {
    json,
    notice,
    text: json + notice,
    truncated: state.truncated,
    totalRows,
    returnedRows,
  };
}

export type LimitedSqlQuery = {
  query: string;
  limited: boolean;
};

/**
 * Bound only a classifier-proven, single SELECT. DDL, DML, dynamic SQL,
 * multiple statements, and incomplete SQL are returned byte-for-byte so a
 * safety limit never changes their execution semantics.
 */
export function limitAgentSqlQuery(
  query: string,
  maxRows: number,
): LimitedSqlQuery {
  const schemaAnalysis = getSqlSchemaMutationAnalysis(query);
  const deletionAnalysis = getSqlDataDeletionAnalysis(query);
  const schemaStatement = schemaAnalysis.statements[0];
  const deletionStatement = deletionAnalysis.statements[0];
  const isSingleReadSelect =
    !schemaAnalysis.mutatesSchema &&
    !deletionAnalysis.deletesData &&
    schemaAnalysis.statements.length === 1 &&
    deletionAnalysis.statements.length === 1 &&
    schemaStatement?.command === "SELECT" &&
    deletionStatement?.command === "SELECT";

  if (!isSingleReadSelect || !schemaStatement) {
    return { query, limited: false };
  }

  const cleanSql = schemaStatement.sql.trim().replace(/;+$/, "");
  return {
    query: `SELECT * FROM (\n${cleanSql}\n) AS "dyad_limited_result"\nLIMIT ${maxRows + 1}`,
    limited: true,
  };
}
