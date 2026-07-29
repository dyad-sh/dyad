## The offline Neon stand-in (neon-sim)

### 0. What Dyad actually needs from "Neon" (ground truth)

Three independent planes, all of which the benchmark must satisfy without touching neon.tech:

1. **Control plane** — `@neondatabase/api-client` (`^2.7.1`, package.json:83) created in exactly one place: `getNeonClient()` at `src/neon_admin/neon_management_client.ts:388-395`. Default base URL is `https://console.neon.tech/api/v2` baked into the generated client (`node_modules/@neondatabase/api-client/dist/api.gen.js:341`), overridable because `createApiClient(config)` spreads an Axios `ApiConfig` (`dist/index.d.ts`), so `baseURL` passes straight through.
2. **Data plane (HTTP-SQL)** — `@neondatabase/serverless` `^1.0.1` (package.json:84) used by Dyad itself for `dyad-execute-sql`, schema introspection, and transactional migration apply (`src/neon_admin/neon_context.ts:147-230, 331-385`), and by the _generated app_ per the system prompt's client template (`src/neon_admin/neon_context.ts:398-407`). Critical, verified driver behavior in v1.x: the default `fetchEndpoint` **replaces the first DNS label of the connection-string host with `api.`** (`neonConfig` defaults in `node_modules/@neondatabase/serverless/index.mjs`: `fetchEndpoint: (host) => "https://" + host.replace(/^[^.]+\./, "api.") + "/sql"`; `apiauth.` when a JWT is supplied). The docs' older `https://<host>/sql` form still exists in the wild, so the sim must answer on **both** hostname shapes. The driver POSTs JSON `{query, params}` (single) or `{queries:[...]}` (transaction) with headers `Neon-Connection-String` (the full URI — this is our routing key), `Neon-Raw-Text-Output: true`, `Neon-Array-Mode: true`, and optional `Neon-Batch-Isolation-Level` / `Neon-Batch-Read-Only` / `Neon-Batch-Deferrable`; errors must be HTTP 400 with a JSON body carrying pg error fields (`message`, `code`, `severity`, `detail`, `hint`, `position`, …) — non-400 bodies are surfaced as opaque text.
3. **TCP Postgres with TLS** — `ts-pg-schema-diff` diffs dev→prod over plain `pg.Pool` with a **hard-coded `ssl: true`** (`src/ipc/utils/migration_utils.ts:25-32`, pool built in `node_modules/ts-pg-schema-diff/src/db/connect.ts:31-51`), i.e. verified TLS against the connection-string host.
4. **Neon Auth** — `NEON_AUTH_BASE_URL` is handed to the generated app; the Next.js SDK (`createNeonAuth` from `@neondatabase/auth/next/server`, guide at `src/prompts/guides/add-authentication.md:64-79`) proxies `/api/auth/*` to that base URL speaking the **Better Auth wire protocol** (the vite-nitro guide fetches `${NEON_AUTH_BASE_URL}/get-session` directly, `add-authentication.md:273-282`; Neon Auth is "managed Better Auth", session cookie `__Secure-neon-auth.session_token`, `add-authentication.md:203`).

One more hard constraint: `E2E_TEST_BUILD` must be **UNSET in every benchmark process** (`src/ipc/utils/test_utils.ts:1`) — otherwise `getNeonClient()` short-circuits into Dyad's in-process Neon mock (check at `neon_management_client.ts:112-113`, mock body :113-359) and nothing real is exercised. The v2 shim below only **mirrors** that mock's endpoint surface as its contract reference; it never relies on the mock being active.

### 1. Topology, naming, and TLS decision

**Hostnames** (one-time sudo, deterministic, offline):

```
# /etc/hosts
127.0.0.1 db.neon-sim.test api.neon-sim.test apiauth.neon-sim.test auth.neon-sim.test
```

We deliberately do NOT use `*.neon.tech` fake hostnames (no risk of leaking to real Neon if /etc/hosts is missing). Known, accepted infidelity: `removeNeonEnvVars` only strips `DATABASE_URL`/`POSTGRES_URL` when the value contains `.neon.tech` (`src/ipc/utils/app_env_var_utils.ts:289-297`) — the unlink flow is not exercised by the benchmark.

