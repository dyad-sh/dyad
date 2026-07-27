import {
  getSqlDataDeletionAnalysis,
  getSqlSchemaMutationAnalysis,
} from "@/lib/sqlSchemaMutation";

const SAFE_CALL_IDENTIFIERS = new Set([
  "all",
  "and",
  "any",
  "abs",
  "array",
  "as",
  "avg",
  "by",
  "case",
  "cast",
  "ceil",
  "coalesce",
  "concat",
  "count",
  "current_date",
  "current_setting",
  "current_timestamp",
  "date_trunc",
  "exists",
  "extract",
  "floor",
  "from",
  "greatest",
  "group",
  "having",
  "in",
  "join",
  "json_agg",
  "jsonb_agg",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "now",
  "not",
  "nullif",
  "on",
  "or",
  "order",
  "over",
  "partition",
  "round",
  "select",
  "sum",
  "then",
  "to_char",
  "trim",
  "upper",
  "union",
  "using",
  "values",
  "version",
  "when",
  "where",
]);

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

function stripSqlStringLiterals(statement: string): string {
  return statement
    .replace(/\$([a-z_]\w*)?\$[\s\S]*?\$\1\$/gi, " ")
    .replace(/'(?:[^']|'')*'/g, " ");
}

function callsUnknownFunction(statement: string): boolean {
  for (const [, name] of statement.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (!SAFE_CALL_IDENTIFIERS.has(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function doesStatementLikelyMutateState(statement: string): boolean {
  const scannable = stripSqlStringLiterals(statement);
  if (/^with\b/i.test(scannable)) {
    return /\b(insert|update|delete|merge)\b/i.test(scannable);
  }
  const explained = scannable.match(/^explain(?:\s+analyze)?\s+(.+)$/i);
  if (explained) {
    return doesStatementLikelyMutateState(explained[1].trim());
  }
  if (!/^(?:select|show|describe|desc)\b/i.test(scannable)) {
    return true;
  }
  if (!/^select\b/i.test(scannable)) {
    return false;
  }
  if (/\binto\s+(?!@)/i.test(scannable)) {
    return true;
  }
  return callsUnknownFunction(scannable);
}

export function doesSqlLikelyMutateState(sql: string): boolean {
  if (
    getSqlSchemaMutationAnalysis(sql).mutatesSchema ||
    getSqlDataDeletionAnalysis(sql).deletesData
  ) {
    return true;
  }
  return stripSqlComments(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .some(doesStatementLikelyMutateState);
}

function isStatementSafeForAutoApproval(
  statement: string,
  command: string | null,
): boolean {
  const scannable = stripSqlStringLiterals(statement).trim();
  switch (command) {
    case "SELECT":
      return (
        /^select\s+\S/i.test(scannable) && !callsUnknownFunction(scannable)
      );
    case "SHOW":
    case "DESC":
    case "DESCRIBE":
      return /^(?:show|desc|describe)\s+\S/i.test(scannable);
    case "VALUES":
      return (
        /^values\s+\S/i.test(scannable) && !callsUnknownFunction(scannable)
      );
    case "INSERT": {
      const withoutTarget = scannable.replace(
        /^insert\s+into\s+(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_]*)(?:\.(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_]*))?\s*(?:\([^)]*\))?/i,
        "INSERT ",
      );
      return (
        withoutTarget !== scannable &&
        /\b(?:values|select|default\s+values)\b/i.test(withoutTarget) &&
        !callsUnknownFunction(withoutTarget)
      );
    }
    default:
      return false;
  }
}

export function isSqlSafeForAutoApproval(sql: string): boolean {
  const schema = getSqlSchemaMutationAnalysis(sql);
  const deletion = getSqlDataDeletionAnalysis(sql);
  if (
    schema.mutatesSchema ||
    deletion.deletesData ||
    schema.statements.length === 0 ||
    schema.statements.length !== deletion.statements.length
  ) {
    return false;
  }

  return schema.statements.every((statement) =>
    isStatementSafeForAutoApproval(statement.sql, statement.command),
  );
}
