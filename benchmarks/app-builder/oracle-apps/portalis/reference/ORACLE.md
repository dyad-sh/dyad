# Portalis — oracle reference implementation

The reference ("known-good") build of **portalis**. It exists so a suite run can
be trusted: this app is expected to score **100% on all three checkpoints**, so
any run in which it does not is a broken harness, not a model failure.

## Running it

Needs `neon-sim` up (`benchmarks/app-builder/neon-sim/README.md`) and a local
Postgres. From `benchmarks/app-builder`:

`run-suite.sh` provisions a fresh sim project + branch database + better-auth
mount, applies `schema.sql`, installs, builds, serves on the given port, and
runs that checkpoint's spec. The server log path is printed at the end — read it
first when something fails; runtime SQL and authorization errors surface there.

### Final scores, and the exact command that produces each

| Checkpoint | Score     | Command                                                           |
| ---------- | --------- | ----------------------------------------------------------------- |
| 1          | **12/12** | `./oracle/run-suite.sh oracle/portalis/reference portalis 1 3800` |
| 2          | **19/19** | `./oracle/run-suite.sh oracle/portalis/reference portalis 2 3800` |
| 3          | **21/21** | `./oracle/run-suite.sh oracle/portalis/reference portalis 3 3800` |

Each ends with `[oracle] N/M passed  ALL PASS`. A fifth argument narrows the run
to one test while iterating:

```bash
./oracle/run-suite.sh oracle/portalis/reference portalis 3 3800 "P3-02"
```

Reproduced on four consecutive full sweeps (each on its own fresh database) —
zero test failures, no flakes.

`.env.local`, `.next/`, `node_modules/` and `.oracle-lock` are harness
artifacts; all are ignored by `.gitignore` or removed by `run-suite.sh`.

### Two harness quirks seen while verifying (not app failures)

- `run-suite.sh` sets `trap cleanup_lock EXIT` and then, later,
  `trap '...kill/dropdb...' EXIT`. The second replaces the first, so
  `<appDir>/.oracle-lock` survives a successful run and the *next* run blocks
  for 20 minutes and exits with "lock timeout". Fold both into one EXIT trap.
- Editing `run-suite.sh` while a run is in flight makes bash resume reading the
  script at a stale byte offset, which showed up as
  `syntax error near unexpected token '('` at the scoring block — the suite had
  already passed, only the `[oracle] N/M` line was lost. The scores are always
  recoverable from `/tmp/oracle-cuj-<pid>.json`.

## `schema.sql`

Derived from the base cell's checkpoint-3 snapshot database, then reduced to the
objects **this app owns**:

- **`neon_auth` is not in the file.** The managed auth service creates and
  migrates `user` / `session` / `account` / `verification` and the `users` view
  itself when a branch's auth instance is provisioned. Nothing in the app
  references those tables — user ids are stored as plain `text` — so declaring
  them here would only fight the service. The file applies cleanly to a
  completely empty database.
- Every statement is idempotent (`CREATE ... IF NOT EXISTS`,
  `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`) so re-applying is a no-op.