**TLS strategy: mkcert local CA + `NODE_EXTRA_CA_CERTS`. Chosen over http + `neonConfig.fetchEndpoint` injection.** Justification:

- The generated app calls `neon(process.env.DATABASE_URL)` inside the Next.js server process. We cannot set `neonConfig` there without modifying app code (forbidden) or a `NODE_OPTIONS --require` preload — which is unreliable because Next.js may bundle `@neondatabase/serverless` into its server build, so the preload's `require()` would configure a _different module instance_ than the bundled one.
- `ts-pg-schema-diff`'s `ssl: true` is a hard-coded const (`migration_utils.ts:26`); the http route would need a second Dyad patch there, plus a third for `neon_context.ts`. The mkcert route needs **zero** driver-side patches: every consumer is a Node process (vitest harness, Next.js dev server, benchmark runner), and `NODE_EXTRA_CA_CERTS` is honored by both `tls.connect` (pg) and undici `fetch` (serverless driver, SDK proxy).
- Port 443 binding is unprivileged on modern macOS (host is darwin, `/env`), and Docker publishes it regardless.

Setup: `mkcert -install` (also covers the Chromium used by the packaged-Electron parity smoke via the system keychain), then `mkcert db.neon-sim.test api.neon-sim.test apiauth.neon-sim.test auth.neon-sim.test` for the edge cert, and a separate `db.neon-sim.test` cert mounted into Postgres. The benchmark orchestrator exports `NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"` once; every child (harness, scored app, Playwright-launched requests through the app) inherits it. The same mkcert CA doubles as the trust root for the C8 TLS front-proxy fallback (§3) if spike S-AUTH falsifies secure cookies on plain `http://localhost`.

**Branch model: one Postgres 16 instance, branch = database.** Branch `br-x` maps to physical database `neondb_<branchkey>`. Branch creation = `CREATE DATABASE neondb_<child> TEMPLATE neondb_<parent>` after `pg_terminate_backend()` on the parent's sessions. Infidelity vs Neon's copy-on-write: the copy is O(data) not O(1), the template must be idle for an instant, and there is no PITR/history. Acceptable because (a) snapshot _semantics_ are identical — child sees parent's state at creation, then diverges, exactly what `neon_test_branch.ts:33-47` and the main→development→preview topology rely on; (b) benchmark databases are megabytes; (c) nothing in Dyad's call surface uses time-travel. The same `CREATE DATABASE ... TEMPLATE` primitive powers milestone checkpoint snapshots (§8).

### 2. docker-compose

```yaml
# benchmarks/app-builder/neon-sim/docker-compose.yml
services:
  postgres:
    image: postgres:16
    command: >
      postgres -c ssl=on
               -c ssl_cert_file=/certs/db.neon-sim.test.pem
               -c ssl_key_file=/certs/db.neon-sim.test-key.pem
    environment:
      POSTGRES_USER: neondb_owner # matches the role Dyad expects (neon_context.ts:51)
      POSTGRES_PASSWORD: npg_neonsim
      POSTGRES_DB: postgres # maintenance db; branch dbs minted by the shim
    ports: ["5432:5432"]
    volumes: ["./certs/db:/certs:ro"]

  console-api: # Neon v2 control-plane shim (node/hono, ~500 lines)
    build: ./console-api
    environment:
      { PGHOST: postgres, PGUSER: neondb_owner, PGPASSWORD: npg_neonsim }
    ports: ["8788:8788"] # plain http; reached via DYAD_NEON_API_BASE_URL, no TLS needed

  sql-proxy: # serverless-driver HTTP-SQL translator (node/hono + pg, ~150 lines)
    build: ./sql-proxy
    environment:
      { PGHOST: postgres, PGUSER: neondb_owner, PGPASSWORD: npg_neonsim }

  auth: # self-hosted better-auth standing in for Neon Auth
    build: ./auth
    environment:
      { PGHOST: postgres, PGUSER: neondb_owner, PGPASSWORD: npg_neonsim }

  edge: # TLS front door: Caddy with mkcert certs, routes by Host
    image: caddy:2
    ports: ["443:443"]
    volumes: ["./certs/edge:/certs:ro", "./Caddyfile:/etc/caddy/Caddyfile:ro"]
```

