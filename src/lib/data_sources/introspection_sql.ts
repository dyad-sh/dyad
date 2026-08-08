/**
 * The catalogue queries.
 *
 * Kept as constants in their own file, away from the driver, for two reasons.
 * They are the part of the provider a reviewer most needs to read closely, and
 * they are the part that must pass the read-only guard, which is far easier to
 * assert when the SQL is a value rather than a string built at call time.
 *
 * Everything reads from information_schema and pg_catalog. Nothing here
 * touches user data: it is metadata only, which is what lets discovery run
 * against a production database without asking anyone's permission twice.
 */

/**
 * Schemas Postgres and Supabase own.
 *
 * Excluded from discovery because they describe the machinery rather than the
 * customer's information, and including them buries a twelve-table
 * application under several hundred rows of platform internals.
 */
export const SYSTEM_SCHEMAS = [
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "auth",
  "storage",
  "realtime",
  "supabase_functions",
  "supabase_migrations",
  "extensions",
  "graphql",
  "graphql_public",
  "vault",
  "net",
  "cron",
  "pgsodium",
  "pgsodium_masks",
] as const;

/** Rendered as a SQL array literal for the `<> all (...)` filters below. */
const EXCLUDED = SYSTEM_SCHEMAS.map((name) => `'${name}'`).join(", ");

/** A harmless statement to prove the connection works at all. */
export const PING_SQL = "select 1 as ok";

/** Server version and current database, for the health panel. */
export const SERVER_INFO_SQL = `
select
  current_database() as database,
  current_user as role,
  version() as server_version
`.trim();

/**
 * Tables and views, with their comments and an estimated row count.
 *
 * The estimate comes from pg_class.reltuples rather than from count(*): an
 * exact count on a large table is a full scan, and discovery should never be
 * the reason someone's database slows down. It is labelled as an estimate
 * everywhere it surfaces.
 */
export const TABLES_SQL = `
select
  n.nspname as schema_name,
  c.relname as table_name,
  case c.relkind
    when 'r' then 'table'
    when 'p' then 'table'
    when 'v' then 'view'
    when 'm' then 'materialized_view'
    when 'f' then 'foreign_table'
    else 'table'
  end as table_type,
  coalesce(obj_description(c.oid, 'pg_class'), '') as description,
  case when c.reltuples < 0 then null else c.reltuples::bigint end as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = any (array['r', 'p', 'v', 'm', 'f'])
  and n.nspname <> all (array[${EXCLUDED}])
  and n.nspname not like 'pg_%'
order by n.nspname, c.relname
`.trim();

/** Columns, with type, nullability, default and comment. */
export const COLUMNS_SQL = `
select
  n.nspname as schema_name,
  c.relname as table_name,
  a.attname as column_name,
  format_type(a.atttypid, a.atttypmod) as data_type,
  not a.attnotnull as nullable,
  pg_get_expr(d.adbin, d.adrelid) as default_value,
  coalesce(col_description(c.oid, a.attnum), '') as description
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where a.attnum > 0
  and not a.attisdropped
  and c.relkind = any (array['r', 'p', 'v', 'm', 'f'])
  and n.nspname <> all (array[${EXCLUDED}])
  and n.nspname not like 'pg_%'
order by n.nspname, c.relname, a.attnum
`.trim();

/** Primary key and unique constraints, so a column can be marked correctly. */
export const KEYS_SQL = `
select
  n.nspname as schema_name,
  c.relname as table_name,
  a.attname as column_name,
  con.contype as constraint_type
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum = any (con.conkey)
where con.contype in ('p', 'u')
  and n.nspname <> all (array[${EXCLUDED}])
  and n.nspname not like 'pg_%'
`.trim();

/**
 * Foreign keys, which become the relationship map.
 *
 * Single-column keys only for now: a composite key cannot be expressed by the
 * one-column-to-one-column join the query plan allows, so recording it would
 * offer the agent a relationship it cannot actually use.
 */
export const FOREIGN_KEYS_SQL = `
select
  con.conname as constraint_name,
  sn.nspname as source_schema,
  sc.relname as source_table,
  sa.attname as source_column,
  tn.nspname as target_schema,
  tc.relname as target_table,
  ta.attname as target_column
from pg_constraint con
join pg_class sc on sc.oid = con.conrelid
join pg_namespace sn on sn.oid = sc.relnamespace
join pg_class tc on tc.oid = con.confrelid
join pg_namespace tn on tn.oid = tc.relnamespace
join pg_attribute sa on sa.attrelid = sc.oid and sa.attnum = con.conkey[1]
join pg_attribute ta on ta.attrelid = tc.oid and ta.attnum = con.confkey[1]
where con.contype = 'f'
  and array_length(con.conkey, 1) = 1
  and sn.nspname <> all (array[${EXCLUDED}])
  and sn.nspname not like 'pg_%'
`.trim();

/** Enum types and their values, which make a status column self-explaining. */
export const ENUMS_SQL = `
select
  n.nspname as schema_name,
  t.typname as enum_name,
  e.enumlabel as enum_value
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname <> all (array[${EXCLUDED}])
  and n.nspname not like 'pg_%'
order by n.nspname, t.typname, e.enumsortorder
`.trim();

/** Every statement discovery runs, so a test can assert all of them at once. */
export const ALL_INTROSPECTION_SQL = [
  PING_SQL,
  SERVER_INFO_SQL,
  TABLES_SQL,
  COLUMNS_SQL,
  KEYS_SQL,
  FOREIGN_KEYS_SQL,
  ENUMS_SQL,
] as const;
