export const getSchemasSql = `
SELECT nspname::TEXT AS schema_name
FROM pg_catalog.pg_namespace
WHERE
    nspname NOT IN ('pg_catalog', 'information_schema')
    AND nspname !~ '^pg_toast'
    AND nspname !~ '^pg_temp'
    AND NOT EXISTS (
        SELECT depend.objid
        FROM pg_catalog.pg_depend AS depend
        WHERE
            depend.classid = 'pg_namespace'::REGCLASS
            AND depend.objid = pg_namespace.oid
            AND depend.deptype = 'e'
    );
`;

export const getEnumsSql = `
SELECT
    pg_type.typname::TEXT AS enum_name,
    type_namespace.nspname::TEXT AS enum_schema_name,
    (SELECT
        ARRAY_AGG(
            pg_enum.enumlabel
            ORDER BY pg_enum.enumsortorder
        )
    FROM pg_catalog.pg_enum
    WHERE pg_enum.enumtypid = pg_type.oid)::TEXT [] AS enum_labels
FROM pg_catalog.pg_type AS pg_type
INNER JOIN
    pg_catalog.pg_namespace AS type_namespace
    ON pg_type.typnamespace = type_namespace.oid
WHERE
    pg_type.typtype = 'e'
    AND type_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND type_namespace.nspname !~ '^pg_toast'
    AND type_namespace.nspname !~ '^pg_temp'
    AND NOT EXISTS (
        SELECT ext_depend.objid
        FROM pg_catalog.pg_depend AS ext_depend
        WHERE
            ext_depend.classid = 'pg_type'::REGCLASS
            AND ext_depend.objid = pg_type.oid
            AND ext_depend.deptype = 'e'
    );
`;

export const getTablesSql = `
SELECT
    c.oid::TEXT AS oid,
    c.relname::TEXT AS table_name,
    table_namespace.nspname::TEXT AS table_schema_name,
    c.relreplident::TEXT AS replica_identity,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced,
    COALESCE(parent_c.relname, '')::TEXT AS parent_table_name,
    COALESCE(parent_namespace.nspname, '')::TEXT AS parent_table_schema_name,
    (CASE
        WHEN c.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(c.oid)
        ELSE ''
    END)::TEXT AS partition_key_def,
    (CASE
        WHEN c.relispartition THEN pg_catalog.pg_get_expr(c.relpartbound, c.oid)
        ELSE ''
    END)::TEXT AS partition_for_values
FROM pg_catalog.pg_class AS c
INNER JOIN
    pg_catalog.pg_namespace AS table_namespace
    ON c.relnamespace = table_namespace.oid
LEFT JOIN
    pg_catalog.pg_inherits AS table_inherits
    ON c.oid = table_inherits.inhrelid
LEFT JOIN
    pg_catalog.pg_class AS parent_c
    ON table_inherits.inhparent = parent_c.oid
LEFT JOIN
    pg_catalog.pg_namespace AS parent_namespace
    ON parent_c.relnamespace = parent_namespace.oid
WHERE
    table_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND table_namespace.nspname !~ '^pg_toast'
    AND table_namespace.nspname !~ '^pg_temp'
    AND (c.relkind = 'r' OR c.relkind = 'p')
    AND NOT EXISTS (
        SELECT depend.objid
        FROM pg_catalog.pg_depend AS depend
        WHERE
            depend.classid = 'pg_class'::REGCLASS
            AND depend.objid = c.oid
            AND depend.deptype = 'e'
    );
`;