Every process that talks to the shim (harness, runner, spikes) runs with `DYAD_NEON_API_BASE_URL` set and `E2E_TEST_BUILD` unset — if `E2E_TEST_BUILD` is set anywhere, Dyad's in-process Neon mock short-circuits `getNeonClient()` (neon_management_client.ts:112-113) and this whole stack is bypassed.

```
# Caddyfile — one cert (SAN covers all four names), host-based routing
db.neon-sim.test, api.neon-sim.test, apiauth.neon-sim.test {
  tls /certs/edge.pem /certs/edge-key.pem
  reverse_proxy sql-proxy:8787
}
auth.neon-sim.test {
  tls /certs/edge.pem /certs/edge-key.pem
  reverse_proxy auth:8790
}
```

**HTTP-SQL proxy: write our own (~150 lines) instead of `ghcr.io/timowilhelm/local-neon-http-proxy`.** Evaluation: that image works but (a) it terminates TLS with Caddy's _internal_ CA on `db.localtest.me:4444`, which both requires internet DNS and requires `neonConfig.fetchEndpoint` port injection in every client — impossible in the generated app (see §1); (b) it gives us no hook for the v1-driver `api.`-label rewrite or for our branch=database routing; (c) the protocol we must speak is small and fully observable in `@neondatabase/serverless/index.mjs`. Translator behavior:

- `POST /sql`, single query: parse `Neon-Connection-String` header → database name → per-database `pg.Pool` (max 5, `idleTimeoutMillis: 5000` so branch creation can terminate sessions). Execute with `rowMode` **object** but **raw text values** (identity type parsers), reply `{ command, rowCount, fields: [{name, dataTypeID}], rows }`. `Neon-Array-Mode: true` is negotiated per-request by the driver but decoded client-side from this same full-results shape.
- Batch (`{queries:[...]}`): one client, `BEGIN` (honoring `Neon-Batch-Isolation-Level`/`Read-Only`), run sequentially, `COMMIT`, reply `{ results: [...] }`; any failure → `ROLLBACK` + HTTP 400. This is exactly what `executeNeonStatementsInTransaction` depends on (`neon_context.ts:185-230` — the unawaited-promises comment documents the batched POST).
- Errors: HTTP 400, JSON body copying pg's `message, code, severity, detail, hint, position, schema, table, column, dataType, constraint, ...` fields so `DyadError` messages built from them (`neon_context.ts:165-171`) look like Neon's.
- **SQL ledger (diagnostic only).** The proxy appends every statement it executes (timestamp, database, statement, params digest, outcome) to a per-run JSONL ledger. This ledger is retained strictly as a _diagnostic_ — debugging what a model's app actually executed, auditing probe traffic — and is **not** a schema- or data-reconstruction mechanism. Checkpoint state capture is the §8 snapshot mechanism; note also that no `migrations/*.sql` files exist in Dyad-built checkouts to replay (neon_prompt.ts forbids manual migration files), so ledger/migration replay is not a viable schema source even in principle.

### 3. v2 API shim — exact endpoint surface

Paths verified against the generated client (`@neondatabase/api-client/dist/api.gen.js`); the "Dyad reads" column is what the handlers actually destructure, i.e. the contract the shim must not break. The shim deliberately mirrors the endpoint surface of Dyad's in-process E2E mock (`neon_management_client.ts:113-359`) — the mock is our checked-in record of what Dyad's handlers expect — but the mock itself must never engage: `E2E_TEST_BUILD` stays unset in every benchmark process, else the mock short-circuits `getNeonClient()` (neon_management_client.ts:112-113) before `DYAD_NEON_API_BASE_URL` is ever consulted. Shim state (projects, branches, auth flags, `updated_at` stamps) lives in a `neon_sim.state` JSON table in the maintenance DB so it survives restarts (append-only-with-resume benchmark pattern).

