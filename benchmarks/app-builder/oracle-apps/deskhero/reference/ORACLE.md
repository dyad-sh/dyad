# Deskhero oracle — reference implementation

The reference Deskhero. It exists so a CUJ run can validate itself: these scores
are fixed points. If a run of the deskhero suites against this directory does
not reproduce the numbers below, **the harness changed, not the app**.

## Final scores

| Checkpoint | Suite                                | Score     |
| ---------- | ------------------------------------ | --------- |
| 1          | `cuj-tests/deskhero/checkpoint-1.spec.ts` | **11/12** |
| 2          | `cuj-tests/deskhero/checkpoint-2.spec.ts` | **20/20** |
| 3          | `cuj-tests/deskhero/checkpoint-3.spec.ts` | **22/22** |

Checkpoint 1 is 11/12 by design, not by defect: `m1-close-reopen` is the one CUJ
that an M2/M3-faithful app is *required* to fail. See
[Why checkpoint 1 is 11/12](#why-checkpoint-1-is-1112).

Each score was reproduced on at least three independent runs (fresh database
each time). There are no known flaky tests.

## How to run it

Requires a running neon-sim (`../../../neon-sim/README.md`) and a local
Postgres. From `benchmarks/app-builder`:

```bash
./oracle/run-suite.sh oracle/deskhero/reference deskhero 3 3700   # 22/22
./oracle/run-suite.sh oracle/deskhero/reference deskhero 2 3700   # 20/20
./oracle/run-suite.sh oracle/deskhero/reference deskhero 1 3700   # 11/12
```

Add a fifth argument to grep a single test while iterating:

```bash
./oracle/run-suite.sh oracle/deskhero/reference deskhero 3 3700 m3-overdue
```

Every run creates a fresh project, database and auth mount, applies
`schema.sql`, builds, serves on the given port, and prints `N/M passed`. The
runner writes `.env.local` into this directory (gitignored) and the server log
path it prints is where runtime SQL/auth errors show up.

## `schema.sql`

Application-owned objects only: `user_profiles`, `tickets`, `ticket_notes`,
`ticket_replies`, `canned_responses`, `audit_events`, plus indexes.

Two deliberate omissions/additions relative to a raw `pg_dump` of the model's
checkpoint-3 snapshot database:

- **No `neon_auth` objects.** better-auth provisions its own
  `user`/`session`/`account`/`verification` tables and the `neon_auth.users`
  view when the branch's auth instance is created
  (`neon-sim/lib/auth-mounts.mjs`), which happens *before* `schema.sql` is
  applied. Recreating them here would be redundant at best and conflicting at
  worst. Nothing in `public` has a foreign key into `neon_auth`, so the file
  applies cleanly to an empty database.
- **Grants to `PUBLIC` at the end.** The runner applies this file with `psql` as
  the local OS user, but the app connects as the database's own login role
  (`simuser`). Without the grants every query fails with
  `permission denied for table user_profiles` — this was the cause of the
  initial 0/22.

## What changed vs the base model output

Base: `results/s-cell/checkouts/gpt-5.6-terra-deskhero` at tag `checkpoint-m3`
(the best existing deskhero cell). Grouped by root cause.

### 1. Environment / schema (0/22 → suite could run at all)

- **`schema.sql`** (new). Derived from the cell's ckpt3 snapshot database, with
  the `neon_auth` objects stripped and grants added, as described above.

### 2. Deactivated accounts were signed *out*, not shown as deactivated

M3 requires that a deactivated user's request be rejected server-side **and**
that "the UI shows a deactivated-account notice". The base app's page guards
called `getCurrentUser()`, which returns `null` for a deactivated account, so
every protected page redirected to `/auth/sign-in` and the notice was never
reachable. The notice lived in the header behind a client-side `/api/me` 403,
on pages the user could no longer reach.

- **`src/components/deactivated-notice.tsx`** (new): server-rendered notice
  carrying `account-deactivated`.
- **`src/app/{tickets,tickets/new,tickets/[id],admin,admin/users,admin/audit,admin/canned,agent}/page.tsx`**:
  guards now read `getSessionAccount()` and branch three ways — no session →
  redirect to sign-in; session but deactivated → render the notice; otherwise
  apply the role rule. Exactly one element carries `account-deactivated`
  (the header's copy was removed) so the locator is never ambiguous.
- **`src/components/ticket-header.tsx`**: dropped the client-side deactivated
  banner, which would otherwise have been a second match.

Fixes `m3-deactivate`, `m3-reactivate`.

### 3. Sign-out lost a race with the next navigation

`authClient.signOut()` is a background `fetch`; the next navigation cancels it,
and `@neondatabase/auth` keeps a signed `__Secure-neon-auth.local.session_data`
cookie cache with a **300 s** default TTL, so the server keeps answering
"signed in" long after the user clicked sign out. This is not a subtle bug:
**all seven scored models failed `m1-signout-guard`** (`results/s-score/*deskhero*ckpt1*.json`).

- **`src/app/api/sign-out/route.ts`** (new): `POST` revokes the session via
  `auth.signOut()` and returns a 303 to `/auth/sign-in` that clears both the
  session token and the session-data cache cookie.
- **`src/components/ticket-header.tsx`**: the `sign-out` control is now a submit
  button in a real `<form method="post" action="/api/sign-out">`, so the sign-out
  is a top-level navigation the browser cannot silently drop — and it works with
  JavaScript disabled.

Fixes `m1-signout-guard`.

### 4. `window.confirm` on delete

The base app guarded `ticket-delete` with `window.confirm`. Playwright
auto-dismisses dialogs when no handler is registered, so `confirm()` returned
`false` and the ticket was never deleted (four of the seven models shipped this
same bug and failed `m1-delete`). The delete now happens on click; the suite
also supports an optional `ticket-delete-confirm` step, which this app does not
need.

Fixes `m1-delete`.

### 5. `sla-due` was not machine-readable

`sla-due` rendered only `toLocaleString()`. The suite's `parseSlaDue` prefers an
ISO timestamp and only falls back to loose parsing. `sla-due` now renders the
human string plus the ISO instant in a visually-hidden span, so it is readable
by people *and* unambiguous to tooling.

Also in the same area: `sla-due-input` (a `datetime-local`) was seeded with a
UTC string, which displays the wrong wall-clock time in any non-UTC timezone;
it now uses local components and keeps its own draft state instead of mutating
the ticket on every keystroke.

Fixes `m3-sla-set`.

### 6. Selects rendered before their options loaded

`assignee-select` and `canned-select` appeared as soon as the ticket loaded, but
their options arrive from a later `fetch`. Anything that picks an option the
moment it sees the control — a fast script, or a fast human — races the data.
This produced a real intermittent failure (`m3-reply-thread` failed once in
five runs on `assignTo`: *option containing "Desk Agent1 …" in assignee-select*).

Both selects now render only once their data has arrived (`agents`/`canned`
start as `null`, not `[]`), with a "Loading agents…" placeholder in the meantime.

Removes an intermittent failure across every test that uses `desk.assignedTicket`.

### 7. Transition matrix duplicated between client and server

The M2 matrix was written out twice — once in the transition route, once as a
nested ternary picking buttons — so UI gating could drift from enforcement,
which is exactly the failure mode App 2 is designed to catch.

- **`src/lib/workflow.ts`** (new): the matrix, once, as `checkTransition`
  (returning `ok` / `illegal` → 422 / `forbidden` → 403) and `statusControls`.
- **`src/app/api/tickets/[id]/transition/route.ts`** and
  **`src/components/ticket-detail.tsx`** both consume it.

Behaviour-preserving; it makes the gating property structural instead of
coincidental.

### 8. Agent queue rows were not `ticket-row`s

M3 pins an overdue badge on "every list row (all dashboards)" and `ticket-row`
is the pinned row testid, but the agent dashboard's queue rows carried neither.
`src/components/agent-dashboard.tsx` now tags each queue row `ticket-row`
(the overdue badge was already there).

## Why checkpoint 1 is 11/12

`m1-close-reopen` (`checkpoint-1.spec.ts:105`) creates an **open** ticket as a
requester, clicks `ticket-close`, and requires the status to become `closed`;
then `ticket-reopen` → `open`.

`specs/deskhero/m2.md` says of the status workflow:

> Only the transitions below are legal. Reject everything else server-side
> (403 when the caller's role/identity is not allowed, 422 when the transition
> itself is illegal)

and its matrix contains no `open → closed` row at all, while `closed → open` is
**admin only**. An app that satisfies `m1-close-reopen` therefore *must* violate
M2, and an app that satisfies M2 *must* fail `m1-close-reopen`. The two cannot
both hold in one build.

This is a consequence of the oracle running all three suites against a single
M3 directory. The production scorer (`cuj-tests/score-checkpoint.sh`) runs each
suite against its own checkpoint tag, where `m1-close-reopen` is satisfiable and
was in fact passed by the base model at its `checkpoint-m1` commit.

**Treat 11/12 with exactly `m1-close-reopen` failing as the expected checkpoint-1
result.** Any other checkpoint-1 failure is a regression.