export const getColumnsForTableSql = `
WITH identity_col_seq AS (
    SELECT
        depend.refobjid AS owner_relid,
        depend.refobjsubid AS owner_attnum,
        pg_seq.seqstart,
        pg_seq.seqincrement,
        pg_seq.seqmax,
        pg_seq.seqmin,
        pg_seq.seqcache,
        pg_seq.seqcycle
    FROM pg_catalog.pg_sequence AS pg_seq
    INNER JOIN pg_catalog.pg_depend AS depend
        ON
            depend.classid = 'pg_class'::REGCLASS
            AND pg_seq.seqrelid = depend.objid
            AND depend.refclassid = 'pg_class'::REGCLASS
            AND depend.deptype = 'i'
    INNER JOIN pg_catalog.pg_attribute AS owner_attr
        ON
            depend.refobjid = owner_attr.attrelid
            AND depend.refobjsubid = owner_attr.attnum
    WHERE owner_attr.attidentity != ''
)
SELECT
    a.attrelid::TEXT AS table_oid,
    a.attname::TEXT AS column_name,
    a.attnotnull AS is_not_null,
    a.atthasmissing AS has_missing_val_optimization,
    a.attlen::INT AS column_size,
    a.attidentity::TEXT AS identity_type,
    identity_col_seq.seqstart::TEXT AS start_value,
    identity_col_seq.seqincrement::TEXT AS increment_value,
    identity_col_seq.seqmax::TEXT AS max_value,
    identity_col_seq.seqmin::TEXT AS min_value,
    identity_col_seq.seqcache::TEXT AS cache_size,
    identity_col_seq.seqcycle AS is_cycle,
    COALESCE(coll.collname, '')::TEXT AS collation_name,
    COALESCE(collation_namespace.nspname, '')::TEXT AS collation_schema_name,
    COALESCE(
        CASE
            WHEN a.attgenerated = 's' THEN ''
            ELSE pg_catalog.pg_get_expr(d.adbin, d.adrelid)
        END, ''
    )::TEXT AS default_value,
    COALESCE(
        CASE
            WHEN a.attgenerated = 's'
                THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid)
            ELSE ''
        END, ''
    )::TEXT AS generation_expression,
    (a.attgenerated = 's') AS is_generated,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
    COALESCE(function_dependencies.schema_names, ARRAY[]::TEXT[]) AS dependent_func_schema_names,
    COALESCE(function_dependencies.func_names, ARRAY[]::TEXT[]) AS dependent_func_names,
    COALESCE(function_dependencies.identity_arguments, ARRAY[]::TEXT[]) AS dependent_func_identity_arguments
FROM pg_catalog.pg_attribute AS a
LEFT JOIN
    pg_catalog.pg_attrdef AS d
    ON (a.attrelid = d.adrelid AND a.attnum = d.adnum)
LEFT JOIN pg_catalog.pg_collation AS coll ON a.attcollation = coll.oid
LEFT JOIN
    pg_catalog.pg_namespace AS collation_namespace
    ON coll.collnamespace = collation_namespace.oid
LEFT JOIN
    identity_col_seq
    ON
        a.attrelid = identity_col_seq.owner_relid
        AND a.attnum = identity_col_seq.owner_attnum
LEFT JOIN LATERAL (
    SELECT
        ARRAY_AGG(proc_namespace.nspname::TEXT ORDER BY pg_proc.oid) AS schema_names,
        ARRAY_AGG(pg_proc.proname::TEXT ORDER BY pg_proc.oid) AS func_names,
        ARRAY_AGG(pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) ORDER BY pg_proc.oid) AS identity_arguments
    FROM pg_catalog.pg_depend AS depend
    INNER JOIN pg_catalog.pg_proc AS pg_proc
        ON depend.refclassid = 'pg_proc'::REGCLASS
        AND depend.refobjid = pg_proc.oid
    INNER JOIN pg_catalog.pg_namespace AS proc_namespace
        ON pg_proc.pronamespace = proc_namespace.oid
    WHERE
        depend.classid = 'pg_attrdef'::REGCLASS
        AND depend.objid = d.oid
        AND depend.deptype = 'n'
) AS function_dependencies ON TRUE
WHERE
    a.attrelid = $1::OID
    AND a.attnum > 0
    AND NOT a.attisdropped
ORDER BY a.attnum;
`;

export const getExtensionsSql = `
SELECT
    ext.oid::TEXT AS oid,
    ext.extname::TEXT AS extension_name,
    ext.extversion AS extension_version,
    extension_namespace.nspname::TEXT AS schema_name
FROM pg_catalog.pg_namespace AS extension_namespace
INNER JOIN
    pg_catalog.pg_extension AS ext
    ON extension_namespace.oid = ext.extnamespace
WHERE
    extension_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND extension_namespace.nspname !~ '^pg_toast'
    AND extension_namespace.nspname !~ '^pg_temp';
`;

