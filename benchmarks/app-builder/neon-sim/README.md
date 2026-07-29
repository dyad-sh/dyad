# neon-sim — offline Neon stand-in for the app-builder benchmark

A local substitute for Neon (control plane + data plane + Neon Auth) built from
the validated S-AUTH and S-SQL spikes. Smoke-verified end-to-end with the REAL
`@neondatabase/api-client` and `@neondatabase/serverless` packages: **17/17
assertions, idempotent across `/__sim/reset`** (`smoke-test.mjs`).

## Start / stop

```bash
node server.mjs                 # foreground; Ctrl-C to stop
# verify: curl http://127.0.0.1:7788/healthz
NODE_EXTRA_CA_CERTS=certs/ca.pem node smoke-test.mjs
```

Requires the shared Homebrew Postgres on `localhost:5432` (never stopped or
managed by neon-sim). Creates role `simuser` (LOGIN/CREATEDB) on first start.

## Port map

| Port | What                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7788 | Neon v2 control-plane shim (`/api/v2/*`), better-auth mounts (`/authsvc/<pid>/<bid>/*`), ops (`/__sim/*`), `/healthz`                                        |
| 443  | SQL proxy, TLS — the serverless driver's fetch path (it rewrites the URI host's first label to `api.` and always hits `https://…:443/sql`; URI port ignored) |
| 7790 | SQL proxy, plain HTTP (debug)                                                                                                                                |
| 5433 | pg-tls-front → 5432 — for TCP clients that hardcode `ssl:true` (ts-pg-schema-diff)                                                                           |

## Env contract for Dyad / benchmark / generated-app processes

```bash
DYAD_NEON_API_BASE_URL=http://127.0.0.1:7788/api/v2   # the P1 patch reads this
NODE_EXTRA_CA_CERTS=<neon-sim>/certs/ca.pem            # every node process touching SQL
```

Connection URIs issued by the shim look like
`postgresql://simuser:simpass@db.localtest.me:5433/<db>?sslmode=require` — one
URI serves both consumers: the serverless fetch path ignores the port and
resolves `api.localtest.me` → loopback (public DNS; airgapped runs need
/etc/hosts), TCP clients honor `:5433`. Seed Dyad's `settings.neon` tokens with
a far-future `expiresIn` so the oauth.dyad.sh refresh path is never hit; the
shim accepts any Bearer token. `E2E_TEST_BUILD` must be **unset** or Dyad
short-circuits to its in-process mock and never reaches the shim.

## Endpoint surface (mirrors Dyad's E2E mock exactly)

`GET|POST /projects`, `GET|DELETE /projects/{pid}`,
`GET /projects/{pid}/connection_uri`, `GET|POST /projects/{pid}/branches`,
`GET|DELETE /projects/{pid}/branches/{bid}`, branch `databases` / `roles`,
`GET|POST …/auth` (GET 404s until POST, matching `ensureNeonAuth`'s probe),
`GET|POST …/auth/domains`, `GET|PATCH …/auth/email_and_password`
(`require_email_verification:false` — keeps Dyad's prompt on the no-OTP path),
`GET /users/me/organizations`.

Branch model: branch = Postgres database `sim_<proj>_<branch>_<hex>`, owner
`simuser`; child branches are `CREATE DATABASE … TEMPLATE parent` copies
(connections terminated first). Dyad's main→development→preview creation order
means dev/preview inherit main's `neon_auth` schema, matching real Neon's
inheritance (the 409 path in `neon_utils.ts` never fires because our POST
…/auth is idempotent-success instead).

## Neon Auth stand-in

Per-(project,branch) **better-auth 1.4.18** instance (the exact version
`@neondatabase/auth` pins), lazily mounted at
`/authsvc/<pid>/<bid>`, tables in the **`neon_auth` schema of that branch's own
database** (pool `options=-csearch_path=neon_auth`), config per the S-AUTH
spike: `cookiePrefix "neon-auth"`, `useSecureCookies:true`, email/password on,
verification off, any localhost origin trusted. **Naming decision:** managed
Neon Auth reports `schema_name: "neon_auth", table_name: "users"` (see Dyad's
mock) but better-auth's table is `"user"` — we add a view
`neon_auth.users AS SELECT * FROM neon_auth."user"` so both names work in
model-written SQL. Dyad's prompts/guides do not hardcode either name (only a
409 comment mentions the schema), so this is belt-and-braces.

## Ops endpoints

- `POST /__sim/snapshot {projectId, branchId, label}` — `CREATE DATABASE <label> TEMPLATE <branchdb>` (milestone checkpoint capture; label must match `^sim_[a-z0-9_]+$`)
- `POST /__sim/clone {snapshot, label}` — clone-per-scoring-attempt; returns a connection URI
- `POST /__sim/reset` — drops every `sim_*` database, closes pools, wipes registry
- `GET /__sim/state` — debug dump
- `ledger/<projectId>.jsonl` — diagnostic SQL ledger (every statement through the proxy)

## Known deviations from real Neon (disclose in benchmark reports)

1. Branches are full template copies, not copy-on-write; no compute/endpoint
   model (`endpoints` in createProjectBranch is accepted and ignored).
2. Multi-statement SQL with empty params is permissive (simple query protocol);
   real Neon's `/sql` behavior unverified offline — `STRICT_SINGLE_STATEMENT=1`
   flips it (see S-SQL README; verify once against free-tier Neon before phase 1).
3. `POST …/auth` on a branch that inherited the schema returns 201 (real Neon:
   409 then re-GET); Dyad's flow is satisfied either way.
4. Auth JWKS URL is a placeholder (`/jwks` not implemented); Dyad and the
   benchmark apps use cookie sessions, not JWT verification.
5. Connection URIs embed `sslmode=require` and a real password, but local
   Postgres trusts loopback; simuser's password is only meaningful through
   pg-tls-front/proxy paths.
