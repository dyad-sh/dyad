import { z } from "zod";
import type { ToolSet } from "ai";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../../db";
import {
  dataSourceColumns,
  dataSourceRelationships,
  dataSourceTables,
  dataSources,
} from "../../../db/schema";
import {
  validateQueryPlan,
  type QueryPlan,
  type SchemaCatalogue,
} from "@/lib/data_sources/query_plan";
import { wrapUntrustedRows } from "@/lib/data_sources/postgrest_query";
import { buildResultTable } from "@/lib/data_sources/result_table";
import type { ChatAgentToolResult } from "@/components/chat-agent/types";
import { decryptCredential, executePlan } from "./supabase_provider";

/**
 * The agent's view of connected databases.
 *
 * Three rules shape all of it.
 *
 * The model never sees a credential. It passes an opaque data source id, and
 * this file is the only thing that can turn one into a request.
 *
 * The model never writes SQL. It emits a structured plan, which is validated
 * against the schema we discovered before anything is sent anywhere.
 *
 * The model may only reach sources the user selected for this conversation.
 * An id it invents, or one belonging to a source the user did not tick, is
 * refused here rather than trusted because it arrived in a tool call.
 */

/** Rows the agent is allowed to receive in one go. */
const MAX_ROWS = 100;

type ToolResult = string;

async function loadCatalogue(dataSourceId: string): Promise<SchemaCatalogue> {
  const tables = await db
    .select()
    .from(dataSourceTables)
    .where(eq(dataSourceTables.dataSourceId, dataSourceId));

  const relationships = await db
    .select()
    .from(dataSourceRelationships)
    .where(eq(dataSourceRelationships.dataSourceId, dataSourceId));

  const withColumns = await Promise.all(
    tables.map(async (table) => {
      const columns = await db
        .select()
        .from(dataSourceColumns)
        .where(eq(dataSourceColumns.tableId, table.id));
      return {
        schemaName: table.schemaName,
        tableName: table.tableName,
        columns: columns.map((column) => ({
          columnName: column.columnName,
          dataType: column.dataType,
        })),
      };
    }),
  );

  return {
    tables: withColumns,
    relationships: relationships.map((link) => ({
      sourceSchema: link.sourceSchema,
      sourceTable: link.sourceTable,
      sourceColumn: link.sourceColumn,
      targetSchema: link.targetSchema,
      targetTable: link.targetTable,
      targetColumn: link.targetColumn,
    })),
  };
}

/**
 * Resolves an id the model supplied, or refuses it.
 *
 * The allow-list is the ids the user ticked in the composer. Checking here
 * rather than trusting the argument is the difference between a tool the model
 * can use and a tool the model can point anywhere.
 */
async function requireSelectedSource(
  dataSourceId: string,
  allowedIds: string[],
) {
  if (!allowedIds.includes(dataSourceId)) {
    throw new Error(
      "That data source is not selected for this conversation. Ask the user to select it in the composer.",
    );
  }
  const [row] = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.id, dataSourceId))
    .limit(1);

  if (!row) throw new Error("That data source no longer exists.");
  if (!row.enabled) throw new Error(`"${row.name}" is currently disabled.`);
  return row;
}

/**
 * Builds the data-source tools for a conversation.
 *
 * `selectedIds` comes from what the user ticked, never from the model.
 */
export type DataSourceToolResultCallback = (
  result: ChatAgentToolResult,
) => void;