export const getIndexesSql = `
SELECT
    c.oid::TEXT AS oid,
    c.relname::TEXT AS index_name,
    table_c.relname::TEXT AS table_name,
    table_namespace.nspname::TEXT AS table_schema_name,
    table_c.relkind::TEXT AS owning_table_relkind,
    pg_catalog.pg_get_indexdef(c.oid)::TEXT AS def_stmt,
    COALESCE(con.conname, '')::TEXT AS constraint_name,
    COALESCE(con.contype, '')::TEXT AS constraint_type,
    COALESCE(pg_catalog.pg_get_constraintdef(con.oid), '')::TEXT AS constraint_def,
    i.indisvalid AS index_is_valid,
    i.indisprimary AS index_is_pk,
    i.indisunique AS index_is_unique,
    COALESCE(parent_c.relname, '')::TEXT AS parent_index_name,
    COALESCE(parent_namespace.nspname, '')::TEXT AS parent_index_schema_name,
    (
        SELECT ARRAY_AGG(att.attname ORDER BY indkey_ord.ord)
        FROM UNNEST(i.indkey) WITH ORDINALITY AS indkey_ord (attnum, ord)
        INNER JOIN pg_catalog.pg_attribute AS att
            ON att.attrelid = table_c.oid AND indkey_ord.attnum = att.attnum
    )::TEXT [] AS column_names,
    COALESCE(con.conislocal, false) AS constraint_is_local
FROM pg_catalog.pg_class AS c
INNER JOIN pg_catalog.pg_index AS i ON (c.oid = i.indexrelid)
INNER JOIN pg_catalog.pg_class AS table_c ON (i.indrelid = table_c.oid)
INNER JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_c.relnamespace = table_namespace.oid
LEFT JOIN
    pg_catalog.pg_constraint AS con
    ON (c.oid = con.conindid AND con.contype IN ('p', 'u', null))
LEFT JOIN
    pg_catalog.pg_inherits AS idx_inherits
    ON (c.oid = idx_inherits.inhrelid)
LEFT JOIN
    pg_catalog.pg_class AS parent_c
    ON (idx_inherits.inhparent = parent_c.oid)
LEFT JOIN
    pg_catalog.pg_namespace AS parent_namespace
    ON parent_c.relnamespace = parent_namespace.oid
WHERE
    table_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND table_namespace.nspname !~ '^pg_toast'
    AND table_namespace.nspname !~ '^pg_temp'
    AND (c.relkind = 'i' OR c.relkind = 'I')
    AND NOT EXISTS (
        SELECT depend.objid
        FROM pg_catalog.pg_depend AS depend
        WHERE
            depend.classid = 'pg_class'::REGCLASS
            AND depend.objid = table_c.oid
            AND depend.deptype = 'e'
    );
`;

export const getCheckConstraintsSql = `
SELECT
    pg_constraint.oid::TEXT AS oid,
    pg_constraint.conname::TEXT AS constraint_name,
    (
        SELECT ARRAY_AGG(a.attname)
        FROM UNNEST(pg_constraint.conkey) AS conkey
        INNER JOIN pg_catalog.pg_attribute AS a ON conkey = a.attnum
        WHERE
            a.attrelid = pg_constraint.conrelid
            AND a.attnum = ANY(pg_constraint.conkey)
            AND NOT a.attisdropped
    )::TEXT [] AS column_names,
    pg_class.relname::TEXT AS table_name,
    table_namespace.nspname::TEXT AS table_schema_name,
    pg_constraint.convalidated AS is_valid,
    pg_constraint.connoinherit AS is_not_inheritable,
    pg_catalog.pg_get_expr(pg_constraint.conbin, pg_constraint.conrelid) AS constraint_expression
FROM pg_catalog.pg_constraint
INNER JOIN pg_catalog.pg_class ON pg_constraint.conrelid = pg_class.oid
INNER JOIN pg_catalog.pg_namespace AS table_namespace
    ON pg_class.relnamespace = table_namespace.oid
WHERE
    table_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND table_namespace.nspname !~ '^pg_toast'
    AND table_namespace.nspname !~ '^pg_temp'
    AND pg_constraint.contype = 'c'
    AND pg_constraint.conislocal;
`;

