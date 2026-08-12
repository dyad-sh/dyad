import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import log from "electron-log";

import { db } from "../../db";
import {
  dataSourceColumns,
  dataSourceRelationships,
  dataSourceTables,
  dataSources,
} from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { dataSourceContracts, type DataSourceDto } from "../types/data_source";
import {
  decryptCredential,
  describeTableSemantically,
  discoverSchema,
  encryptCredential,
  testConnection,
} from "../utils/data_sources/supabase_provider";
import {
  d1CatalogueToParsedSchema,
  discoverD1Schema,
  testD1Connection,
} from "../utils/data_sources/cloudflare_d1_provider";
import {
  generateKeyId,
  type ParsedSchema,
} from "@/lib/data_sources/postgrest_schema";
import { sanitiseDatabaseError } from "@/lib/data_sources/read_only";

/**
 * Data source IPC.
 *
 * The only place a stored credential is decrypted, and it never leaves: every
 * path out of this file goes through `toDto`, which has no field capable of
 * carrying one.
 */

const logger = log.scope("data_source_handlers");

type DataSourceRow = typeof dataSources.$inferSelect;

const asEpoch = (value: Date | null | undefined): number | null =>
  value ? value.getTime() : null;

/**
 * Row to renderer-safe DTO.
 *
 * Secrets become booleans here and nowhere else, so there is exactly one line
 * to audit rather than one per handler.
 */
async function toDto(row: DataSourceRow): Promise<DataSourceDto> {
  const [tables, relationships] = await Promise.all([
    db
      .select({ id: dataSourceTables.id })
      .from(dataSourceTables)
      .where(eq(dataSourceTables.dataSourceId, row.id)),
    db
      .select({ id: dataSourceRelationships.id })
      .from(dataSourceRelationships)
      .where(eq(dataSourceRelationships.dataSourceId, row.id)),
  ]);

  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    description: row.description,
    projectUrl: row.projectUrl,
    environment: row.environment as DataSourceDto["environment"],
    credentialType: row.credentialType as DataSourceDto["credentialType"],
    accessMode: "read_only",
    enabled: row.enabled,
    status: row.status as DataSourceDto["status"],
    statusMessage: row.statusMessage,
    keyId: row.keyId,
    hasCredential: Boolean(row.encryptedCredential),
    tableCount: tables.length,
    relationshipCount: relationships.length,
    lastConnectedAt: asEpoch(row.lastConnectedAt),
    lastSchemaSyncAt: asEpoch(row.lastSchemaSyncAt),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function requireRow(id: string): Promise<DataSourceRow> {
  const [row] = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.id, id))
    .limit(1);
  if (!row) {
    throw new DyadError(
      "That data source no longer exists.",
      DyadErrorKind.NotFound,
    );
  }
  return row;
}

/**
 * Applies the three-state secret convention.
 *
 * undefined leaves the stored value alone, "" clears it, anything else
 * replaces it. Without this, editing a name would silently wipe a credential.
 */
function nextSecret(incoming: string | undefined): string | null | undefined {
  if (incoming === undefined) return undefined;
  const trimmed = incoming.trim();
  if (!trimmed) return null;
  return encryptCredential(trimmed);
}

/** Replaces the cached catalogue for a source with freshly discovered rows. */
async function persistCatalogue(
  dataSourceId: string,
  catalogue: ParsedSchema,
): Promise<{ tables: number; columns: number; relationships: number }> {
  // Replace wholesale rather than diffing: a table the key can no longer read
  // must disappear, and a stale row the agent still trusts is worse than a
  // slower sync.
  await db
    .delete(dataSourceTables)
    .where(eq(dataSourceTables.dataSourceId, dataSourceId));
  await db
    .delete(dataSourceRelationships)
    .where(eq(dataSourceRelationships.dataSourceId, dataSourceId));

  let columnCount = 0;

  for (const table of catalogue.tables) {
    const tableId = randomUUID();

    await db.insert(dataSourceTables).values({
      id: tableId,
      dataSourceId,
      schemaName: table.schemaName,
      tableName: table.tableName,
      tableType: table.tableType,
      description: table.description,
      semanticDescription: describeTableSemantically(
        table,
        catalogue.relationships,
      ),
      // PostgREST does not report row counts, and guessing one would be
      // inventing information the agent would then quote back.
      estimatedRows: null,
      syncedAt: new Date(),
    });

    for (const column of table.columns) {
      await db.insert(dataSourceColumns).values({
        id: randomUUID(),
        tableId,
        columnName: column.columnName,
        dataType: column.dataType,
        nullable: column.nullable,
        defaultValue: column.defaultValue,
        primaryKey: column.primaryKey,
        isUnique: column.isUnique,
        description: column.description,
        semanticDescription: "",
        jsonKeys: "[]",
      });
      columnCount += 1;
    }
  }

  for (const link of catalogue.relationships) {
    await db.insert(dataSourceRelationships).values({
      id: randomUUID(),
      dataSourceId,
      sourceSchema: "public",
      sourceTable: link.sourceTable,
      sourceColumn: link.sourceColumn,
      targetSchema: "public",
      targetTable: link.targetTable,
      targetColumn: link.targetColumn,
      relationshipType: "foreign_key",
      constraintName: "",
    });
  }

  return {
    tables: catalogue.tables.length,
    columns: columnCount,
    relationships: catalogue.relationships.length,
  };
}

