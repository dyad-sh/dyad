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
/**
 * A role without `BYPASSRLS` reading a table it doesn't own sees only the rows
 * its policies allow, and the verifying row counts are filtered the same way,
 * so a partial copy would pass and the old branch be deleted. With row
 * security off, Postgres fails any query a policy would filter instead. Run
 * inside each transaction, on the source as well as the target.
 */
const NO_ROW_SECURITY = "set local row_security = off";

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
      -- planDataCopy maps them onto the partitions to order their rows.
      and con.conparentid = 0
    order by 1, 2, 3`);
  return rows as TableForeignKey[];
}

/** A partition and the partitioned table it belongs to. */
export interface TablePartition {
  schema: string;
  name: string;
  parentSchema: string;
  parentName: string;
}

async function listPartitionsWith(db: Queryable): Promise<TablePartition[]> {
  const rows = await db.query(`
    select cn.nspname as schema, c.relname as name,
      n.nspname as "parentSchema", p.relname as "parentName"
    from pg_inherits i
    join pg_class p on p.oid = i.inhparent
    join pg_namespace n on n.oid = p.relnamespace
    join pg_class c on c.oid = i.inhrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    where p.relkind = 'p' and ${USER_SCHEMA_FILTER}
    order by 1, 2`);
  return rows as TablePartition[];
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
    end $$`);
  await grantNeonAuthCreatePermission(connectionUri);
}

/**
 * Allows later provisioning without changing existing schemas, roles or data.
 * Not enough on its own when the branch already has a `neon_auth` schema or
 * role; see `findLeftoverNeonAuthObjects`.
 */
export async function grantNeonAuthCreatePermission(connectionUri: string) {
  if (IS_TEST_BUILD) return;
  await httpQueryable(connectionUri).query(`
    do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'neon_service') then
        execute format('grant create on database %I to neon_service', current_database());
      end if;
    end $$`);
}

export interface NeonAuthLeftovers {
  schema: boolean;
  role: boolean;
}

/**
 * The `neon_auth` schema and role on a branch, which block provisioning Neon
 * Auth on it (409 and 412; see `prepareSchemaOnlyBranchForNeonAuth`) unless
 * Auth is already active there.
 */
export async function findLeftoverNeonAuthObjects(
  connectionUri: string,
): Promise<NeonAuthLeftovers> {
  if (IS_TEST_BUILD) return { schema: false, role: false };
  const [existing] = await httpQueryable(connectionUri).query(`
    select to_regnamespace('neon_auth') is not null as schema,
           to_regrole('neon_auth') is not null as role`);
  return { schema: !!existing.schema, role: !!existing.role };
}

/** "schema", "role" or "schema and role", for messages. */
export function describeNeonAuthLeftovers({
  schema,
  role,
}: NeonAuthLeftovers): string {
  return [schema && "schema", role && "role"].filter(Boolean).join(" and ");
}

export interface CopyTable {
  schema: string;
  name: string;
  /** Whether the connected role may alter the table. */
  canAlter: boolean;
}

async function listCopyTables(
  db: Queryable,
  hasNeonAuth: boolean,
): Promise<CopyTable[]> {
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
    (t) =>
      !(
        hasNeonAuth &&
        t.schema === "neon_auth" &&
        NEON_AUTH_SERVICE_TABLES.has(t.name)
      ),
  );
}

async function listInsertableColumns(
  db: Queryable,
  table: CopyTable,
): Promise<{ name: string; identityAlways: boolean }[]> {
  const name = qualifiedName(table.schema, table.name);
  const rows = await db.query(
    `select a.attname as name, a.attidentity = 'a' as "identityAlways"
     from pg_attribute a
     where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = ''
     order by a.attnum`,
    [name],
  );
  if (
    !rows.length &&
    (await db.query(`select 1 from only ${name} limit 1`)).length
  ) {
    throw new DyadError(
      `Cannot copy ${name}: it contains rows but has no writable columns.`,
      DyadErrorKind.Precondition,
    );
  }
  return rows as { name: string; identityAlways: boolean }[];
}

/** A table outside the copy whose kept key refers to a table it clears. */
export interface OutsideReference {
  /** The table outside the copy, as a quoted SQL name. */
  table: string;
  /**
   * A table in the copy that it refers to, as a quoted SQL name; a table
   * that refers to several is listed once for each.
   */
  references: string;
}

/** How a copy writes each table's rows. */
export interface DataCopyPlan {
  /** Keys to drop before the copy and re-add after it, which validates them. */
  droppedForeignKeys: TableForeignKey[];
  /**
   * Tables bound by keys the copy keeps, parents before children. Those keys
   * stay on, so they are cleared children first and filled parents first.
   */
  managedTables: CopyTable[];
  /** Tables copied with their keys dropped and user triggers off. */
  ownedTables: CopyTable[];
  /**
   * Clearing the tables these refer to would fail on, or cascade into, their
   * rows, so a copy must refuse unless they are empty.
   */
  outsideReferences: OutsideReference[];
}