| #   | Client call (Dyad call site)                                                                     | Method & path                                                                     | Shim behavior                                                                                                                                                                                                    | Response fields Dyad reads                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `createProject` (neon_handlers.ts:136)                                                           | POST `/projects`                                                                  | Mint project id `<slug>-<8hex>`; create branch `main` (default) + db `neondb_<key>`; record `updated_at`                                                                                                         | `project{id,name}`, `branch{id}`, `connection_uris[0].connection_uri` (neon_handlers.ts:145-157, 262)                                                  |
| 2   | `createProjectBranch` (neon_handlers.ts:182,218; neon_test_branch.ts:144)                        | POST `/projects/{pid}/branches`                                                   | Body `{branch:{name,parent_id}, endpoints:[{type:"read_write"}]}`; terminate parent-db sessions, `CREATE DATABASE ... TEMPLATE`; arbitrary names must work (`dyad-test-<appId>-<ts>` at neon_test_branch.ts:140) | `branch{id,name,parent_id,default,updated_at}`, non-empty `connection_uris` (hard-checked at neon_handlers.ts:192-196 and neon_test_branch.ts:155-168) |
| 3   | `getProject` (neon_handlers.ts:384)                                                              | GET `/projects/{pid}`                                                             | Lookup                                                                                                                                                                                                           | `project{id,name,org_id}` (org_id at neon_handlers.ts:449)                                                                                             |
| 4   | `listProjectBranches` (neon_handlers.ts:398,530; neon_utils.ts:333; neon_context.ts:279)         | GET `/projects/{pid}/branches`                                                    | List with topology                                                                                                                                                                                               | `branches[]{id,name,default,parent_id,updated_at}` — `default` drives `getProductionBranchId` (neon_utils.ts:342-350)                                  |
| 5   | `listProjects` (neon_handlers.ts:466)                                                            | GET `/projects?org_id=&limit=`                                                    | List                                                                                                                                                                                                             | `projects[]{id,name,region_id,created_at}`                                                                                                             |
| 6   | `getCurrentUserOrganizations` (neon_management_client.ts:409)                                    | GET `/users/me/organizations`                                                     | Static                                                                                                                                                                                                           | `organizations[0].id`                                                                                                                                  |
| 7   | `getProjectBranch` (neon_handlers.ts:739)                                                        | GET `/projects/{pid}/branches/{bid}`                                              | Lookup; 404 if unknown                                                                                                                                                                                           | `branch.project_id` equality check (neon_handlers.ts:743-748)                                                                                          |
| 8   | `deleteProjectBranch` (neon_test_branch.ts:281; version_handlers.ts:613)                         | DELETE `/projects/{pid}/branches/{bid}`                                           | Terminate sessions, `DROP DATABASE`; **404 if already gone** (treated as success, neon_test_branch.ts:290-295)                                                                                                   | `branch{id}`                                                                                                                                           |
| 9   | `deleteProject` (neon_handlers.ts:294)                                                           | DELETE `/projects/{pid}`                                                          | Drop all branch dbs + state; tear down the project's better-auth instance (pools closed, handlers unmounted — §8a lifecycle)                                                                                     | `project{id}`                                                                                                                                          |
| 10  | `getConnectionUri` (neon_context.ts:134)                                                         | GET `/projects/{pid}/connection_uri?branch_id=&database_name=&role_name=&pooled=` | Return `postgresql://neondb_owner:npg_neonsim@db.neon-sim.test/neondb_<branchkey>?sslmode=require`; ignore `pooled`                                                                                              | `uri`                                                                                                                                                  |
| 11  | `listProjectBranchRoles` (neon_context.ts:44)                                                    | GET `/projects/{pid}/branches/{bid}/roles`                                        | Static                                                                                                                                                                                                           | `roles:[{name:"neondb_owner",protected:false}]` (preference logic neon_context.ts:50-53)                                                               |
| 12  | `listProjectBranchDatabases` (neon_context.ts:89)                                                | GET `/projects/{pid}/branches/{bid}/databases`                                    | Static logical name                                                                                                                                                                                              | `databases:[{name:"neondb"}]`                                                                                                                          |
| 13  | `getNeonAuth` (neon_utils.ts:95,117)                                                             | GET `/projects/{pid}/branches/{bid}/auth`                                         | **404 until enabled**, then `{base_url: "https://auth.neon-sim.test/<branchkey>/neondb/auth", ...}`                                                                                                              | `base_url` only                                                                                                                                        |
| 14  | `createNeonAuth` (neon_utils.ts:104)                                                             | POST `/projects/{pid}/branches/{bid}/auth`                                        | Body `{auth_provider:"better_auth"}`; mark enabled, tell auth service to mount the branch; idempotent 200 (the 409-inherited path at neon_utils.ts:112-127 then never triggers)                                  | `base_url`                                                                                                                                             |
| 15  | `getNeonAuthEmailAndPasswordConfig` (neon_management_client.ts:479)                              | GET `.../auth/email_and_password`                                                 | Return enabled config, `require_email_verification:false` (mirrors mock :328-341)                                                                                                                                | whole object (rendered in UI; `emailVerificationEnabled` feeds the prompt)                                                                             |
| 16  | `updateNeonAuthEmailAndPasswordConfig` (neon_handlers.ts:883)                                    | PATCH `.../auth/email_and_password`                                               | Persist; echo                                                                                                                                                                                                    | whole object                                                                                                                                           |
| 17  | `listBranchNeonAuthTrustedDomains` / `addBranchNeonAuthTrustedDomain` (vercel_neon_sync.ts only) | GET/POST `.../auth/domains`                                                       | Stub: `{domains:[]}` / 200                                                                                                                                                                                       | not on benchmark path                                                                                                                                  |