export const getForeignKeyConstraintsSql = `
SELECT
    pg_constraint.conname::TEXT AS constraint_name,
    constraint_c.relname::TEXT AS owning_table_name,
    constraint_namespace.nspname::TEXT AS owning_table_schema_name,
    foreign_table_c.relname::TEXT AS foreign_table_name,
    foreign_table_namespace.nspname::TEXT AS foreign_table_schema_name,
    pg_constraint.convalidated AS is_valid,
    pg_catalog.pg_get_constraintdef(pg_constraint.oid) AS constraint_def
FROM pg_catalog.pg_constraint
INNER JOIN pg_catalog.pg_class AS constraint_c
    ON pg_constraint.conrelid = constraint_c.oid
INNER JOIN pg_catalog.pg_namespace AS constraint_namespace
    ON pg_constraint.connamespace = constraint_namespace.oid
INNER JOIN pg_catalog.pg_class AS foreign_table_c
    ON pg_constraint.confrelid = foreign_table_c.oid
INNER JOIN pg_catalog.pg_namespace AS foreign_table_namespace
    ON foreign_table_c.relnamespace = foreign_table_namespace.oid
WHERE
    constraint_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND constraint_namespace.nspname !~ '^pg_toast'
    AND constraint_namespace.nspname !~ '^pg_temp'
    AND pg_constraint.contype = 'f'
    AND pg_constraint.conislocal;
`;

export const getProcsSql = `
SELECT
    pg_proc.oid::TEXT AS oid,
    pg_proc.proname::TEXT AS func_name,
    proc_namespace.nspname::TEXT AS func_schema_name,
    proc_lang.lanname::TEXT AS func_lang,
    pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) AS func_identity_arguments,
    pg_catalog.pg_get_function_result(pg_proc.oid)::TEXT AS func_result,
    pg_catalog.pg_get_functiondef(pg_proc.oid) AS func_def
FROM pg_catalog.pg_proc
INNER JOIN pg_catalog.pg_namespace AS proc_namespace
    ON pg_proc.pronamespace = proc_namespace.oid
INNER JOIN pg_catalog.pg_language AS proc_lang
    ON pg_proc.prolang = proc_lang.oid
WHERE
    proc_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND proc_namespace.nspname !~ '^pg_toast'
    AND proc_namespace.nspname !~ '^pg_temp'
    AND pg_proc.prokind = $1
    AND NOT EXISTS (
        SELECT depend.objid
        FROM pg_catalog.pg_depend AS depend
        WHERE
            depend.classid = 'pg_proc'::REGCLASS
            AND depend.objid = pg_proc.oid
            AND depend.deptype = 'e'
    );
`;

export const getDependsOnFunctionsSql = `
SELECT
    CASE
        WHEN depend.classid = 'pg_constraint'::REGCLASS THEN 'pg_constraint'
        ELSE 'pg_proc'
    END AS dependent_class,
    depend.objid::TEXT AS dependent_oid,
    pg_proc.proname::TEXT AS func_name,
    proc_namespace.nspname::TEXT AS func_schema_name,
    pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) AS func_identity_arguments
FROM pg_catalog.pg_depend AS depend
INNER JOIN pg_catalog.pg_proc AS pg_proc
    ON
        depend.refclassid = 'pg_proc'::REGCLASS
        AND depend.refobjid = pg_proc.oid
INNER JOIN pg_catalog.pg_namespace AS proc_namespace
    ON pg_proc.pronamespace = proc_namespace.oid
WHERE
    depend.classid = $1::REGCLASS
    AND depend.objid = $2::OID
    AND depend.deptype = 'n';
`;

export const getTriggersSql = `
SELECT
    trig.tgname::TEXT AS trigger_name,
    owning_c.relname::TEXT AS owning_table_name,
    owning_c_namespace.nspname::TEXT AS owning_table_schema_name,
    pg_proc.proname::TEXT AS func_name,
    proc_namespace.nspname::TEXT AS func_schema_name,
    pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) AS func_identity_arguments,
    pg_catalog.pg_get_triggerdef(trig.oid) AS trigger_def,
    trig.tgconstraint != 0 AS is_constraint
FROM pg_catalog.pg_trigger AS trig
INNER JOIN pg_catalog.pg_class AS owning_c ON trig.tgrelid = owning_c.oid
INNER JOIN pg_catalog.pg_namespace AS owning_c_namespace
    ON owning_c.relnamespace = owning_c_namespace.oid
INNER JOIN pg_catalog.pg_proc AS pg_proc ON trig.tgfoid = pg_proc.oid
INNER JOIN pg_catalog.pg_namespace AS proc_namespace
    ON pg_proc.pronamespace = proc_namespace.oid
WHERE
    owning_c_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND owning_c_namespace.nspname !~ '^pg_toast'
    AND owning_c_namespace.nspname !~ '^pg_temp'
    AND trig.tgparentid = 0
    AND NOT trig.tgisinternal;
`;

