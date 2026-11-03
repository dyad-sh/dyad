import { neon, Pool } from "@neondatabase/serverless";
import fs from "node:fs/promises";
import path from "node:path";

import log from "electron-log";
import { IS_TEST_BUILD } from "./test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("neon_branch_data");

// Neon Auth service metadata. A provisioned branch creates its own copies, and
// overwriting them with another branch's rows breaks every auth request.
const NEON_AUTH_SERVICE_TABLES = new Set(["project_config", "jwks"]);
const COPY_BATCH_SIZE = 500;

/** The copied rows did not match the source; the copy was rolled back. */
export class CopyVerificationError extends DyadError {
  constructor(message: string) {
    super(message, DyadErrorKind.Internal);
  }
}

export interface ForeignKeyDefinition {
  schema: string;
  table: string;
  name: string;
  definition: string;
}

interface Queryable {
  query(text: string, params?: unknown[]): Promise<Record<string, any>[]>;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function qualifiedName(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function httpQueryable(connectionUri: string): Queryable {
  const sql = neon(connectionUri);
  return { query: (text, params = []) => sql.query(text, params) };
}

const USER_SCHEMA_FILTER = `n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\\_temp%'
  and n.nspname not like 'pg\\_toast\\_temp%'`;

async function listForeignKeysWith(
  db: Queryable,
): Promise<ForeignKeyDefinition[]> {
  const rows = await db.query(`
    select n.nspname as schema, c.relname as "table", con.conname as name,
      pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f' and ${USER_SCHEMA_FILTER}
      -- Partitions inherit their parent's foreign keys; those go with it.
      and con.conparentid = 0
    order by 1, 2, 3`);
  return rows as ForeignKeyDefinition[];
}

/** Lists every foreign key outside the Postgres system schemas. */
export async function listForeignKeys(
  connectionUri: string,
): Promise<ForeignKeyDefinition[]> {
  return listForeignKeysWith(httpQueryable(connectionUri));
}

/**
 * Prepares a schema-only branch for Neon Auth provisioning.
 *
 * Schema-only branches copy the parent's `neon_auth` schema and role but not
 * Neon Auth's provisioning or any role memberships. Verified against the live
 * Neon API (dyad-sh/dyad#4943), provisioning then fails until:
 * - the copied `neon_auth` schema is gone (409 "schema already exists"),
 * - the copied `neon_auth` role is gone (412 "must be able to SET ROLE"), and
 * - `neon_service` can create in the database, which it otherwise gets
 *   through `neon_superuser` (412 "permission denied for database").
 *
 * Dropping the schema cascades to foreign keys that reference it; callers that
 * copy data restore those from a list captured beforehand.
 */
export async function prepareSchemaOnlyBranchForNeonAuth(
  connectionUri: string,
): Promise<void> {
  // Test builds use a fake Neon client whose connection strings go nowhere.
  if (IS_TEST_BUILD) return;
  const db = httpQueryable(connectionUri);
  await db.query("drop schema if exists neon_auth cascade");
  await db.query(`
    do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'neon_auth') then
        execute 'drop role neon_auth';
      end if;
      if exists (select 1 from pg_roles where rolname = 'neon_service') then
        execute format('grant create on database %I to neon_service', current_database());
      end if;
    end $$`);
}

interface CopyTable {
  schema: string;
  name: string;
}

async function listCopyTables(db: Queryable): Promise<CopyTable[]> {
  // Tables that hold rows, partitions included: a partitioned parent holds
  // none, and paging through it by ctid would skip rows, because ctids repeat
  // across partitions. Extension-owned tables belong to the extension on each
  // branch.
  const rows = await db.query(`
    select n.nspname as schema, c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and ${USER_SCHEMA_FILTER}
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
    order by 1, 2`);
  return (rows as CopyTable[]).filter(
    (t) => !(t.schema === "neon_auth" && NEON_AUTH_SERVICE_TABLES.has(t.name)),
  );
}

async function listInsertableColumns(
  db: Queryable,
  table: CopyTable,
): Promise<{ name: string; identityAlways: boolean }[]> {
  const rows = await db.query(
    `select a.attname as name, a.attidentity = 'a' as "identityAlways"
     from pg_attribute a
     where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = ''
     order by a.attnum`,
    [qualifiedName(table.schema, table.name)],
  );
  return rows as { name: string; identityAlways: boolean }[];
}

/**
 * What a migration's copy would lose, as user-facing descriptions; empty when
 * it is safe. When Neon Auth is re-provisioned, views and policies that depend
 * on its tables would be dropped with the copied `neon_auth` schema (only
 * foreign keys are carried over). Large objects live in system catalogs that
 * a schema-only branch starts without.
 */
export async function findMigrationBlockers(
  connectionUri: string,
  { neonAuth }: { neonAuth: boolean },
): Promise<string[]> {
  if (IS_TEST_BUILD) return [];
  const db = httpQueryable(connectionUri);
  const blockers: string[] = [];
  if (neonAuth) {
    const dependents = await db.query(`
      with auth_tables as (
        select c.oid from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'neon_auth'
      )
      select format('the %s %I.%I',
          case c.relkind when 'm' then 'materialized view' else 'view' end,
          n.nspname, c.relname) as object
      from pg_depend d
      join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
      join pg_class c on c.oid = r.ev_class
      join pg_namespace n on n.oid = c.relnamespace
      where d.refclassid = 'pg_class'::regclass
        and d.refobjid in (select oid from auth_tables)
        and n.nspname <> 'neon_auth'
      union
      select format('the policy %I on %I.%I', p.polname, n.nspname, c.relname)
      from pg_depend d
      join pg_policy p on d.classid = 'pg_policy'::regclass and p.oid = d.objid
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where d.refclassid = 'pg_class'::regclass
        and d.refobjid in (select oid from auth_tables)
        and n.nspname <> 'neon_auth'
      order by 1`);
    blockers.push(
      ...dependents.map((d) => `${d.object} (it uses Neon Auth's tables)`),
    );
  }
  const [{ count }] = await db.query(
    "select count(*)::int as count from pg_largeobject_metadata",
  );
  if (count > 0) {
    blockers.push(`${count} large object${count === 1 ? "" : "s"}`);
  }
  return blockers;
}

async function poolQueryable(connectionUri: string) {
  const pool = new Pool({ connectionString: connectionUri });
  const client = await pool.connect();
  const db: Queryable = {
    query: async (text, params) => (await client.query(text, params)).rows,
  };
  return {
    db,
    close: async () => {
      client.release();
      await pool.end();
    },
  };
}

const ENABLE_TRIGGER: Record<string, string> = {
  O: "enable trigger",
  D: "disable trigger",
  R: "enable replica trigger",
  A: "enable always trigger",
};

export interface CopyBranchDataResult {
  tables: number;
  rows: number;
}

/**
 * Copies every user table's rows from `sourceUri` into the matching tables of
 * `targetUri`, which must already have the same schema (a schema-only branch).
 *
 * The source is read in one repeatable-read snapshot and the target written in
 * one transaction: if anything fails, the target is left as it was. Both go
 * over WebSockets, which have no response size limit for wide rows. The app
 * role cannot set `session_replication_role`, so foreign keys are dropped for
 * the copy and re-added afterwards (re-adding validates them), and user
 * triggers are disabled per table, then put back in their original state.
 *
 * `extraForeignKeys` are constraints captured from the target before
 * `prepareSchemaOnlyBranchForNeonAuth` dropped them along with the copied
 * `neon_auth` schema; they are restored once the data is in place.
 */
export async function copyBranchData({
  sourceUri,
  targetUri,
  extraForeignKeys = [],
}: {
  sourceUri: string;
  targetUri: string;
  extraForeignKeys?: ForeignKeyDefinition[];
}): Promise<CopyBranchDataResult> {
  const sourceConnection = await poolQueryable(sourceUri);
  const targetConnection = await poolQueryable(targetUri);
  const source = sourceConnection.db;
  const target = targetConnection.db;
  let copiedRows = 0;
  let copiedTables = 0;
  const copiedTableNames: string[] = [];
  try {
    await source.query("begin isolation level repeatable read read only");
    await target.query("begin");
    const sourceTables = await listCopyTables(source);

    const targetTables = new Set(
      (await listCopyTables(target)).map((t) => `${t.schema}.${t.name}`),
    );
    const currentForeignKeys = await listForeignKeysWith(target);
    // Every key dropped below is re-added, including those on partitioned
    // parents, which hold no rows and so are not in `targetTables`. The extra
    // keys come back only where their table still exists; neon_auth's own
    // keys belong to Neon Auth's fresh provisioning.
    const foreignKeysToRestore = new Map<string, ForeignKeyDefinition>();
    for (const fk of currentForeignKeys) {
      foreignKeysToRestore.set(`${fk.schema}.${fk.table}.${fk.name}`, fk);
    }
    for (const fk of extraForeignKeys) {
      const key = `${fk.schema}.${fk.table}.${fk.name}`;
      if (fk.schema === "neon_auth" || foreignKeysToRestore.has(key)) continue;
      const [{ exists }] = await target.query(
        "select to_regclass($1) is not null as exists",
        [qualifiedName(fk.schema, fk.table)],
      );
      if (exists) foreignKeysToRestore.set(key, fk);
    }
    for (const fk of currentForeignKeys) {
      await target.query(
        `alter table ${qualifiedName(fk.schema, fk.table)} drop constraint ${quoteIdentifier(fk.name)}`,
      );
    }

    for (const table of sourceTables) {
      if (!targetTables.has(`${table.schema}.${table.name}`)) {
        logger.warn(
          `Skipping ${table.schema}.${table.name}: missing on the target branch`,
        );
        continue;
      }
      const tableName = qualifiedName(table.schema, table.name);
      const targetColumns = new Map(
        (await listInsertableColumns(target, table)).map((c) => [c.name, c]),
      );
      const columns = (await listInsertableColumns(source, table)).filter((c) =>
        targetColumns.has(c.name),
      );
      if (columns.length === 0) continue;
      const columnList = columns.map((c) => quoteIdentifier(c.name)).join(", ");
      const overriding = columns.some(
        (c) => targetColumns.get(c.name)?.identityAlways,
      )
        ? "overriding system value"
        : "";

      const triggers = (await target.query(
        `select tgname as name, tgenabled as state from pg_trigger
         where tgrelid = $1::regclass and not tgisinternal`,
        [tableName],
      )) as { name: string; state: string }[];
      await target.query(`alter table ${tableName} disable trigger user`);
      await target.query(`delete from only ${tableName}`);
      copiedTableNames.push(tableName);
      // Keyset pagination on ctid, stable within the source snapshot.
      let lastCtid = "(0,0)";
      for (;;) {
        const [{ rows, last }] = await source.query(
          `select coalesce(json_agg(to_json(x)), '[]'::json) as rows,
             max(x_ctid)::text as last
           from (
             select ${columnList}, ctid as x_ctid from only ${tableName}
             where ctid > $1::tid order by ctid limit ${COPY_BATCH_SIZE}
           ) x`,
          [lastCtid],
        );
        const batch = (rows as Record<string, unknown>[]).map(
          ({ x_ctid: _ctid, ...row }) => row,
        );
        if (batch.length === 0) break;
        await target.query(
          `insert into ${tableName} (${columnList}) ${overriding}
           select ${columnList} from json_populate_recordset(null::${tableName}, $1::json)`,
          [JSON.stringify(batch)],
        );
        copiedRows += batch.length;
        lastCtid = last;
        if (batch.length < COPY_BATCH_SIZE) break;
      }
      for (const trigger of triggers) {
        await target.query(
          `alter table ${tableName} ${ENABLE_TRIGGER[trigger.state] ?? "enable trigger"} ${quoteIdentifier(trigger.name)}`,
        );
      }
      copiedTables += 1;
    }

    const sequences = await source.query(`
      select schemaname as schema, sequencename as name
      from pg_sequences
      where schemaname not in ('pg_catalog', 'information_schema')`);
    for (const seq of sequences) {
      const sequenceName = qualifiedName(seq.schema, seq.name);
      const exists = await target.query(
        "select to_regclass($1) is not null as exists",
        [sequenceName],
      );
      if (!exists[0]?.exists) continue;
      const [state] = await source.query(
        `select last_value::text as "lastValue", is_called as "isCalled" from ${sequenceName}`,
      );
      await target.query("select setval($1::regclass, $2::bigint, $3)", [
        sequenceName,
        state.lastValue,
        state.isCalled,
      ]);
    }

    for (const fk of foreignKeysToRestore.values()) {
      await target.query(
        `alter table ${qualifiedName(fk.schema, fk.table)} add constraint ${quoteIdentifier(fk.name)} ${fk.definition}`,
      );
    }

    // The old branch is deleted after this, so check that every table came
    // over whole before committing.
    for (const table of copiedTableNames) {
      const count = async (db: Queryable) =>
        Number(
          (await db.query(`select count(*)::text as n from only ${table}`))[0]
            .n,
        );
      const [expected, actual] = [await count(source), await count(target)];
      if (expected !== actual) {
        throw new CopyVerificationError(
          `Copying ${table} produced ${actual} rows instead of ${expected}; nothing was changed.`,
        );
      }
    }

    await target.query("commit");
  } catch (error) {
    await target.query("rollback").catch(() => {});
    throw error;
  } finally {
    await source.query("rollback").catch(() => {});
    await sourceConnection.close();
    await targetConnection.close();
  }

  return { tables: copiedTables, rows: copiedRows };
}

/** A dollar-quote tag that does not occur in `text`. */
function dollarQuoteTag(text: string): string {
  let tag = "$dyad$";
  for (let i = 0; text.includes(tag); i++) tag = `$dyad${i}$`;
  return tag;
}

/**
 * Writes every user table's rows from `sourceUri` to `filePath` as a plain
 * SQL script, read in one snapshot. Running the script (in the Neon SQL
 * editor, or with psql) against a database with the same schema, such as the
 * new development branch, replaces those tables' rows with the saved ones.
 *
 * It holds the app's data, Neon Auth users included, so the file and its
 * directory are readable by the owner only. A partial file is removed.
 */
export async function exportBranchDataAsSql({
  sourceUri,
  filePath,
  title,
}: {
  sourceUri: string;
  filePath: string;
  /** First line of the file's header comment. */
  title: string;
}): Promise<CopyBranchDataResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const file = await fs.open(filePath, "wx", 0o600);
  const sourceConnection = await poolQueryable(sourceUri);
  const source = sourceConnection.db;
  const write = (text: string) => file.write(`${text}\n`);
  let rowCount = 0;
  let tableCount = 0;
  try {
    await source.query("begin isolation level repeatable read read only");
    await write(
      [
        `-- ${title.replace(/\n/g, " ")}`,
        `-- Saved ${new Date().toISOString()}. Data only, not the schema; includes Neon Auth users.`,
        "-- To restore, run this whole file against a database with the same schema",
        "-- (e.g. in the Neon SQL editor or with psql). It replaces the rows of every",
        "-- table below.",
        "begin;",
      ].join("\n"),
    );
    const foreignKeys = await listForeignKeysWith(source);
    for (const fk of foreignKeys) {
      await write(
        `alter table ${qualifiedName(fk.schema, fk.table)} drop constraint if exists ${quoteIdentifier(fk.name)};`,
      );
    }
    for (const table of await listCopyTables(source)) {
      const tableName = qualifiedName(table.schema, table.name);
      const columns = await listInsertableColumns(source, table);
      if (columns.length === 0) continue;
      const columnList = columns.map((c) => quoteIdentifier(c.name)).join(", ");
      const overriding = columns.some((c) => c.identityAlways)
        ? "overriding system value "
        : "";
      const triggers = (await source.query(
        `select tgname as name, tgenabled as state from pg_trigger
         where tgrelid = $1::regclass and not tgisinternal`,
        [tableName],
      )) as { name: string; state: string }[];
      await write(`\n-- ${tableName}`);
      await write(`alter table ${tableName} disable trigger user;`);
      await write(`delete from only ${tableName};`);
      let lastCtid = "(0,0)";
      for (;;) {
        const [{ rows, last }] = await source.query(
          `select coalesce(json_agg(to_json(x)), '[]'::json) as rows,
             max(x_ctid)::text as last
           from (
             select ${columnList}, ctid as x_ctid from only ${tableName}
             where ctid > $1::tid order by ctid limit ${COPY_BATCH_SIZE}
           ) x`,
          [lastCtid],
        );
        const batch = (rows as Record<string, unknown>[]).map(
          ({ x_ctid: _ctid, ...row }) => row,
        );
        if (batch.length === 0) break;
        const json = JSON.stringify(batch);
        const tag = dollarQuoteTag(json);
        await write(
          `insert into ${tableName} (${columnList}) ${overriding}select ${columnList} from json_populate_recordset(null::${tableName}, ${tag}${json}${tag});`,
        );
        rowCount += batch.length;
        lastCtid = last;
        if (batch.length < COPY_BATCH_SIZE) break;
      }
      for (const trigger of triggers) {
        await write(
          `alter table ${tableName} ${ENABLE_TRIGGER[trigger.state] ?? "enable trigger"} ${quoteIdentifier(trigger.name)};`,
        );
      }
      tableCount += 1;
    }
    await write("");
    const sequences = await source.query(`
      select schemaname as schema, sequencename as name
      from pg_sequences
      where schemaname not in ('pg_catalog', 'information_schema')`);
    for (const seq of sequences) {
      const sequenceName = qualifiedName(seq.schema, seq.name);
      const [state] = await source.query(
        `select last_value::text as "lastValue", is_called as "isCalled" from ${sequenceName}`,
      );
      // Text, not a JS number: bigint sequences exceed 2^53.
      if (!/^-?\d+$/.test(state.lastValue)) {
        throw new Error(`Unexpected value for sequence ${sequenceName}`);
      }
      await write(
        `select setval('${sequenceName.replace(/'/g, "''")}', ${state.lastValue}, ${state.isCalled ? "true" : "false"});`,
      );
    }
    for (const fk of foreignKeys) {
      await write(
        `alter table ${qualifiedName(fk.schema, fk.table)} add constraint ${quoteIdentifier(fk.name)} ${fk.definition};`,
      );
    }
    await write("commit;");
    await file.close();
  } catch (error) {
    await file.close().catch(() => {});
    await fs.rm(filePath, { force: true });
    throw error;
  } finally {
    await source.query("rollback").catch(() => {});
    await sourceConnection.close();
  }
  return { tables: tableCount, rows: rowCount };
}
