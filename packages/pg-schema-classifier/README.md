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