export const getSequencesSql = `
SELECT
    seq_c.relname::TEXT AS sequence_name,
    seq_ns.nspname::TEXT AS sequence_schema_name,
    COALESCE(owner_attr.attname, '')::TEXT AS owner_column_name,
    COALESCE(owner_ns.nspname, '')::TEXT AS owner_schema_name,
    COALESCE(owner_c.relname, '')::TEXT AS owner_table_name,
    pg_seq.seqstart::TEXT AS start_value,
    pg_seq.seqincrement::TEXT AS increment_value,
    pg_seq.seqmax::TEXT AS max_value,
    pg_seq.seqmin::TEXT AS min_value,
    pg_seq.seqcache::TEXT AS cache_size,
    pg_seq.seqcycle AS is_cycle,
    FORMAT_TYPE(pg_seq.seqtypid, null) AS data_type
FROM pg_catalog.pg_sequence AS pg_seq
INNER JOIN pg_catalog.pg_class AS seq_c ON pg_seq.seqrelid = seq_c.oid
INNER JOIN pg_catalog.pg_namespace AS seq_ns ON seq_c.relnamespace = seq_ns.oid
LEFT JOIN pg_catalog.pg_depend AS depend
    ON
        depend.classid = 'pg_class'::REGCLASS
        AND pg_seq.seqrelid = depend.objid
        AND depend.refclassid = 'pg_class'::REGCLASS
        AND depend.deptype IN ('a', 'i')
LEFT JOIN pg_catalog.pg_attribute AS owner_attr
    ON
        depend.refobjid = owner_attr.attrelid
        AND depend.refobjsubid = owner_attr.attnum
LEFT JOIN pg_catalog.pg_class AS owner_c ON depend.refobjid = owner_c.oid
LEFT JOIN pg_catalog.pg_namespace AS owner_ns
    ON owner_c.relnamespace = owner_ns.oid
WHERE
    seq_ns.nspname NOT IN ('pg_catalog', 'information_schema')
    AND seq_ns.nspname !~ '^pg_toast'
    AND seq_ns.nspname !~ '^pg_temp'
    AND (depend.deptype IS null OR depend.deptype != 'i')
    AND NOT EXISTS (
        SELECT ext_depend.objid
        FROM pg_catalog.pg_depend AS ext_depend
        WHERE
            ext_depend.classid = 'pg_class'::REGCLASS
            AND ext_depend.objid = pg_seq.seqrelid
            AND ext_depend.deptype = 'e'
    );
`;

export const getPoliciesSql = `
WITH roles AS (
    SELECT oid, rolname
    FROM pg_catalog.pg_roles
    UNION
    SELECT 0 AS oid, 'PUBLIC' AS rolname
)
SELECT
    pol.oid::TEXT AS oid,
    pol.polname::TEXT AS policy_name,
    table_c.relname::TEXT AS owning_table_name,
    table_namespace.nspname::TEXT AS owning_table_schema_name,
    pol.polpermissive AS is_permissive,
    (
        SELECT ARRAY_AGG(roles.rolname)
        FROM roles
        WHERE roles.oid = ANY(pol.polroles)
    )::TEXT [] AS applies_to,
    pol.polcmd::TEXT AS cmd,
    COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')::TEXT AS check_expression,
    COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '')::TEXT AS using_expression,
    (
        SELECT ARRAY_AGG(a.attname)
        FROM pg_catalog.pg_attribute AS a
        INNER JOIN pg_catalog.pg_depend AS d ON a.attnum = d.refobjsubid
        WHERE
            d.objid = pol.oid
            AND d.refobjid = table_c.oid
            AND d.refclassid = 'pg_class'::REGCLASS
            AND a.attrelid = table_c.oid
            AND NOT a.attisdropped
    )::TEXT [] AS column_names,
    COALESCE(function_dependencies.schema_names, ARRAY[]::TEXT[]) AS dependent_func_schema_names,
    COALESCE(function_dependencies.func_names, ARRAY[]::TEXT[]) AS dependent_func_names,
    COALESCE(function_dependencies.identity_arguments, ARRAY[]::TEXT[]) AS dependent_func_identity_arguments
FROM pg_catalog.pg_policy AS pol
INNER JOIN pg_catalog.pg_class AS table_c ON pol.polrelid = table_c.oid
INNER JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_c.relnamespace = table_namespace.oid
LEFT JOIN LATERAL (
    SELECT
        ARRAY_AGG(proc_namespace.nspname::TEXT ORDER BY pg_proc.oid) AS schema_names,
        ARRAY_AGG(pg_proc.proname::TEXT ORDER BY pg_proc.oid) AS func_names,
        ARRAY_AGG(pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) ORDER BY pg_proc.oid) AS identity_arguments
    FROM pg_catalog.pg_depend AS depend
    INNER JOIN pg_catalog.pg_proc AS pg_proc
        ON depend.refclassid = 'pg_proc'::REGCLASS
        AND depend.refobjid = pg_proc.oid
    INNER JOIN pg_catalog.pg_namespace AS proc_namespace
        ON pg_proc.pronamespace = proc_namespace.oid
    WHERE
        depend.classid = 'pg_policy'::REGCLASS
        AND depend.objid = pol.oid
        AND depend.deptype = 'n'
) AS function_dependencies ON TRUE
WHERE
    table_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND table_namespace.nspname !~ '^pg_toast'
    AND table_namespace.nspname !~ '^pg_temp';
`;

