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
/**
 * Neon Auth's tables belong to Neon: on a provisioned branch the `neon_auth`
 * role owns them, and the app role is not a member of it, so it may read and
 * write their rows but not alter them. Copies keep their keys and order the
 * rows instead. Legacy app-owned tables may still have user triggers, which
 * can be temporarily disabled when the connected role has permission.
 */
const NEON_MANAGED_SCHEMA = "neon_auth";
const COPY_BATCH_SIZE = 500;

/** The copied rows did not match the source; the copy was rolled back. */
export class CopyVerificationError extends DyadError {
  constructor(message: string) {
    super(message, DyadErrorKind.Internal);
  }
}

/**
 * Rows of a table the copy may not alter can't be put in a safe order, e.g.
 * its foreign keys form a cycle, or a foreign key dropped from it can't be
 * added back. Raised before anything is written.
 */
export class UncopyableDataError extends DyadError {
  constructor(message: string) {
    super(message, DyadErrorKind.Precondition);
  }
}

export interface ForeignKeyDefinition {
  schema: string;
  table: string;
  name: string;
  definition: string;
}

/** A foreign key with the table it references and who may alter its table. */
export interface TableForeignKey extends ForeignKeyDefinition {
  referencedSchema: string;
  referencedTable: string;
  /** Whether the connected role may alter the table the key is on. */
  canAlter: boolean;
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

// Altering a table takes its owner's privileges, which a role has when it is
// the owner or inherits from it ('USAGE'); membership alone needs SET ROLE.
const CAN_ALTER = (relation: string) =>
  `pg_has_role(current_user, ${relation}.relowner, 'USAGE')`;

async function listForeignKeysWith(db: Queryable): Promise<TableForeignKey[]> {
  const rows = await db.query(`
    select n.nspname as schema, c.relname as "table", con.conname as name,
      pg_get_constraintdef(con.oid) as definition,
      rn.nspname as "referencedSchema", r.relname as "referencedTable",
      ${CAN_ALTER("c")} as "canAlter"
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class r on r.oid = con.confrelid
    join pg_namespace rn on rn.oid = r.relnamespace
    where con.contype = 'f' and ${USER_SCHEMA_FILTER}
      -- Partitions inherit their parent's foreign keys; those go with it.
      and con.conparentid = 0
    order by 1, 2, 3`);
  return rows as TableForeignKey[];
}

/** Tables with enabled user (not internal, foreign-key) triggers. */
async function listTriggeredTables(
  db: Queryable,
): Promise<{ schema: string; name: string }[]> {
  const rows = await db.query(`
    select distinct n.nspname as schema, c.relname as name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and t.tgenabled <> 'D'
      and ${USER_SCHEMA_FILTER}`);
  return rows as { schema: string; name: string }[];
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

export interface CopyTable {
  schema: string;
  name: string;
  /** Whether the connected role may alter the table. */
  canAlter: boolean;
}

async function listCopyTables(db: Queryable): Promise<CopyTable[]> {
  // Tables that hold rows, partitions included: a partitioned parent holds
  // none, and paging through it by ctid would skip rows, because ctids repeat
  // across partitions. Extension-owned tables belong to the extension on each
  // branch.
  const rows = await db.query(`
    select n.nspname as schema, c.relname as name, ${CAN_ALTER("c")} as "canAlter"
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

/** How a copy writes each table's rows. */
export interface DataCopyPlan {
  /** Keys to drop before the copy and re-add after it, which validates them. */
  droppedForeignKeys: TableForeignKey[];
  /**
   * Tables whose keys the copy keeps, parents before children. Their keys stay
   * on, so they are cleared children first and filled parents first.
   */
  managedTables: CopyTable[];
  /** Tables copied with their keys dropped and user triggers off. */
  ownedTables: CopyTable[];
}

function isManaged(table: { schema: string; canAlter: boolean }): boolean {
  return table.schema === NEON_MANAGED_SCHEMA || !table.canAlter;
}

const tableKey = (schema: string, name: string) => `${schema}.${name}`;

/**
 * Splits `tables` into those whose keys the copy drops and those whose keys
 * it keeps (Neon Auth's, and any the role doesn't own), and orders the latter
 * so every row goes in after the rows it references. Throws `UncopyableDataError`, before
 * anything is written, for what no order fixes: user triggers it can't turn
 * off, a key on a table that references itself, a cycle, or a key into a
 * table copied with its keys off.
 */
export function planDataCopy({
  tables,
  foreignKeys,
  triggered,
}: {
  tables: CopyTable[];
  foreignKeys: TableForeignKey[];
  triggered: { schema: string; name: string }[];
}): DataCopyPlan {
  const managed = tables.filter(isManaged);
  const owned = tables.filter((t) => !isManaged(t));
  const managedByKey = new Map(
    managed.map((t) => [tableKey(t.schema, t.name), t]),
  );
  const ownedKeys = new Set(owned.map((t) => tableKey(t.schema, t.name)));

  const triggeredKeys = new Set(
    triggered.map((t) => tableKey(t.schema, t.name)),
  );
  for (const [key, table] of managedByKey) {
    if (triggeredKeys.has(key) && !table.canAlter) {
      throw new UncopyableDataError(
        `Can't copy ${key}: it has enabled user triggers that the connected database role cannot disable.`,
      );
    }
  }

