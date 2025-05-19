// Schema query based on https://github.com/jjleng/code-panda/blob/61f1fa514c647de1a8d2ad7f85102d49c6db2086/cp-agent/cp_agent/utils/supabase_utils.py#L521
// which is Apache 2.0 licensed and copyrighted to Jijun Leng
// https://github.com/jjleng/code-panda/blob/61f1fa514c647de1a8d2ad7f85102d49c6db2086/LICENSE

export const SUPABASE_SCHEMA_QUERY = `
          WITH table_info AS (
            SELECT
                tables.table_name,
                pd.description as table_description
            FROM information_schema.tables tables
            LEFT JOIN pg_stat_user_tables psut ON tables.table_name = psut.relname
            LEFT JOIN pg_description pd ON psut.relid = pd.objoid AND pd.objsubid = 0
            WHERE tables.table_schema = 'public'
        ),
        column_info AS (
            SELECT
                c.table_name,
                jsonb_agg(
                    jsonb_build_object(
                        'column_name', c.column_name,
                        'data_type', c.data_type,
                        'is_nullable', c.is_nullable,
                        'column_default', c.column_default
                    ) ORDER BY c.ordinal_position
                ) as columns
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
            GROUP BY c.table_name
        ),
        tables_result AS (
            SELECT
                'tables' as result_type,
                jsonb_build_object(
                    'name', ti.table_name::text,
                    'description', ti.table_description::text,
                    'columns', COALESCE(ci.columns, '[]'::jsonb)
                )::text as data
            FROM table_info ti
            LEFT JOIN column_info ci ON ti.table_name = ci.table_name
        ),
        policies_result AS (
            SELECT
                'policies' as result_type,
                jsonb_build_object(
                    'name', pol.polname::text,
                    'table', cls.relname::text,
                    'command', CASE
                        WHEN pol.polcmd = 'r' THEN 'SELECT'
                        WHEN pol.polcmd = 'w' THEN 'UPDATE'
                        WHEN pol.polcmd = 'a' THEN 'INSERT'
                        WHEN pol.polcmd = 'd' THEN 'DELETE'
                        ELSE pol.polcmd::text
                    END,
                    'permissive', pol.polpermissive,
                    'definition', pg_get_expr(pol.polqual, pol.polrelid)::text
                )::text as data
            FROM pg_policy pol
            JOIN pg_class cls ON pol.polrelid = cls.oid
            WHERE cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        ),
        functions_result AS (
            SELECT
                'functions' as result_type,
                jsonb_build_object(
                    'name', p.proname::text,
                    'description', d.description::text,
                    'arguments', pg_get_function_arguments(p.oid)::text,
                    'return_type', pg_get_function_result(p.oid)::text,
                    'language', l.lanname::text,
                    'volatility', CASE p.provolatile
                        WHEN 'i' THEN 'IMMUTABLE'
                        WHEN 's' THEN 'STABLE'
                        WHEN 'v' THEN 'VOLATILE'
                    END,
                    'source_code', pg_get_functiondef(p.oid)::text
                )::text as data
            FROM pg_proc p
            LEFT JOIN pg_description d ON p.oid = d.objoid
            LEFT JOIN pg_language l ON p.prolang = l.oid
            WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') AND p.prokind = 'f' -- 'f' = normal function (otherwise source code fetch fails)
        ),
        triggers_result AS (
            SELECT
                'triggers' as result_type,
                jsonb_build_object(
                    'name', t.trigger_name::text,
                    'table', t.event_object_table::text,
                    'timing', t.action_timing::text,
                    'event', t.event_manipulation::text,
                    'action_statement', t.action_statement::text,
                    'function_name', p.proname::text
                )::text as data
            FROM information_schema.triggers t
            LEFT JOIN pg_trigger pg_t ON t.trigger_name = pg_t.tgname
            LEFT JOIN pg_proc p ON pg_t.tgfoid = p.oid
            WHERE t.trigger_schema = 'public'
        )
        SELECT result_type, data
        FROM (
            SELECT * FROM tables_result
            UNION ALL SELECT * FROM policies_result
            UNION ALL SELECT * FROM functions_result
            UNION ALL SELECT * FROM triggers_result
        ) combined_results
        ORDER BY result_type;

`;