export const getViewsSql = `
SELECT
    n.nspname::TEXT AS schema_name,
    c.relname::TEXT AS view_name,
    c.reloptions::TEXT [] AS rel_options,
    (SELECT ARRAY_AGG(JSONB_BUILD_OBJECT(
        'name', a.attname,
        'type', PG_CATALOG.FORMAT_TYPE(a.atttypid, a.atttypmod)
    ) ORDER BY a.attnum)
    FROM pg_catalog.pg_attribute AS a
    WHERE
        a.attrelid = c.oid
        AND a.attnum > 0
        AND NOT a.attisdropped)::TEXT [] AS output_columns,
    (SELECT ARRAY_AGG(DISTINCT JSONB_BUILD_OBJECT(
        'schema', dep_ns.nspname,
        'name', dep_c.relname,
        'columns', (
            SELECT ARRAY_AGG(a.attname::TEXT ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute AS a
            WHERE
                a.attrelid = dep_c.oid
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND a.attnum IN (
                    SELECT DISTINCT d3.refobjsubid
                    FROM pg_catalog.pg_depend AS d3
                    WHERE
                        d3.refobjid = dep_c.oid
                        AND d3.refobjsubid > 0
                        AND d3.classid = 'pg_rewrite'::REGCLASS
                        AND EXISTS (
                            SELECT 1
                            FROM pg_catalog.pg_rewrite AS rw
                            WHERE rw.oid = d3.objid AND rw.ev_class = c.oid
                        )
                )
        )
    ))
    FROM pg_catalog.pg_depend AS d
    INNER JOIN pg_catalog.pg_rewrite AS r ON d.objid = r.oid
    INNER JOIN pg_catalog.pg_depend AS d2 ON r.oid = d2.objid
    INNER JOIN pg_catalog.pg_class AS dep_c
        ON d2.refobjid = dep_c.oid AND dep_c.relkind IN ('r', 'p', 'v', 'm')
    INNER JOIN pg_catalog.pg_namespace AS dep_ns
        ON dep_c.relnamespace = dep_ns.oid
    WHERE
        d.refobjid = c.oid
        AND r.ev_class = c.oid
        AND dep_c.oid != c.oid)::TEXT [] AS table_dependencies,
    PG_GET_VIEWDEF(c.oid, true) AS view_definition
FROM pg_catalog.pg_class AS c
INNER JOIN pg_catalog.pg_namespace AS n ON c.relnamespace = n.oid
WHERE
    c.relkind = 'v'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'
    AND NOT EXISTS (
        SELECT depend.objid
        FROM pg_catalog.pg_depend AS depend
        WHERE
            depend.classid = 'pg_class'::REGCLASS
            AND depend.objid = c.oid
            AND depend.deptype = 'e'
    );
`;