  const parents = new Map<string, Set<string>>(
    [...managedByKey.keys()].map((key) => [key, new Set<string>()]),
  );
  for (const fk of foreignKeys) {
    const child = tableKey(fk.schema, fk.table);
    const parent = tableKey(fk.referencedSchema, fk.referencedTable);
    if (!managedByKey.has(child)) continue;
    if (child === parent) {
      throw new UncopyableDataError(
        `Can't copy ${child}: its rows refer to each other, and Dyad can't turn off its keys.`,
      );
    }
    if (ownedKeys.has(parent)) {
      throw new UncopyableDataError(
        `Can't copy ${child}: it refers to ${parent}, which is copied with its keys turned off.`,
      );
    }
    // A table outside the copy keeps its rows, so it sets no order.
    if (managedByKey.has(parent)) parents.get(child)!.add(parent);
  }

  // Parents first; among the tables that are ready, by name, so the order is
  // always the same.
  const order: CopyTable[] = [];
  const done = new Set<string>();
  const pending = [...managedByKey.keys()].sort();
  while (pending.length > 0) {
    const index = pending.findIndex((key) =>
      [...parents.get(key)!].every((p) => done.has(p)),
    );
    if (index < 0) {
      throw new UncopyableDataError(
        `Can't copy ${pending.join(", ")}: their foreign keys form a cycle, and Dyad can't turn them off.`,
      );
    }
    const [key] = pending.splice(index, 1);
    done.add(key);
    order.push(managedByKey.get(key)!);
  }

  return {
    droppedForeignKeys: foreignKeys.filter(
      (fk) => !isManaged({ schema: fk.schema, canAlter: fk.canAlter }),
    ),
    managedTables: order,
    ownedTables: owned,
  };
}

/**
 * What a migration's copy would lose, as user-facing descriptions; empty when
 * it is safe. When Neon Auth is re-provisioned, user triggers and dependent
 * views and policies would be dropped with the copied `neon_auth` schema (only
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
      union
      select format('the trigger %I on %I.%I', t.tgname, n.nspname, c.relname)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where c.oid in (select oid from auth_tables) and not t.tgisinternal
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

/**
 * Inspect the destination at execution time, including for a SQL backup.
 * Source ownership and trigger states say nothing about the role or tables
 * used to restore it. Keep triggers off across all deletes and inserts, and
 * restore only the enabled triggers we changed; disabled ones stay untouched.
 * Both blocks run inside the copy/restore transaction, so any error rolls
 * back their changes as well as the copied rows.
 */