**Branch `updated_at` must be stable per branch** and bump only on real branch mutations (create/DDL apply). The migration flow captures `prodUpdatedAt` at preview and re-checks it at apply to reject stale plans (`migration_utils.ts:39-42, 272`); the E2E mock had to pin `MOCK_BRANCH_TIMESTAMP` for exactly this reason (`neon_management_client.ts:106-109`). A shim returning `new Date()` per call would make every apply "stale".

**Auth stand-in (better-auth):** one node process hosting better-auth **instances keyed by project id** (C12 lifecycle): an instance is **lazily mounted** on the project's first auth enable (`createNeonAuth`) or first request, serving basePath `/<branchkey>/neondb/auth` for each auth-enabled branch of that project, each branch handler backed by a pg pool into that branch's database with `search_path=neon_auth`. Instances are **torn down — pools closed, handlers unmounted — on project delete** (DELETE `/projects/{pid}`) and via the shim's `POST /__sim/reset` (§9). Mount/teardown is idempotent and serialized per project id, so it is safe under the 2-worker scoring concurrency (two workers scoring different cells' clones can lazily mount their clone instances in parallel without racing each other's pools). Config: `emailAndPassword: { enabled: true, requireEmailVerification: false }` (matching the C3 auth contract: email verification OFF), no social providers, `advanced: { cookiePrefix: "neon-auth" }`, model names mapped to Neon Auth's schema (`users`, `sessions`, `accounts`, `verifications` in schema `neon_auth`, matching `schema_name: "neon_auth"` / `table_name: "users"` in the mock at neon_management_client.ts:270-285) so model-generated FKs to `neon_auth.users(id)` resolve. Because branch=database template copies the whole database, `neon_auth` inherits into child branches exactly like Neon (the 409-inheritance path in `ensureNeonAuth`) — and into §8 checkpoint snapshots and their scoring clones.