export const getMaterializedViewsSql = `
SELECT
    n.nspname::TEXT AS schema_name,
    c.relname::TEXT AS view_name,
    c.reloptions::TEXT [] AS rel_options,
    COALESCE(ts.spcname, '')::TEXT AS tablespace_name,
    (SELECT ARRAY_AGG(JSONB_BUILD_OBJECT(
        'name', a.attname,
        'type', PG_CATALOG.FORMAT_TYPE(a.atttypid, a.atttypmod)
    ) ORDER BY a.attnum)
    FROM pg_catalog.pg_attribute AS a
    WHERE
        a.attrelid = c.oid
        AND a.attnum > 0
        AND NOT a.attisdropped)::TEXT [] AS output_columns,
    (SELECT ARRAY_AGG(DISTINCT JSONB_BUILD_OBJECT(
        'schema', dep_ns.nspname,
        'name', dep_c.relname,
        'columns', (
            SELECT ARRAY_AGG(a.attname::TEXT ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute AS a
            WHERE
                a.attrelid = dep_c.oid
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND a.attnum IN (
                    SELECT DISTINCT d3.refobjsubid
                    FROM pg_catalog.pg_depend AS d3
                    WHERE
                        d3.refobjid = dep_c.oid
                        AND d3.refobjsubid > 0
                        AND d3.classid = 'pg_rewrite'::REGCLASS
                        AND EXISTS (
                            SELECT 1
                            FROM pg_catalog.pg_rewrite AS rw
                            WHERE rw.oid = d3.objid AND rw.ev_class = c.oid
                        )
                )
        )
    ))
    FROM pg_catalog.pg_depend AS d
    INNER JOIN pg_catalog.pg_rewrite AS r ON d.objid = r.oid
    INNER JOIN pg_catalog.pg_depend AS d2 ON r.oid = d2.objid
    INNER JOIN pg_catalog.pg_class AS dep_c
        ON d2.refobjid = dep_c.oid AND dep_c.relkind IN ('r', 'p', 'v', 'm')
    INNER JOIN pg_catalog.pg_namespace AS dep_ns
        ON dep_c.relnamespace = dep_ns.oid
    WHERE
        d.refobjid = c.oid
        AND r.ev_class = c.oid
        AND dep_c.oid != c.oid)::TEXT [] AS table_dependencies,
    PG_GET_VIEWDEF(c.oid, true) AS view_definition
FROM pg_catalog.pg_class AS c
INNER JOIN pg_catalog.pg_namespace AS n ON c.relnamespace = n.oid
LEFT JOIN pg_catalog.pg_tablespace AS ts ON c.reltablespace = ts.oid
WHERE
    c.relkind = 'm'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'
    AND NOT EXISTS (
        SELECT depend.objid
        FROM pg_catalog.pg_depend AS depend
        WHERE
            depend.classid = 'pg_class'::REGCLASS
            AND depend.objid = c.oid
            AND depend.deptype = 'e'
    );
`;

export const getTablePrivilegesSql = `
WITH parsed_acl AS (
    SELECT
        c.oid AS table_oid,
        c.relname AS table_name,
        n.nspname AS table_schema_name,
        c.relowner AS owner_oid,
        (ACLEXPLODE(c.relacl)).grantee AS grantee_oid,
        (ACLEXPLODE(c.relacl)).privilege_type AS privilege_type,
        (ACLEXPLODE(c.relacl)).is_grantable AS is_grantable
    FROM pg_catalog.pg_class AS c
    INNER JOIN pg_catalog.pg_namespace AS n ON c.relnamespace = n.oid
    WHERE
        n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast'
        AND n.nspname !~ '^pg_temp'
        AND (c.relkind = 'r' OR c.relkind = 'p')
        AND c.relacl IS NOT null
        AND NOT EXISTS (
            SELECT depend.objid
            FROM pg_catalog.pg_depend AS depend
            WHERE
                depend.classid = 'pg_class'::REGCLASS
                AND depend.objid = c.oid
                AND depend.deptype = 'e'
        )
)
SELECT
    pa.table_name::TEXT,
    pa.table_schema_name::TEXT,
    COALESCE(grantee_role.rolname, '')::TEXT AS grantee,
    pa.privilege_type::TEXT AS privilege,
    pa.is_grantable
FROM parsed_acl AS pa
LEFT JOIN pg_catalog.pg_roles AS grantee_role
    ON pa.grantee_oid = grantee_role.oid
WHERE pa.grantee_oid != pa.owner_oid OR pa.grantee_oid = 0
ORDER BY pa.table_schema_name, pa.table_name, grantee, pa.privilege_type;
`;