export function registerDataSourceHandlers() {
  createTypedHandler(dataSourceContracts.list, async () => {
    const rows = await db.select().from(dataSources);
    return Promise.all(rows.map(toDto));
  });

  createTypedHandler(dataSourceContracts.get, async (_, { id }) => {
    const [row] = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1);
    return row ? toDto(row) : null;
  });

  createTypedHandler(dataSourceContracts.create, async (_, input) => {
    const id = randomUUID();
    const now = new Date();

    await db.insert(dataSources).values({
      id,
      provider: input.provider,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      projectUrl: input.projectUrl.trim(),
      environment: input.environment,
      credentialType: input.credentialType,
      keyId: generateKeyId(),
      encryptedCredential: input.connectionKey?.trim()
        ? encryptCredential(input.connectionKey.trim())
        : null,
      accessMode: "read_only",
      enabled: true,
      status: "unknown",
      statusMessage: "",
      createdAt: now,
      updatedAt: now,
    });

    return toDto(await requireRow(id));
  });

  createTypedHandler(dataSourceContracts.update, async (_, input) => {
    const existing = await requireRow(input.id);

    const credential = nextSecret(input.connectionKey);

    await db
      .update(dataSources)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() }
          : {}),
        ...(input.projectUrl !== undefined
          ? { projectUrl: input.projectUrl.trim() }
          : {}),
        ...(input.environment !== undefined
          ? { environment: input.environment }
          : {}),
        ...(input.credentialType !== undefined
          ? { credentialType: input.credentialType }
          : {}),
        ...(input.enabled !== undefined
          ? {
              enabled: input.enabled,
              status: input.enabled ? existing.status : "disabled",
            }
          : {}),
        ...(credential !== undefined
          ? { encryptedCredential: credential }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, input.id));

    return toDto(await requireRow(input.id));
  });

  createTypedHandler(dataSourceContracts.test, async (_, input) => {
    // Two callers: an unsaved form, which supplies its own values, and a saved
    // source, which supplies an id and nothing else.
    let projectUrl = input.projectUrl?.trim() ?? "";
    let key = input.connectionKey?.trim() || null;

    if (input.id) {
      const row = await requireRow(input.id);
      projectUrl = projectUrl || row.projectUrl;
      // A blank field on an edit form means "keep what is stored", so fall
      // back to the saved key rather than testing without one.
      key = key ?? decryptCredential(row.encryptedCredential);
    }

    const provider = input.id
      ? (await requireRow(input.id)).provider
      : "supabase";

    const health =
      provider === "cloudflare-d1"
        ? await testD1Connection({ endpoint: projectUrl, token: key })
        : await testConnection({ projectUrl, key });

    if (input.id) {
      // Status is derived, never chosen: the test decides it.
      await db
        .update(dataSources)
        .set({
          status: health.status,
          statusMessage: health.ok
            ? ""
            : (health.checks.find((check) => !check.ok)?.detail ?? ""),
          ...(health.ok ? { lastConnectedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dataSources.id, input.id));
    }

    return health;
  });

  createTypedHandler(dataSourceContracts.syncSchema, async (_, { id }) => {
    const row = await requireRow(id);
    const key = decryptCredential(row.encryptedCredential);

    if (!key) {
      throw new DyadError(
        "Add a connection key before syncing the schema.",
        DyadErrorKind.Precondition,
      );
    }

    await db
      .update(dataSources)
      .set({ status: "syncing", statusMessage: "", updatedAt: new Date() })
      .where(eq(dataSources.id, id));

    try {
      // Both providers answer with the same catalogue shape, so everything
      // downstream — persistence, the agent's schema search — is unchanged.
      const catalogue =
        row.provider === "cloudflare-d1"
          ? d1CatalogueToParsedSchema(
              await discoverD1Schema({ endpoint: row.projectUrl, token: key }),
            )
          : await discoverSchema({ projectUrl: row.projectUrl, key });
      const counts = await persistCatalogue(id, catalogue);

      await db
        .update(dataSources)
        .set({
          status: "connected",
          statusMessage: "",
          lastConnectedAt: new Date(),
          lastSchemaSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dataSources.id, id));

      logger.log(
        `Discovered ${counts.tables} tables and ${counts.relationships} relationships`,
      );
      return { dataSource: await toDto(await requireRow(id)), ...counts };
    } catch (error) {
      // Sanitised before it is stored, so the status message on a card can
      // never carry a password.
      const message = sanitiseDatabaseError(error);
      await db
        .update(dataSources)
        .set({
          status: "connection_error",
          statusMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(dataSources.id, id));
      throw new DyadError(message, DyadErrorKind.Unknown);
    }
  });

  createTypedHandler(dataSourceContracts.catalogue, async (_, { id }) => {
    const tables = await db
      .select()
      .from(dataSourceTables)
      .where(eq(dataSourceTables.dataSourceId, id));

    const relationships = await db
      .select()
      .from(dataSourceRelationships)
      .where(eq(dataSourceRelationships.dataSourceId, id));

    const withColumns = await Promise.all(
      tables.map(async (table) => {
        const columns = await db
          .select()
          .from(dataSourceColumns)
          .where(eq(dataSourceColumns.tableId, table.id));
        return {
          id: table.id,
          schemaName: table.schemaName,
          tableName: table.tableName,
          tableType: table.tableType,
          description: table.description,
          semanticDescription: table.semanticDescription,
          estimatedRows: table.estimatedRows,
          columns: columns.map((column) => ({
            columnName: column.columnName,
            dataType: column.dataType,
            nullable: column.nullable,
            primaryKey: column.primaryKey,
            isUnique: column.isUnique,
            description: column.description,
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
  });

  createTypedHandler(dataSourceContracts.delete, async (_, { id }) => {
    // The cached catalogue and the encrypted credential go with it. Nothing is
    // touched in the remote database: deleting a connection is our business,
    // not theirs.
    await db.delete(dataSources).where(eq(dataSources.id, id));
    return { deleted: true };
  });
}