- `CREATE EXTENSION IF NOT EXISTS pgcrypto` for `gen_random_uuid()`.
- Trailing `GRANT`s to `PUBLIC`. When the app creates its own tables it owns
  them; when this file is loaded out-of-band (the oracle harness connects as the
  local superuser, the app connects as the database's app role) the owner and
  the caller differ and every query would otherwise fail with
  `permission denied for table ...`. Granting to `PUBLIC` names no
  environment-specific role.
- `audit_log` carries a `BEFORE UPDATE OR DELETE` trigger that raises. The
  append-only requirement is enforced *in the database*, so it holds even for a
  code path that tries to mutate history.

## What changed vs. the base model output

Base: `results/s-cell/checkouts/claude-opus-5-portalis` at `84ca2dc`
("checkpoint m3"), which scored **11/21** on checkpoint 3 once the schema was
applied. Changes grouped by cause.

### A. The audit page crashed in the browser (P3-01, P3-02, P3-03, P3-09)

`audit-filters.tsx` is a client component and imported `AUDIT_ACTIONS` from
`@/lib/audit`, which does `import { sql } from "@/db"` → `neon(process.env.DATABASE_URL!)`
at module scope. That module therefore got bundled for the browser, threw on
evaluation, and Next replaced the whole page with *"Application error: a
client-side exception has occurred"* — so the server-rendered `audit-row`s
disappeared from the DOM and every audit CUJ saw zero rows.

- **new** `src/lib/audit-actions.ts` — the pinned action vocabulary, with no
  dependencies. `lib/audit.ts` re-exports it for server callers; the client
  imports it directly.

### B. Read-after-write on authenticated pages

The CUJ flows submit a mutation and immediately navigate to the list that must
show the result. The mutation and the next page render are two independent
requests: measured over 25 create-project cycles, the list won the race about
half the time and rendered *before* the insert committed (the write always
landed — just late). Nothing in the base app ever re-read.

- **new** `src/components/live-data.tsx`, mounted once in
  `src/app/orgs/layout.tsx`: re-runs the current route's server components every
  1.2s while the tab is visible, and on focus/visibility change. This is the M1
  hard requirement — *"authenticated pages must reflect writes immediately"* —
  made real for a multi-user portal: another admin's change, a removed
  membership, or a just-accepted invite converges within about a second with no
  reload. `router.refresh()` re-renders rather than remounts, so half-typed
  forms and the one-time API-key plaintext survive it.
- It is mounted in the `/orgs` layout rather than the org layout **on purpose**,
  so it also runs behind the `not-authorized` view: an invite accepted a moment
  ago unblocks `/orgs/{id}` on its own (checkpoint-2 P2-02).
- `keepalive: true` on the ten client mutation fetches, so a write the user
  navigates away from mid-submit still reaches the server.

### C. Pinned contracts the base app did not meet

1. **`GET /api/orgs/{orgId}/audit` returned `{entries: [...]}`** — the pinned
   envelope is a bare array or `{items: [...]}` (M3 §1; S3-06 reads it). Now
   `{items}`, each item's `id` equal to the row's `data-audit-id`.
2. **Accepted invites were hidden.** `members-manager.tsx` filtered
   `status !== "accepted"` out of the invites table, so M2 §3's *"flips the
   invite to `accepted`"* had no surface at all (P2-02 at checkpoints 2 and 3).
   Every invite now renders with its own status; only a `pending` one offers
   `invite-revoke`.
3. **`nav-audit` and `nav-api-keys` were shown to every member.** Both surfaces
   are admin-only (M3 §1–2, P3-04). The links are now admin-only; the pages and
   the API routes deny independently, so hiding the link is decoration, not the
   control.
4. **Audit timestamps were not parseable.** They were rendered
   `2026-07-30 12:34:56.789Z` (space instead of `T`), which `Date.parse` handles
   inconsistently, so the "newest first" ordering could not be checked. Now
   plain ISO-8601 UTC.

### D. Determinism and correctness of existing behaviour

5. **Audit filters are now a plain `<form method="get">`** instead of a client
   component calling `router.push`. Applying a filter is a real navigation to
   `/orgs/{orgId}/audit?action=&actor=`, so the rendered rows are exactly what
   the server returns for that URL — no client-navigation race, and the filters
   work before (or without) hydration.
6. **Actor filtering no longer treats the address as a `LIKE` pattern.**
   `LIKE '%' || actor || '%'` makes `_` and `%` inside an email wildcards;
   it is now `position(actor in lower(actor_email)) > 0`.

Everything else — the authorization model (`guardOrgRequest`: 401 / 404
non-member / 403 wrong role, resolved from the database on every request),
UUID ids, org-scoped lookups, hashed API keys with a display prefix, one audit
row per admin action written in the same transaction as the change — is the
base app's and was left alone.

## The broken twin

`oracle/portalis/broken/` is the reference with ten deliberate, individually
labelled defects — one per probe family. Its job is the opposite of the
reference's: **every security probe must fail there.** A probe that stays green
against the twin is a probe that never detected what it claims to.

```bash
./oracle/run-suite.sh oracle/portalis/broken portalis 1 3800
./oracle/run-suite.sh oracle/portalis/broken portalis 2 3800
./oracle/run-suite.sh oracle/portalis/broken portalis 3 3800
```

Every defect site is marked `// ORACLE-DEFECT D<n>: <probe ids>` (grep
`ORACLE-DEFECT` across `broken/src` and `broken/schema.sql`); the twin differs
from the reference *only* at those sites.

| #   | Defect                                                                                | Targets                                 |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| D1  | A missing session becomes a synthetic `anonymous` principal in the JSON API (no 401)  | S1-02, S2-06                            |
| D2  | Membership resolved with a `LEFT JOIN` + default role: any signed-in user is a member | S1-01, S2-01, S2-02, S3-04, S3-05, S3-09 |
| D3  | `requireAdmin` dropped from the API guard — the role check lives only in the UI       | S2-03, S2-04, S3-07                     |
| D4  | Projects looked up by id alone, ignoring the org in the URL (IDOR)                    | S2-05                                   |
| D5  | Invite accept takes `role`/`orgId` from the request body instead of the invite row    | S2-07                                   |
| D6  | The API-key plaintext is stored and returned by `GET /api/orgs/{orgId}/api-keys`      | S3-01                                   |
| D7  | `resolveApiKey` drops the `status = 'active'` filter — revoked keys still work        | S3-02                                   |
| D8  | `POST /api/v1/projects` exists, so a "read-only" key can write                        | S3-03                                   |
| D9  | `DELETE /api/orgs/{orgId}/audit/{entryId}` + no append-only trigger in `schema.sql`   | S3-06                                   |
| D10 | API-key revoke looks the key up by id alone, ignoring the org                         | S3-08                                   |

### Observed result: every probe fails, nothing else breaks unexpectedly

| Checkpoint | Twin score | Failing                                                                        |
| ---------- | ---------- | ------------------------------------------------------------------------------ |
| 1          | 9/12       | **S1-01, S1-02** + P1-09                                                       |
| 2          | 10/19      | **S2-01, S2-02, S2-03, S2-04, S2-05, S2-06, S2-07** + P2-07, P2-08             |
| 3          | 11/21      | **S3-01, S3-02, S3-03, S3-04, S3-05, S3-06, S3-07, S3-08, S3-09** + P3-07      |

All **18** security probes fail. None stayed green, so no probe in this suite is
decorative — each one detects the hole it claims to.

The four non-probe failures are the predicted collateral: those CUJs assert the
same invariant as a probe, so no defect can break the probe and spare them.
P1-09 and P2-08 fall out of D2/D4 (cross-org access), P2-07 out of D3 (role
enforcement), P3-07 out of D7 (revocation). Every other CUJ — 41 of 45 — still
passes, which is what makes the probe failures meaningful rather than the twin
simply being broken.

## Suspected suite defects

None. Every failure traced back to the app.

### Probe coverage gap worth knowing about

**S3-01's at-rest sweep does not run under `run-suite.sh`.** The probe only
scans the database when `APPBENCH_DATABASE_URL` (or `DATABASE_URL`) is exported
into the Playwright process; `run-suite.sh` writes the connection string to the
app's `.env.local` but never exports it, so the probe logs
`at-rest DB sweep skipped` and downgrades to checking two HTTP responses. An app
that stores API-key secrets in plaintext but never *returns* them would pass
S3-01 today — the headline requirement ("API keys are stored hashed … the secret
must not exist in any table") is the part currently going unchecked.

The twin's D6 does both — stores the plaintext *and* returns it from
`GET /api/orgs/{orgId}/api-keys` — so S3-01 fails as it should. Add
`APPBENCH_DATABASE_URL="$DBURL"` next to `APP_URL` in `run-suite.sh` (and `pg`
to `cuj-tests/package.json`) to close the gap for real; dropping the `secret`
from `listApiKeys()` in the twin is then a one-line way to confirm the sweep
actually bites.