**Session-cookie plan (C8):** scored apps run at `http://localhost:<port>` under Playwright Chromium; the app-to-auth hop is HTTPS (edge), and the Next.js SDK proxies `Set-Cookie` onto the localhost origin. **Primary:** `useSecureCookies: true`, keeping the name-faithful `__Secure-neon-auth.session_token`; spike **S-AUTH** (§7) must confirm or falsify — before anything else is built on it — that Playwright Chromium and the `@neondatabase/auth` SDK accept and round-trip the `__Secure-` session cookie on the trustworthy `http://localhost` origin. **Fallback (validated in the same spike if primary is falsified):** an mkcert TLS front-proxy in front of the scored app at `https://localhost:<port>` — the stack already carries the mkcert CA for the SQL edge, so this adds one Caddy vhost and zero new trust configuration, and keeps both the cookie name and the `Secure` attribute fully faithful. Both paths are concrete and pre-validated; neither depends on hoping browser behavior cooperates.

### 4. Dyad patch set (three items, minimal, upstreamable)

The benchmark carries a small benchmark-support patch set of **exactly three items** (style precedent: the existing `DYAD_ENGINE_URL`/`DYAD_GATEWAY_URL` overrides — see the harness allowlist `src/testing/chat_flow_harness.ts:76-86`; `DYAD_ENGINE_URL` is also how the engine recording proxy is interposed):

- **P1 — Neon base-URL env override.** `src/neon_admin/neon_management_client.ts:388-395` — both `createApiClient({ apiKey })` calls become `createApiClient({ apiKey, baseURL: process.env.DYAD_NEON_API_BASE_URL || undefined })`. `ApiConfig` extends AxiosRequestConfig, and `api.gen.js:341` already treats a provided `baseURL` as authoritative. Benchmark sets `DYAD_NEON_API_BASE_URL=http://127.0.0.1:8788/api/v2`. Reminder: this override is only reachable when `E2E_TEST_BUILD` is unset in the process — set, it short-circuits `getNeonClient()` into the in-process mock (neon_management_client.ts:112-113) before the override is consulted.
- **P2 — `fixtureAppPath` harness option.** `chat_flow_harness` gains a `fixtureAppPath` option: an absolute path to the pinned starting-template snapshot, so every cell begins from the same template checkout instead of the harness's default scaffold.
- **P3 — harness catalog wiring.** `useFakeCatalog: false` plus `DYAD_LANGUAGE_MODEL_CATALOG_URL` pointed at a local pinned catalog file containing all 7 engine model ids and the auto provider — without this the harness only knows `test-model` (`chat_flow_harness.ts:288-330`).

No driver-side patches beyond P1: the mkcert decision (§1) means the serverless driver, ts-pg-schema-diff, and the generated app all work unmodified. (If the http route had been chosen instead, two further driver patches would be required — a `neonConfig.fetchEndpoint` override at `src/neon_admin/neon_context.ts:1-16` module init and an `ssl` override in `MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS` at `migration_utils.ts:25-32` — which is the concrete reason http loses.)

### 5. Token/settings plan — never touch oauth.dyad.sh

Refresh triggers when `currentTime >= tokenTimestamp + expiresIn - 300` (`neon_management_client.ts:16-26`, checked at :375); the refresh path POSTs to `https://oauth.dyad.sh/api/integrations/neon/refresh` (:54). The benchmark seeds settings through the harness's `writeSettings` passthrough (`chat_flow_harness.ts:304-315`, `settings` option) with the `NeonSchema` shape (`src/lib/schemas.ts:219-224`):

```ts
settings: {
  neon: {
    accessToken:  { value: "neon-sim-token" },
    refreshToken: { value: "neon-sim-refresh" },
    expiresIn: 10 * 365 * 24 * 3600,             // ~2036; -300s guard never fires
    tokenTimestamp: Math.floor(Date.now() / 1000),
  },
}
```

The shim accepts any `Authorization: Bearer` value (logs it, never validates), so `refreshNeonToken` and the broker are structurally unreachable.

### 6. Generated-app compatibility (zero app-side modifications)

What Dyad writes into `.env.local` on connect (`autoInjectNeonEnvVars`, neon_utils.ts:222-286 → `updateNeonEnvVars`, app_env_var_utils.ts:210-266): `DATABASE_URL` + `POSTGRES_URL` = the shim's development-branch URI, `NEON_AUTH_BASE_URL` = `https://auth.neon-sim.test/<devbranchkey>/neondb/auth`, `NEON_AUTH_COOKIE_SECRET` = Dyad-generated 64-hex (Next.js only, app_env_var_utils.ts:206-208, 238-249). The app then works untouched:

- `neon(process.env.DATABASE_URL)` resolves host `db.neon-sim.test`, rewrites to `https://api.neon-sim.test/sql` (v1 driver) or `https://db.neon-sim.test/sql` (older/newer conventions) — both terminate at the edge → sql-proxy. Next.js loads `.env.local` natively.
- `createNeonAuth({ baseUrl: NEON_AUTH_BASE_URL, cookies: { secret } })` proxies to our better-auth over HTTPS; the cookie secret only signs the SDK's local `session_data` cache cookie (`app_env_var_utils.ts:220-231`), so the auth server never needs it.
- What the benchmark must add to the app process environment when running it for scoring: **only** `NODE_EXTRA_CA_CERTS=<mkcert rootCA.pem>` (plus `PORT`); as everywhere in the benchmark, `E2E_TEST_BUILD` stays unset. Scoring drives the app at `http://localhost:<port>` under Playwright Chromium (or behind the mkcert TLS front-proxy at `https://localhost:<port>` if S-AUTH falsifies the primary — §3). No `Domain` attribute is set on session cookies (host-only), so `localhost:<port>` scoping is clean.
- Optional hardening for a model that ignores the template and uses `Pool` (WebSocket) instead of `neon()`: route `wss://db.neon-sim.test/v2` at the edge to a `ghcr.io/neondatabase/wsproxy` sidecar; the driver's default `wsProxy` is `host + "/v2"`. Cheap to add, not on the happy path.

### 7. Spike list (ordered; each falsifiable and time-boxed; acceptance criteria unchanged from prior draft where still valid)