function isManaged(table: { schema: string; canAlter: boolean }): boolean {
  return table.schema === NEON_MANAGED_SCHEMA || !table.canAlter;
}

/**
 * The quoted SQL name: unlike `schema.name`, no two tables share one, e.g.
 * `"public"."x.y"` and `"public.x"."y"`.
 */
const tableKey = qualifiedName;

function outsideReferenceMessage({ table, references }: OutsideReference) {
  return `Can't copy ${references}: rows of ${table}, which isn't copied, refer to it through a foreign key Dyad can't turn off.`;
}

/**
 * Splits `tables` into those whose keys the copy drops and those bound by
 * keys it keeps (Neon Auth's, and any the role doesn't own), and orders the
 * latter so every row goes in after the rows it references. A key declared
 * on (or into) a partitioned table binds the rows of its partitions, which
 * are what `tables` lists, so `partitions` maps it onto them. Throws
 * `UncopyableDataError`, before anything is written, for what no order
 * fixes: user triggers it can't turn off, a key on a table that references
 * itself, a cycle, or a key into a table copied with its keys off.
 */
export function planDataCopy({
  tables,
  foreignKeys,
  triggered,
  partitions = [],
}: {
  tables: CopyTable[];
  foreignKeys: TableForeignKey[];
  triggered: { schema: string; name: string }[];
  partitions?: TablePartition[];
}): DataCopyPlan {
  const partitionsOf = new Map<string, string[]>();
  for (const p of partitions) {
    const parentKey = tableKey(p.parentSchema, p.parentName);
    partitionsOf.set(parentKey, [
      ...(partitionsOf.get(parentKey) ?? []),
      tableKey(p.schema, p.name),
    ]);
  }
  // The tables holding a table's rows: itself, or its partitions' leaves.
  const leaves = (key: string): string[] =>
    partitionsOf.get(key)?.flatMap(leaves) ?? [key];

  // The copy drops every other key, so while it runs they bind no rows.
  const isKept = (fk: TableForeignKey) =>
    isManaged({ schema: fk.schema, canAlter: fk.canAlter });
  const keptForeignKeys = foreignKeys.filter(isKept);
  // A partition inherits its ancestors' keys, so one under a kept key is
  // ordered by it even when the role could drop the partition's own keys.
  const underKeptKey = new Set(
    keptForeignKeys.flatMap((fk) => leaves(tableKey(fk.schema, fk.table))),
  );
  const isOrdered = (t: CopyTable) =>
    isManaged(t) || underKeptKey.has(tableKey(t.schema, t.name));
  const managed = tables.filter(isOrdered);
  const owned = tables.filter((t) => !isOrdered(t));
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
  const outsideReferences = new Map<string, Set<string>>();
  for (const fk of keptForeignKeys) {
    for (const child of leaves(tableKey(fk.schema, fk.table))) {
      for (const parent of leaves(
        tableKey(fk.referencedSchema, fk.referencedTable),
      )) {
        if (!managedByKey.has(child)) {
          // Every leaf under a kept key is managed, so this one is outside the
          // copy: its rows stay, and stop (or cascade from) clearing `parent`.
          // Each such parent is locked before the check (see
          // `lockOutsideReferenceSql`), so all of them are listed.
          const parentCopied =
            managedByKey.has(parent) || ownedKeys.has(parent);
          if (parentCopied) {
            const references =
              outsideReferences.get(child) ?? new Set<string>();
            outsideReferences.set(child, references.add(parent));
          }
        } else if (child === parent) {
          throw new UncopyableDataError(
            `Can't copy ${child}: its rows refer to each other, and Dyad can't turn off its keys.`,
          );
        } else if (ownedKeys.has(parent)) {
          throw new UncopyableDataError(
            `Can't copy ${child}: it refers to ${parent}, which is copied with its keys turned off.`,
          );
        } else if (managedByKey.has(parent)) {
          // A table outside the copy keeps its rows, so it sets no order.
          parents.get(child)!.add(parent);
        }
      }
    }
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
    droppedForeignKeys: foreignKeys.filter((fk) => !isKept(fk)),
    managedTables: order,
    ownedTables: owned,
    outsideReferences: [...outsideReferences].flatMap(([table, references]) =>
      [...references].map((parent) => ({ table, references: parent })),
    ),
  };
}

/**
 * Inserting a row with a foreign key locks the table it refers to (the key
 * check's `FOR KEY SHARE` lookup), and `exclusive` mode blocks that until
 * commit while still letting plain reads through. Taken before checking that
 * an outside table is empty, it stops a row from being committed there
 * between the check and the delete that would cascade into it. The copy
 * deletes from that table anyway, and the DELETE privilege permits any lock
 * mode; locking the outside table itself would need write privileges on a
 * table the copy only reads.
 */