export function buildDataSourceToolSet(
  selectedIds: string[],
  onToolResult?: DataSourceToolResultCallback,
): ToolSet {
  if (selectedIds.length === 0) return {};

  const tools: ToolSet = {};

  tools.list_data_sources = {
    description:
      "List the databases the user has selected for this conversation, with how many tables each one exposes. Call this first when a question might need real data.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const rows = await db
        .select()
        .from(dataSources)
        .where(inArray(dataSources.id, selectedIds));

      if (rows.length === 0) {
        return "No data sources are selected for this conversation.";
      }

      const described = await Promise.all(
        rows.map(async (row) => {
          const tables = await db
            .select({ id: dataSourceTables.id })
            .from(dataSourceTables)
            .where(eq(dataSourceTables.dataSourceId, row.id));
          return `- id: ${row.id}\n  name: ${row.name}\n  provider: ${row.provider}\n  environment: ${row.environment}\n  status: ${row.status}\n  readable tables: ${tables.length}`;
        }),
      );
      return `Selected data sources:\n${described.join("\n")}`;
    },
  };

  tools.search_schema = {
    description:
      "Search a data source's discovered schema for tables and columns matching a term. Use this to find where information lives before querying. Prefer this over guessing table names.",
    inputSchema: z.object({
      data_source_id: z.string(),
      query: z
        .string()
        .min(1)
        .describe("Words to look for in table or column names"),
    }),
    execute: async ({
      data_source_id,
      query,
    }: {
      data_source_id: string;
      query: string;
    }): Promise<ToolResult> => {
      await requireSelectedSource(data_source_id, selectedIds);

      const tables = await db
        .select()
        .from(dataSourceTables)
        .where(eq(dataSourceTables.dataSourceId, data_source_id));

      const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 1);

      const scored = await Promise.all(
        tables.map(async (table) => {
          const columns = await db
            .select()
            .from(dataSourceColumns)
            .where(eq(dataSourceColumns.tableId, table.id));

          const haystack = [
            table.tableName,
            table.description,
            table.semanticDescription,
            ...columns.map((column) => column.columnName),
          ]
            .join(" ")
            .toLowerCase();

          const score = terms.filter((term) => haystack.includes(term)).length;
          return { table, columns, score };
        }),
      );

      // Everything when nothing matches, because an unfamiliar schema is
      // exactly when the agent most needs to see what is there.
      const hits = scored.filter((entry) => entry.score > 0);
      const chosen = (hits.length > 0 ? hits : scored)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

      if (chosen.length === 0) {
        return "This data source has no discovered tables. Ask the user to sync its schema in Data Sources.";
      }

      return chosen
        .map((entry) => {
          const columns = entry.columns
            .map(
              (column) =>
                `${column.columnName} (${column.dataType}${column.primaryKey ? ", primary key" : ""})`,
            )
            .join(", ");
          // The database's own comment and our inference are labelled
          // separately, so the agent can tell an assertion from a guess.
          const comment = entry.table.description
            ? `\n  comment: ${entry.table.description}`
            : entry.table.semanticDescription
              ? `\n  inferred: ${entry.table.semanticDescription}`
              : "";
          return `- ${entry.table.tableName} (${entry.table.tableType})${comment}\n  columns: ${columns}`;
        })
        .join("\n");
    },
  };

  tools.get_relationships = {
    description:
      "List the foreign-key relationships in a data source. Use this to work out how to connect records across tables before building a query with a join.",
    inputSchema: z.object({ data_source_id: z.string() }),
    execute: async ({
      data_source_id,
    }: {
      data_source_id: string;
    }): Promise<ToolResult> => {
      await requireSelectedSource(data_source_id, selectedIds);
      const links = await db
        .select()
        .from(dataSourceRelationships)
        .where(eq(dataSourceRelationships.dataSourceId, data_source_id));

      if (links.length === 0) {
        return "No foreign-key relationships were discovered for this data source.";
      }
      return links
        .map(
          (link) =>
            `${link.sourceTable}.${link.sourceColumn} -> ${link.targetTable}.${link.targetColumn}`,
        )
        .join("\n");
    },
  };

  tools.query_data_source = {
    description: [
      "Run a read-only query against a selected data source and return real rows.",
      "Provide a structured plan, not SQL. Columns and tables must exist in the discovered schema; call search_schema first if unsure.",
      "Joins are only permitted along discovered foreign keys.",
      "Never invent values: if the result is empty, say so.",
    ].join(" "),
    inputSchema: z.object({
      data_source_id: z.string(),
      table: z.string(),
      select: z.array(z.string()).optional(),
      filters: z
        .array(
          z.object({
            column: z.string(),
            operator: z.enum([
              "=",
              "!=",
              ">",
              ">=",
              "<",
              "<=",
              "like",
              "ilike",
              "in",
              "is_null",
              "is_not_null",
            ]),
            value: z.unknown().optional(),
          }),
        )
        .optional(),
      joins: z
        .array(
          z.object({
            table: z.string(),
            type: z.enum(["inner", "left"]).default("left"),
            on: z.object({ left: z.string(), right: z.string() }),
          }),
        )
        .optional(),
      order_by: z
        .object({
          column: z.string(),
          direction: z.enum(["asc", "desc"]).default("desc"),
        })
        .optional(),
      limit: z.number().int().min(1).max(MAX_ROWS).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const dataSourceId = String(input.data_source_id);
      const row = await requireSelectedSource(dataSourceId, selectedIds);

      const plan: QueryPlan = {
        table: String(input.table),
        select: input.select as string[] | undefined,
        filters: input.filters as QueryPlan["filters"],
        joins: input.joins as QueryPlan["joins"],
        orderBy: input.order_by as QueryPlan["orderBy"],
        limit: (input.limit as number | undefined) ?? MAX_ROWS,
        offset: input.offset as number | undefined,
      };

      const catalogue = await loadCatalogue(dataSourceId);
      if (catalogue.tables.length === 0) {
        return "This data source has no discovered schema yet. Ask the user to sync it in Data Sources.";
      }

      const validation = validateQueryPlan(plan, catalogue);
      if (!validation.ok) {
        // Returned rather than thrown so the model can correct the plan and
        // try again, which is the whole reason every error is reported.
        return [
          "That query plan was rejected:",
          ...validation.errors.map((error) => `- ${error.message}`),
          "Use search_schema to check the available tables and columns.",
        ].join("\n");
      }

      const key = decryptCredential(row.encryptedCredential);
      if (!key) {
        return `"${row.name}" has no usable connection key. Ask the user to re-enter it in Data Sources.`;
      }

      const outcome = await executePlan({
        projectUrl: row.projectUrl,
        key,
        plan: validation.plan,
      });

      // The rows go to the renderer as data so it can lay out a real table.
      // The model still receives them as text, because it has to reason about
      // the values; what it no longer has to do is retell them for display.
      const table = buildResultTable(outcome.rows);
      onToolResult?.({
        serverName: row.name,
        toolName: "query_data_source",
        status: "completed",
        result: `${outcome.rows.length} rows from ${validation.plan.table}`,
        presentation: {
          kind: "database-result",
          sourceName: row.name,
          table: validation.plan.table,
          columns: table.columns,
          rows: table.rows,
          totalRows: outcome.totalRows,
          executionMs: outcome.executionMs,
          truncatedColumns: table.truncatedColumns,
        },
      });

      if (outcome.rows.length === 0) {
        return `No rows in "${row.name}" matched that query. Say so plainly rather than estimating an answer.`;
      }

      return wrapUntrustedRows({
        sourceName: row.name,
        table: validation.plan.table,
        rows: outcome.rows,
        totalRows: outcome.totalRows,
      });
    },
  };

  return tools;
}
