# S-SQL spike — serverless-driver ↔ SQL-proxy protocol fidelity

Ran 2026-07-28. **Overall verdict: CONFIRMED — every Dyad data-plane path works
against a hand-written proxy + local Postgres, with zero Dyad patch.**
14/14 assertions pass (10 protocol + 4 diff).

## Verdicts

| Question                                     | Verdict                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire protocol extractable & implementable    | **CONFIRMED**                 | `proxy.mjs` (~200 lines, node+pg) passes the real driver's tagged templates, `sql.query(text, params)`, batch `sql.transaction`, error mapping. Protocol notes in `proxy.mjs` header, extracted from vendored driver v1.0.1 (`index.mjs`); 1.1.0 identical (same fetchEndpoint builder, same `/^[^.]+\./ → api.` host rewrite).                                                                                                                                                 |
| Dyad's exact call shapes (`neon_context.ts`) | **CONFIRMED**                 | `test.mjs`: multi-statement `sql.query(q, [])` (dyad-execute-sql shape), verbatim `TABLE_NAMES_QUERY`, batch-with-rollback semantics of `executeNeonStatementsInTransaction` (batch is one POST wrapped in BEGIN/COMMIT by the proxy; failing statement rolls back all).                                                                                                                                                                                                        |
| Error shape Dyad depends on                  | **CONFIRMED**                 | HTTP 400 + JSON `{message, severity, code, detail, hint, position, …}` (16 fields, list in `proxy.mjs`) → driver's `NeonDbError` carries them (`code: 42P01`, `constraint: users_pkey` asserted). `neon_errors.ts` only reads `.message` — satisfied.                                                                                                                                                                                                                           |
| Type fidelity                                | **CONFIRMED**                 | Proxy returns **raw text rows in array mode** (`rowMode:'array'` + identity type parsers); driver re-parses client-side via `pg-types` from `dataTypeID`. int/bool/timestamptz/jsonb/null/numeric/int8 all round-trip exactly as with real Neon semantics (numeric & int8 stay strings).                                                                                                                                                                                        |
| Schema introspection (`getNeonTableSchema`)  | **CONFIRMED**                 | `buildSchemaSnapshotSql` + `getSchemaFromSnapshot` (ts-pg-schema-diff) work through the HTTP driver (`test-diff.mjs` ok 2).                                                                                                                                                                                                                                                                                                                                                     |
| ts-pg-schema-diff with hardcoded `ssl:true`  | **CONFIRMED with mitigation** | Fails against plain local Postgres (expected). Mitigation that needs **no Dyad patch**: `pg-tls-front.mjs` — a ~60-line TLS-terminating TCP front (answers Postgres `SSLRequest` with `S`, does the server TLS handshake with the spike cert, pipes plaintext to real Postgres). Dyad's verbatim `MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS` (`migration_utils.ts:25-32`) then produces a real 8-statement diff. Requires `NODE_EXTRA_CA_CERTS=certs/ca.pem` in the process env. |

## THE key design answer: connection URIs without `neonConfig`

Dyad never sets `neonConfig` (`neon_context.ts`), and neither do generated apps.
The driver builds its endpoint as
`"https://" + host.replace(/^[^.]+\./, "api.") + "/sql"` — **the URI's port is
ignored and the scheme is always https on 443**.

**CONFIRMED (test-no-config.mjs):** with URIs shaped
`postgresql://user:pass@db.localtest.me/<database>`:

- `db.localtest.me` → rewritten to `api.localtest.me`; both resolve to loopback
  via public DNS (no /etc/hosts edit needed, but DNS egress is required — a
  fully airgapped run needs /etc/hosts entries);
- macOS allows **unprivileged bind to 443** (verified, no sudo);
- with `NODE_EXTRA_CA_CERTS=certs/ca.pem`, the real driver reaches the proxy's
  TLS listener with **zero configuration** — valid for Dyad's own SQL execution
  _and_ generated apps' runtime.

So the neon-sim design is: shim returns `db.localtest.me` URIs; sim runs one
TLS listener on :443 (HTTP-SQL) and one on :5433 (pg-tls-front for the diff
path — put :5433 in the URIs so `pg` clients hit it; the fetch path ignores the
port anyway, so ONE URI serves both consumers); every Dyad/benchmark/app
process gets `NODE_EXTRA_CA_CERTS`. `neonConfig.fetchEndpoint` patching is NOT
needed (drop that from the design's P-list if present).

## One fidelity caveat (not resolvable offline)

Real Neon's `/sql` behavior for **multi-statement queries with empty params**
could not be verified without a cloud account. The proxy defaults to permissive
(simple query protocol → multi-statement works; last result returned;
`STRICT_SINGLE_STATEMENT=1` flips it). Dyad's agent tool passes tool SQL
verbatim (`execute_sql.ts:204` → `sql.query(query, [])`), and models routinely
emit multi-statement DDL, so this choice is load-bearing for milestone success
rates. **Recommend one live check against a free Neon project before phase 1**;
if real Neon rejects multi-statement, set `STRICT_SINGLE_STATEMENT=1`.

## Files & re-run

- `proxy.mjs` — HTTP(S) SQL proxy (`PROXY_HTTP_PORT=7790`, opt `PROXY_HTTPS_PORT=443`)
- `pg-tls-front.mjs` — TLS front for TCP pg clients (`:5433 → :5432`)
- `certs/` — spike CA + server cert (SANs: localhost, \*.localtest.me, 127.0.0.1)
- `test.mjs` / `test-no-config.mjs` / `test-diff.mjs`

```bash
createdb spike_ssql                                   # once
PROXY_HTTPS_PORT=443 node proxy.mjs &                 # sql proxy
node pg-tls-front.mjs &                               # diff-path TLS front
node test.mjs                                         # 10 protocol tests
NODE_EXTRA_CA_CERTS=certs/ca.pem node test-no-config.mjs
NODE_EXTRA_CA_CERTS=certs/ca.pem npx tsx test-diff.mjs  # tsx: pkg imports .js→.ts
```
