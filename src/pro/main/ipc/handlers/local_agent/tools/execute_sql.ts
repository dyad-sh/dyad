import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { executeSupabaseSql } from "../../../../../../supabase_admin/supabase_management_client";
import { executeNeonSql } from "../../../../../../neon_admin/neon_context";
import { writeMigrationFile } from "../../../../../../ipc/utils/file_utils";
import { readSettings } from "../../../../../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  doesSqlDeleteData,
  doesSqlMutateSchema,
} from "@/lib/sqlSchemaMutation";

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

/**
 * Blank out string literals so tokens *inside* them aren't misread as SQL
 * keywords or function calls by the read-only classifier. Without this a plain
 * read like `SELECT 'into staging_users'` matches the `into` mutation check and
 * is wrongly recorded as a mutation, letting run_tests rerun with no app change.
 * Dollar-quoted strings are stripped before single-quoted ones because their
 * body can itself contain single quotes.
 */
function stripSqlStringLiterals(statement: string): string {
  return statement
    .replace(/\$([a-z_]\w*)?\$[\s\S]*?\$\1\$/gi, " ")
    .replace(/'(?:[^']|'')*'/g, " ");
}

/**
 * Identifiers that may precede a `(` in a read-only `select` without implying a
 * function call that could mutate: SQL keywords (`where (a or b)`, `in (...)`)
 * plus well-known read-only builtins. Anything else — e.g. `SELECT seed()` —
 * may be a user-defined function that writes.
 */
const SELECT_SAFE_IDENTIFIERS = new Set([
  // Keywords that are followed by a parenthesized expression, not a call.
  "all",
  "and",
  "any",
  "as",
  "by",
  "case",
  "exists",
  "from",
  "group",
  "having",
  "in",
  "join",
  "not",
  "on",
  "or",
  "order",
  "over",
  "partition",
  "select",
  "then",
  "union",
  "using",
  "values",
  "when",
  "where",
  // Read-only builtins.
  "abs",
  "avg",
  "cast",
  "ceil",
  "coalesce",
  "concat",
  "count",
  "current_date",
  "current_setting",
  "current_timestamp",
  "date_trunc",
  "extract",
  "floor",
  "greatest",
  "json_agg",
  "jsonb_agg",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "now",
  "nullif",
  "round",
  "sum",
  "to_char",
  "trim",
  "upper",
  "version",
]);

/**
 * True when a `select` calls anything other than a known read-only builtin.
 * `SELECT seed_demo_data()` really does mutate, and treating it as a no-op
 * would leave run_tests refusing the verifying rerun.
 */
function doesSelectCallUnknownFunction(statement: string): boolean {
  for (const [, name] of statement.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (!SELECT_SAFE_IDENTIFIERS.has(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function doesStatementLikelyMutateState(statement: string): boolean {
  // Classify against a copy with string literals blanked out so keywords and
  // function calls appearing inside literals don't skew the result.
  const scannable = stripSqlStringLiterals(statement);
  if (/^with\b/i.test(scannable)) {
    return /\b(insert|update|delete|merge)\b/i.test(scannable);
  }
  const explained = scannable.match(/^explain(?:\s+analyze)?\s+(.+)$/i);
  if (explained) {
    return doesStatementLikelyMutateState(explained[1].trim());
  }
  // Treat clearly read-only statements as no-ops for run_tests gating. Unknown
  // SQL is counted conservatively because function calls and procedural blocks
  // can mutate data even when static analysis cannot prove it.
  if (!/^(?:select|show|describe|desc)\b/i.test(scannable)) {
    return true;
  }
  if (!/^select\b/i.test(scannable)) {
    // show / describe / desc are read-only.
    return false;
  }
  // `SELECT ... INTO new_table` creates a table in PostgreSQL (a schema
  // mutation) even though the statement still begins with SELECT, so the
  // read-only classification below would otherwise miss it and leave run_tests
  // refusing the verifying rerun. `(?!@)` skips `SELECT ... INTO @var` variable
  // assignment, which doesn't create a table.
  if (/\binto\s+(?!@)/i.test(scannable)) {
    return true;
  }
  return doesSelectCallUnknownFunction(scannable);
}

/**
 * Inspect EVERY statement, not just the first: `SELECT 1; UPDATE users ...`
 * mutates, and classifying the whole call by its leading `SELECT` would leave
 * run_tests refusing the next run with "no changes since last run".
 */
function doesSqlLikelyMutateState(sql: string): boolean {
  if (doesSqlMutateSchema(sql) || doesSqlDeleteData(sql)) {
    return true;
  }
  return stripSqlComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .some(doesStatementLikelyMutateState);
}

const executeSqlSchema = z.object({
  query: z.string().describe("The SQL query to execute"),
  description: z.string().optional().describe("Brief description of the query"),
});

export const executeSqlTool: ToolDefinition<z.infer<typeof executeSqlSchema>> =
  {
    name: "execute_sql",
    description:
      "Execute SQL on the connected database. Important: execute each SQL command separately (do not group multiple commands in a single query).",
    inputSchema: executeSqlSchema,
    defaultConsent: "ask",
    modifiesState: true,
    isEnabled: (ctx) =>
      !!ctx.supabaseProjectId ||
      (!!ctx.neonProjectId && !!ctx.neonActiveBranchId),

    getConsentPreview: (args) => args.query,

    getConsentMetadata: (args) => ({
      sqlMutatesSchema: doesSqlMutateSchema(args.query),
      sqlDeletesData: doesSqlDeleteData(args.query),
    }),

    shouldTrackMutation: (args) => doesSqlLikelyMutateState(args.query),

    buildXml: (args, isComplete) => {
      if (args.query == undefined) return undefined;

      let xml = `<dyad-execute-sql description="${escapeXmlAttr(args.description ?? "")}">\n${escapeXmlContent(args.query)}`;
      if (isComplete) {
        xml += "\n</dyad-execute-sql>";
      }
      return xml;
    },

    execute: async (args, ctx: AgentContext) => {
      if (ctx.neonProjectId && ctx.neonActiveBranchId) {
        const sqlResult = await executeNeonSql({
          projectId: ctx.neonProjectId,
          branchId: ctx.neonActiveBranchId,
          query: args.query,
        });
        return `Successfully executed SQL query.\n\nSQL result:\n${sqlResult}`;
      }

      if (ctx.neonProjectId && !ctx.neonActiveBranchId) {
        throw new DyadError(
          "Neon active branch not configured. Please select a branch in the Neon integration settings.",
          DyadErrorKind.Precondition,
        );
      }

      if (ctx.supabaseProjectId) {
        const sqlResult = await executeSupabaseSql({
          supabaseProjectId: ctx.supabaseProjectId,
          query: args.query,
          organizationSlug: ctx.supabaseOrganizationSlug ?? null,
        });

        const settings = readSettings();
        if (
          settings.enableSupabaseWriteSqlMigration &&
          doesSqlMutateSchema(args.query)
        ) {
          try {
            await writeMigrationFile(ctx.appPath, args.query, args.description);
          } catch (error) {
            return `SQL executed, but failed to write migration file: ${error}\n\nSQL result:\n${sqlResult}`;
          }
        }

        return `Successfully executed SQL query.\n\nSQL result:\n${sqlResult}`;
      }

      throw new DyadError(
        "No database is connected to this app",
        DyadErrorKind.Precondition,
      );
    },
  };