- **S-AUTH — `@neondatabase/auth` against plain better-auth + secure-cookie confirmation** (1.5 days; highest external-SDK risk; runs FIRST per C8). Scaffold a Next.js app exactly per the guide templates (`add-authentication.md:64-121`), point `NEON_AUTH_BASE_URL` at the auth service. Pass (unchanged): Playwright signs up with email/password, lands authenticated, `auth.getSession()` in a server component returns the user, and the session survives reload on `http://localhost`. New C8 obligation: explicitly confirm or falsify that the `__Secure-neon-auth.session_token` cookie is set and round-tripped by Playwright Chromium on trustworthy `http://localhost:<port>`; if falsified, validate the fallback within the same spike — mkcert TLS front-proxy at `https://localhost:<port>` — before the spike closes. Additional falsifiers to probe: SDK requires a Neon-proprietary endpoint (e.g. JWKS/`/token`), hard-codes the `__Secure-` cookie name, or rejects a non-neon.tech base URL.
- **S-SQL — protocol core: serverless driver vs our /sql translator** (0.5 day). Plain node script with `@neondatabase/serverless@^1`: tagged query, `sql.query` with params, `sql.transaction` batch, and a deliberate syntax error, against the edge at 443 with `NODE_EXTRA_CA_CERTS`. Pass (unchanged): all four behave identically to the driver's documented shapes (batch returns per-query results array; error is a `NeonDbError` with `code`/`position` populated); confirm the request actually arrived on host `api.neon-sim.test`. Fail: any hidden protocol field we didn't reimplement.
- **S-E2E — Dyad end-to-end through the harness** (1 day). `setupChatFlowHarness` with the P1–P3 patch set applied, seeded neon settings, `DYAD_NEON_API_BASE_URL` set, and `E2E_TEST_BUILD` unset (else the in-process mock short-circuits the shim entirely); invoke `neon:create-project` via the mock IPC, then a fixture chat turn containing `<dyad-execute-sql>` (CREATE TABLE), then assert `getNeonTableSchema` renders that table (exercises `buildSchemaSnapshotSql`'s single large JSON row through the proxy, `neon_context.ts:344-374`). Pass (unchanged): project + 3 branches (main→development→preview per neon_handlers.ts:180-249) exist as databases, `.env.local` contains all four vars, schema SQL contains the table. Fail: any handler assertion (e.g. empty `connection_uris`) trips.
- **S-DIFF — ts-pg-schema-diff migration path** (0.5 day; fidelity-only, not on the scoring path). `prepareMigrationContext` + `generateNeonMigrationStatements` between development and main databases over TLS TCP. Pass (unchanged): additive DDL diff produced and `executeNeonStatementsInTransaction` applies it; stable `updated_at` passes the apply-time staleness re-check. Fail: `ssl: true` handshake or introspection incompatibility — if so, document promote-to-prod as out of scope rather than patching Dyad further.

### 8. Milestone checkpoint snapshots (schema/data capture, C6)

Checkpoint state capture is a **database snapshot**, not log replay. At each milestone end the runner calls the shim:

- `POST http://127.0.0.1:8788/__sim/snapshot` with `{ cellId, ckpt, sourceDb }` → the shim runs `pg_terminate_backend()` on the source (development) database's sessions, then `CREATE DATABASE cell_<cellId>_ckpt<N> TEMPLATE <dev_db>` — the same cheap template-copy primitive as branching (§1). The copy carries **everything**, including the `neon_auth` schema, so users/sessions created during the build survive into scoring.
- **Clone-per-scoring-attempt:** scoring never runs against the snapshot itself. Each scoring attempt asks the shim to `CREATE DATABASE cell_<cellId>_ckpt<N>_score<K> TEMPLATE cell_<cellId>_ckpt<N>`, points the scored app's `DATABASE_URL`/`NEON_AUTH_BASE_URL` at the clone (the auth service lazily mounts a basePath for the clone under the owning project's instance — §3 lifecycle), runs the CUJs, and drops the clone afterward. Snapshots stay immutable; retries and the two concurrent scoring workers each get their own clone.
- CUJs are self-contained with RUN_ID-suffixed identities/records, so pre-existing build-phase data in the snapshot is harmless to scoring.
- The sql-proxy's **SQL ledger** (§2) is retained alongside each cell as a diagnostic artifact only. It is explicitly **not** the schema-reconstruction mechanism — and there are no `migrations/*.sql` files in Dyad-built checkouts to replay either (neon_prompt.ts forbids manual migration files), so the snapshot is the sole source of checkpoint schema+data truth.

### 9. Reset/isolation protocol between runs

Each (model, app) run gets a fresh Neon project via the real `neon:create-project` handler, so cross-run leakage is already impossible at the data layer if project state is torn down. Belt and suspenders, in order, driven by the benchmark runner:

1. `POST http://127.0.0.1:8788/__sim/reset` (loopback-only, refuses non-local peers): terminates all non-maintenance sessions (`pg_terminate_backend`), `DROP DATABASE` every `neondb_%` plus any `cell_%` snapshot/clone whose scoring attempts have completed (snapshots for still-unscored checkpoints are retained), truncates `neon_sim.state`, resets id counters, and tears down every better-auth instance — keyed by project id, pools closed, handlers unmounted (the same teardown that runs per-project on DELETE `/projects/{pid}`, so a normally-completing run cleans up after itself even without a reset). Teardown is serialized per project id and therefore safe against the 2-worker scoring concurrency. sql-proxy pools die on their own via the 5 s idle timeout. `GET /__sim/state` dumps shim state for the run log.
2. `neon_auth` wiping is free — the schema lives inside the dropped branch databases (and dropped snapshot/clone databases).
3. Dyad-side state needs no protocol: the harness already gives each run a throwaway userData dir, sqlite DB, and app checkout, and restores env on `dispose()` (`chat_flow_harness.ts:264-276, 432-457`).
4. Resume semantics: because results are append-only JSONL keyed by (model, app, milestone), a resumed run calls `/__sim/reset` only when starting a cell from scratch; a milestone retry after an infra failure re-runs from the cell's own fresh project creation, never from partial shim state — and re-scoring an already-captured milestone needs no re-run at all, just a fresh clone of its §8 snapshot.