function triggerCopySql(tables: CopyTable[]): {
  disable: string;
  restore: string;
} {
  const names = JSON.stringify(
    tables.map((t) => qualifiedName(t.schema, t.name)),
  );
  const namesTag = dollarQuoteTag(names);
  const disable = `
declare
  table_name text;
  table_id regclass;
  user_trigger record;
begin
  create temporary table dyad_copy_trigger_states (
    table_id oid, trigger_name name, state text
  ) on commit drop;
  for table_name in
    select json_array_elements_text(${namesTag}${names}${namesTag}::json)
  loop
    table_id := table_name::regclass;
    for user_trigger in
      select t.tgname, t.tgenabled, ${CAN_ALTER("c")} as can_alter
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgrelid = table_id and not t.tgisinternal and t.tgenabled <> 'D'
    loop
      if not user_trigger.can_alter then
        raise exception 'Can''t copy %: it has enabled user triggers that the connected database role cannot disable.', table_name;
      end if;
      insert into pg_temp.dyad_copy_trigger_states
        values (table_id, user_trigger.tgname, user_trigger.tgenabled);
      execute format('alter table %s disable trigger %I', table_id, user_trigger.tgname);
    end loop;
  end loop;
end`;
  // Identifiers can contain dollar-quote tags too, so quote the entire body.
  const disableTag = dollarQuoteTag(disable);
  return {
    disable: `do ${disableTag}${disable}${disableTag};`,
    restore: `do $$
declare
  user_trigger record;
begin
  for user_trigger in select * from pg_temp.dyad_copy_trigger_states loop
    execute format('alter table %s %s %I', user_trigger.table_id::regclass,
      case user_trigger.state
        when 'R' then 'enable replica trigger'
        when 'A' then 'enable always trigger'
        else 'enable trigger'
      end, user_trigger.trigger_name);
  end loop;
end $$;`,
  };
}

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
 * the copy and re-added afterwards (re-adding validates them). Enabled user
 * triggers are disabled, then put back in their original state.
 * Tables it may not alter, Neon Auth's among them, keep their keys: their
 * rows go in parents first instead (see `planDataCopy`).
 *
 * `extraForeignKeys` are constraints captured from the target before
 * `prepareSchemaOnlyBranchForNeonAuth` dropped them along with the copied
 * `neon_auth` schema; they are restored once the data is in place. If the
 * role can't restore one, the copy throws `UncopyableDataError` instead.
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

    // Ownership is the target's: that is where the rows are written.
    const targetTables = new Map(
      (await listCopyTables(target)).map((t) => [
        tableKey(t.schema, t.name),
        t,
      ]),
    );
    const tables: CopyTable[] = [];
    const insertShape = new Map<
      string,
      { columnList: string; overriding: string }
    >();
    for (const table of await listCopyTables(source)) {
      const key = tableKey(table.schema, table.name);
      const onTarget = targetTables.get(key);
      if (!onTarget) {
        logger.warn(`Skipping ${key}: missing on the target branch`);
        continue;
      }
      const targetColumns = new Map(
        (await listInsertableColumns(target, onTarget)).map((c) => [c.name, c]),
      );
      const columns = (await listInsertableColumns(source, table)).filter((c) =>
        targetColumns.has(c.name),
      );
      if (columns.length === 0) continue;
      insertShape.set(key, {
        columnList: columns.map((c) => quoteIdentifier(c.name)).join(", "),
        overriding: columns.some(
          (c) => targetColumns.get(c.name)?.identityAlways,
        )
          ? "overriding system value"
          : "",
      });
      tables.push(onTarget);
    }
    const targetForeignKeys = await listForeignKeysWith(target);
    const plan = planDataCopy({
      tables,
      foreignKeys: targetForeignKeys,
      triggered: await listTriggeredTables(target),
    });

    // Every key dropped below is re-added, including those on partitioned
    // parents, which hold no rows and so are not in `tables`. An extra key
    // still on the target was never dropped; neon_auth's own keys belong to
    // Neon Auth's fresh provisioning. Any other extra key was dropped with
    // the copied neon_auth schema, so it comes back, and a copy that can't
    // add it back is refused rather than committed without it.
    const foreignKeyId = (fk: ForeignKeyDefinition) =>
      `${fk.schema}.${fk.table}.${fk.name}`;
    const foreignKeysToRestore = new Map<string, ForeignKeyDefinition>(
      plan.droppedForeignKeys.map((fk) => [foreignKeyId(fk), fk]),
    );
    const presentForeignKeys = new Set(targetForeignKeys.map(foreignKeyId));
    for (const fk of extraForeignKeys) {
      const id = foreignKeyId(fk);
      if (fk.schema === NEON_MANAGED_SCHEMA || presentForeignKeys.has(id)) {
        continue;
      }
      const tableName = qualifiedName(fk.schema, fk.table);
      const [{ exists, canAlter }] = await target.query(
        `select c.oid is not null as exists,
           coalesce(${CAN_ALTER("c")}, false) as "canAlter"
         from (select to_regclass($1)::oid as oid) r
         left join pg_class c on c.oid = r.oid`,
        [tableName],
      );
      if (!exists) {
        logger.warn(`Not restoring ${id}: its table is missing on the target`);
        continue;
      }
      if (!canAlter) {
        throw new UncopyableDataError(
          `Can't copy ${tableKey(fk.schema, fk.table)}: its foreign key ${fk.name} was removed along with Neon Auth's tables, and the connected database role can't add it back.`,
        );
      }
      foreignKeysToRestore.set(id, fk);
    }

    const triggers = triggerCopySql(tables);
    await target.query(triggers.disable);
    for (const fk of plan.droppedForeignKeys) {
      await target.query(
        `alter table ${qualifiedName(fk.schema, fk.table)} drop constraint ${quoteIdentifier(fk.name)}`,
      );
    }

    const copyRows = async (table: CopyTable) => {
      const tableName = qualifiedName(table.schema, table.name);
      const { columnList, overriding } = insertShape.get(
        tableKey(table.schema, table.name),
      )!;
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
      copiedTables += 1;
    };

    // Tables the copy may not alter keep their keys: clear them children
    // first, so no key blocks a delete, then fill them parents first. Keys
    // into them from the app's tables were dropped above.
    for (const table of [...plan.managedTables].reverse()) {
      const tableName = qualifiedName(table.schema, table.name);
      await target.query(`delete from only ${tableName}`);
      copiedTableNames.push(tableName);
    }
    for (const table of plan.managedTables) await copyRows(table);

    for (const table of plan.ownedTables) {
      const tableName = qualifiedName(table.schema, table.name);
      await target.query(`delete from only ${tableName}`);
      copiedTableNames.push(tableName);
      await copyRows(table);
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

    await target.query(triggers.restore);
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
 * Neon Auth's keys stay in place; their rows are written parents first.
 * Triggers are checked and, where permitted, disabled on the restore target.
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
    // The file is restored later, as whatever role runs it (the Neon SQL
    // editor uses the app role), so Neon Auth's keys stay in place regardless
    // of source ownership. Trigger permissions are checked during restoration.
    const tables: CopyTable[] = [];
    const insertShape = new Map<
      string,
      { columnList: string; overriding: string }
    >();
    for (const table of await listCopyTables(source)) {
      const columns = await listInsertableColumns(source, table);
      if (columns.length === 0) continue;
      insertShape.set(tableKey(table.schema, table.name), {
        columnList: columns.map((c) => quoteIdentifier(c.name)).join(", "),
        overriding: columns.some((c) => c.identityAlways)
          ? "overriding system value "
          : "",
      });
      tables.push(table);
    }
    const plan = planDataCopy({
      tables,
      foreignKeys: await listForeignKeysWith(source),
      // The file checks the destination's triggers before writing any rows.
      triggered: [],
    });
    const triggers = triggerCopySql(tables);
    await write(triggers.disable);
    for (const fk of plan.droppedForeignKeys) {
      await write(
        `alter table ${qualifiedName(fk.schema, fk.table)} drop constraint if exists ${quoteIdentifier(fk.name)};`,
      );
    }

    const writeRows = async (table: CopyTable) => {
      const tableName = qualifiedName(table.schema, table.name);
      const { columnList, overriding } = insertShape.get(
        tableKey(table.schema, table.name),
      )!;
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
      tableCount += 1;
    };

    if (plan.managedTables.length > 0) {
      await write(
        [
          "",
          "-- Neon Auth's foreign keys stay on:",
          "-- they are cleared children first, then filled parents first.",
        ].join("\n"),
      );
      for (const table of [...plan.managedTables].reverse()) {
        await write(
          `delete from only ${qualifiedName(table.schema, table.name)};`,
        );
      }
      for (const table of plan.managedTables) {
        await write(`\n-- ${qualifiedName(table.schema, table.name)}`);
        await writeRows(table);
      }
    }

    for (const table of plan.ownedTables) {
      const tableName = qualifiedName(table.schema, table.name);
      await write(`\n-- ${tableName}`);
      await write(`delete from only ${tableName};`);
      await writeRows(table);
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
    for (const fk of plan.droppedForeignKeys) {
      await write(
        `alter table ${qualifiedName(fk.schema, fk.table)} add constraint ${quoteIdentifier(fk.name)} ${fk.definition};`,
      );
    }
    await write(triggers.restore);
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
