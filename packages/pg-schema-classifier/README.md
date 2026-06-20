# pg-schema-classifier

Conservative static classifier for PostgreSQL SQL strings.

```ts
import { detectSqlSchemaMutation } from "pg-schema-classifier";

const analysis = detectSqlSchemaMutation("CREATE TABLE users (id bigint)");
console.log(analysis.mutatesSchema); // true
```

This package uses SQL text heuristics. It detects direct schema/catalog/authz
statements and intentionally over-classifies malformed SQL and dynamic execution
forms. It does not prove that arbitrary runtime code called by `SELECT`, DML, or
procedures cannot mutate schema.

As a partial mitigation, it also flags a curated allowlist of extension functions
that issue DDL from inside their bodies (PostGIS `AddGeometryColumn`, TimescaleDB
`create_hypertable`, Citus `create_distributed_table`, pg_partman `create_parent`,
pg_cron `cron.schedule`, `dblink_exec`, and similar) — see `SCHEMA_FUNCTIONS` in
`src/index.ts`. This list is necessarily incomplete: a `SELECT my_fn()` whose body
runs DDL but isn't on the list will not be flagged.