function lockOutsideReferenceSql({ references }: OutsideReference): string {
  return `lock table ${references} in exclusive mode`;
}

/**
 * Refuses, on the restore target, to clear tables that a table outside the
 * backup refers to while that table has rows (see `outsideReferences`). A
 * table missing there has none.
 */
function outsideReferenceCheckSql(reference: OutsideReference): string {
  const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;
  const body = `
declare
  has_rows boolean;
begin
  if to_regclass(${literal(reference.table)}) is not null then
    execute ${literal(lockOutsideReferenceSql(reference))};
    execute ${literal(`select exists (select 1 from only ${reference.table})`)}
      into has_rows;
    if has_rows then
      raise exception using message = ${literal(outsideReferenceMessage(reference))};
    end if;
  end if;
end`;
  const tag = dollarQuoteTag(body);
  return `do ${tag}${body}${tag};`;
}

/**
 * The `neon_auth` tables and columns of `sourceUri` that the re-provisioned
 * Neon Auth of `targetUri` lacks: what `copyBranchData` reports as `skipped`
 * when copying between them. For finishing an interrupted migration, whose
 * copy is done but whose report was lost.
 */
export async function findNeonAuthDataNotCopied(
  sourceUri: string,
  targetUri: string,
): Promise<string[]> {
  if (IS_TEST_BUILD) return [];
  const source = httpQueryable(sourceUri);
  const target = httpQueryable(targetUri);
  const targetTables = new Set(
    (await listCopyTables(target, true)).map((t) =>
      qualifiedName(t.schema, t.name),
    ),
  );
  const skipped: string[] = [];
  for (const table of await listCopyTables(source, true)) {
    if (table.schema !== "neon_auth") continue;
    const tableName = qualifiedName(table.schema, table.name);
    if (!targetTables.has(tableName)) {
      skipped.push(tableName);
      continue;
    }
    const targetColumns = new Set(
      (await listInsertableColumns(target, table)).map((c) => c.name),
    );
    for (const column of await listInsertableColumns(source, table)) {
      if (!targetColumns.has(column.name)) {
        skipped.push(`${tableName}.${quoteIdentifier(column.name)}`);
      }
    }
  }
  return skipped;
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
 * The next `COPY_BATCH_SIZE` rows of `tableName` after `afterCtid`, keyset
 * paginated on ctid (stable within a snapshot). The rows stay JSON text that
 * `json_populate_recordset` reads back: Postgres writes bigint and numeric
 * values as exact literals, and parsing them in JS would round them.
 *
 * The page keeps the column under its own name, `ctid`: Postgres rejects user
 * columns named after system columns, so it cannot collide with one, as any
 * alias could. For the same reason the row is `r.*`: Postgres would resolve a
 * bare `r` to a column named `r` before the row.
 */
async function readRowsPage(
  db: Queryable,
  tableName: string,
  columnList: string,
  afterCtid: string,
): Promise<{ json: string; count: number; last: string | null }> {
  const [page] = await db.query(
    `with page as materialized (
       select ctid, ${columnList} from only ${tableName}
       where ctid > $1::tid order by ctid limit ${COPY_BATCH_SIZE}
     )
     select
       (select coalesce(json_agg(to_json(r.*)), '[]'::json)::text
        from (select ${columnList} from page) r) as json,
       (select count(*)::int from page) as count,
       (select max(ctid)::text from page) as last`,
    [afterCtid],
  );
  return page as { json: string; count: number; last: string | null };
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

export interface CopyBranchDataOutcome extends CopyBranchDataResult {
  /**
   * `neon_auth` tables and columns that re-provisioned Neon Auth no longer
   * has, so their data is only in the backup.
   */
  skipped: string[];
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
 *
 * Every source table and column must exist on the target, except in
 * `neon_auth` when `hasNeonAuth`: re-provisioning gives it the schema of Neon
 * Auth's current version, which nothing can change, so what an older version
 * had is skipped and reported.
 */
export async function copyBranchData({
  sourceUri,
  targetUri,
  hasNeonAuth,
  extraForeignKeys = [],
}: {
  sourceUri: string;
  targetUri: string;
  hasNeonAuth: boolean;
  extraForeignKeys?: ForeignKeyDefinition[];
}): Promise<CopyBranchDataOutcome> {
  const sourceConnection = await poolQueryable(sourceUri);
  const targetConnection = await poolQueryable(targetUri);
  const source = sourceConnection.db;
  const target = targetConnection.db;
  let copiedRows = 0;
  let copiedTables = 0;
  const copiedTableNames: string[] = [];
  const skipped: string[] = [];
  try {
    await source.query("begin isolation level repeatable read read only");
    await source.query(NO_ROW_SECURITY);
    await target.query("begin");
    await target.query(NO_ROW_SECURITY);

    // Ownership is the target's: that is where the rows are written.
    const targetTables = new Map(
      (await listCopyTables(target, hasNeonAuth)).map((t) => [
        tableKey(t.schema, t.name),
        t,
      ]),
    );
    const tables: CopyTable[] = [];
    const insertShape = new Map<
      string,
      { columnList: string; overriding: string }
    >();
    for (const table of await listCopyTables(source, hasNeonAuth)) {
      const tableName = tableKey(table.schema, table.name);
      const reprovisioned = hasNeonAuth && table.schema === "neon_auth";
      const onTarget = targetTables.get(tableName);
      if (!onTarget) {
        if (reprovisioned) {
          skipped.push(tableName);
          continue;
        }
        throw new DyadError(
          `Cannot copy ${tableName}: the table is missing on the new development branch.`,
          DyadErrorKind.Precondition,
        );
      }
      const targetColumns = new Map(
        (await listInsertableColumns(target, onTarget)).map((c) => [c.name, c]),
      );
      const sourceColumns = await listInsertableColumns(source, table);
      const missingColumns = sourceColumns.filter(
        (c) => !targetColumns.has(c.name),
      );
      if (missingColumns.length > 0 && !reprovisioned) {
        throw new DyadError(
          `Cannot copy ${tableName}: column ${quoteIdentifier(missingColumns[0].name)} is missing or generated on the new development branch.`,
          DyadErrorKind.Precondition,
        );
      }
      skipped.push(
        ...missingColumns.map((c) => `${tableName}.${quoteIdentifier(c.name)}`),
      );
      const columns = sourceColumns.filter((c) => targetColumns.has(c.name));
      if (columns.length === 0) continue;
      insertShape.set(tableName, {
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
      partitions: await listPartitionsWith(target),
    });
    for (const reference of plan.outsideReferences) {
      await target.query(lockOutsideReferenceSql(reference));
      const [{ hasRows }] = await target.query(
        `select exists (select 1 from only ${reference.table}) as "hasRows"`,
      );
      if (hasRows) {
        throw new UncopyableDataError(outsideReferenceMessage(reference));
      }
    }

    // Every key dropped below is re-added, including those on partitioned
    // parents, which hold no rows and so are not in `tables`. An extra key
    // still on the target was never dropped; neon_auth's own keys belong to
    // Neon Auth's fresh provisioning. Any other extra key was dropped with
    // the copied neon_auth schema, so it comes back, and a copy that can't
    // add it back is refused rather than committed without it.
    const foreignKeyId = (fk: ForeignKeyDefinition) =>
      `${tableKey(fk.schema, fk.table)}.${quoteIdentifier(fk.name)}`;
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
      let lastCtid = "(0,0)";
      for (;;) {
        const page = await readRowsPage(
          source,
          tableName,
          columnList,
          lastCtid,
        );
        if (page.count === 0 || page.last === null) break;
        await target.query(
          `insert into ${tableName} (${columnList}) ${overriding}
           select ${columnList} from json_populate_recordset(null::${tableName}, $1::json)`,
          [page.json],
        );
        copiedRows += page.count;
        lastCtid = page.last;
        if (page.count < COPY_BATCH_SIZE) break;
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

  return { tables: copiedTables, rows: copiedRows, skipped };
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
  hasNeonAuth,
}: {
  sourceUri: string;
  hasNeonAuth: boolean;
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
    await source.query(NO_ROW_SECURITY);
    await write(
      [
        `-- ${title.replace(/\n/g, " ")}`,
        `-- Saved ${new Date().toISOString()}. Data only, not the schema; includes Neon Auth users.`,
        "-- To restore, run this whole file against a database with the same schema",
        "-- (e.g. in the Neon SQL editor or with psql). It replaces the rows of every",
        "-- table below.",
        "begin;",
        "-- Fail, rather than replace only the rows row-level security lets you see.",
        `${NO_ROW_SECURITY};`,
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
    for (const table of await listCopyTables(source, hasNeonAuth)) {
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
      partitions: await listPartitionsWith(source),
    });
    for (const reference of plan.outsideReferences) {
      await write(outsideReferenceCheckSql(reference));
    }
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
        const page = await readRowsPage(
          source,
          tableName,
          columnList,
          lastCtid,
        );
        if (page.count === 0 || page.last === null) break;
        const tag = dollarQuoteTag(page.json);
        await write(
          `insert into ${tableName} (${columnList}) ${overriding}select ${columnList} from json_populate_recordset(null::${tableName}, ${tag}${page.json}${tag});`,
        );
        rowCount += page.count;
        lastCtid = page.last;
        if (page.count < COPY_BATCH_SIZE) break;
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
