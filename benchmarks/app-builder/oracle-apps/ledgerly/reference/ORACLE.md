# Ledgerly — oracle reference implementation

A reference build of **Ledgerly** that scores **100% on all three CUJ
checkpoints**. It exists so a scoring run can validate itself: if this app ever
scores below 100%, the harness (or its environment) is broken, not the app under
test.

## Final scores

| Checkpoint | Suite                                     | Result             |
| ---------- | ----------------------------------------- | ------------------ |
| 1          | `cuj-tests/ledgerly/checkpoint-1.spec.ts` | **12 / 12 passed** |
| 2          | `cuj-tests/ledgerly/checkpoint-2.spec.ts` | **20 / 20 passed** |
| 3          | `cuj-tests/ledgerly/checkpoint-3.spec.ts` | **22 / 22 passed** |

Verified repeatedly, not once: after the last app change all three checkpoints
ran green on **five consecutive full passes** (15 suite runs, 270 tests, zero
failures). No test in any suite was modified.

`schema.sql` applies cleanly to an empty database and is idempotent on re-apply
(every object is `IF NOT EXISTS`, the append-only trigger is
`DROP TRIGGER IF EXISTS` + `CREATE`).

## How to run it

`neon-sim` must be running (see `../../../neon-sim/README.md`). From
`benchmarks/app-builder/`:

```bash
./oracle/run-suite.sh oracle/ledgerly/reference ledgerly 3 4100   # 22/22
./oracle/run-suite.sh oracle/ledgerly/reference ledgerly 2 4100   # 20/20
./oracle/run-suite.sh oracle/ledgerly/reference ledgerly 1 4100   # 12/12
```

Add a 5th argument to grep a single test, e.g. `… ledgerly 3 4100 led-m3-s07`.
Each invocation provisions a fresh project + database, applies `schema.sql`,
installs, builds, serves on the given port and runs that checkpoint's suite.
The server log path is printed at the end; runtime SQL/auth errors surface
there.

**`run-suite.sh` checks out `checkpoint-m<N>` and leaves the tree on a detached
HEAD.** Run `git checkout main` before editing anything, or the next commit
lands on the detached head and `main` silently falls behind (this cost one
iteration here). Re-tag with `git tag -f checkpoint-m<N>` after every fix: the
scorer only ever sees the tag.

## What the checkpoints hold

Milestones legitimately change behaviour, so each checkpoint is its own tag and
its own `schema.sql`:

| Tag             | Schema highlights                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `checkpoint-m1` | `accounts` / `entries` / `entry_lines`, owned per user; unique `(user_id, code)`                          |
| `checkpoint-m2` | records re-parented onto `books`; unique `(book_id, code)` **replaces** the M1 index; draft/posted state  |
| `checkpoint-m3` | `periods` (with a `gist` exclusion constraint) and an append-only `audit_log` with a no-mutate trigger    |

## Design notes a future maintainer will want

### Money is integer cents, converted in exactly one place

`src/lib/money.ts` is the only dollars ↔ cents boundary, and it converts on the
decimal **string**, digit by digit — no value ever passes through binary
floating point. That is not fussiness: `Math.trunc(parseFloat("1250.10") * 100)`
is `125009`, because the product is `125009.99999999999`, and `"80.10"` truncates
to `8009`. Every column is `integer` cents, every total is a SQL `SUM` over those
columns cast to `bigint` and read back through `toInt` (`src/db/index.ts`),
because Postgres returns `bigint` aggregates as strings. Probe `led-m3-s07`
posts 36 entries and asserts `Number.isInteger` on every monetary field of three
different surfaces; nothing in the app can produce a non-integer.

### Dates are calendar dates, never instants

`entries.entry_date` and `periods.start_date` / `end_date` are `date`. Every
read goes through `to_char(…, 'YYYY-MM-DD')`, so a date leaves the database as
the byte-identical string it arrived as and no driver ever turns it into a
`Date` that a time zone could shift by a day. The period total's predicate is
the inclusive `start_date … end_date` range on the **entry's** date — not on
`posted_at`, not on a timestamp — which is what `led-m3-08` measures by
reconciling a period total (`6666`) against an account balance (`16665`) that
uses no date predicate at all.

### Every ledger write goes through one guarded module

`src/lib/entry-service.ts` owns all five write paths (create, patch, delete,
post, reverse). The three invariants that outlive any single feature — a posted
entry is immutable, an entry balances, a closed period is frozen — are asserted
at the top of each, so a handler added in a later milestone cannot forget one.
The period lock is always evaluated against the **entry's** date, never today's,
and always before anything is written: `POST /api/entries {status:"posted"}`
checks the lock *before* the draft row exists, so a refused write leaves the
journal length unchanged (`led-m3-s01`).

### Posting, reversal and period close are single statements

The HTTP driver has no interactive transactions, so each of those is written as
one statement whose data-modifying CTEs commit together or not at all:

- **Posting** locks the draft (`FOR UPDATE`), bumps `books.next_entry_number`
  *conditionally on that lock succeeding*, writes the status change, and appends
  the `entry.posted` audit row. A refused post therefore burns no number, and
  two concurrent posts cannot be handed the same one.
- **Reversal** derives every value from the stored original — same accounts,
  same date, each line's debit and credit swapped — sets both links, and appends
  the `entry.reversed` row. The request body is never read at all (see below).
  The partial unique index on `reverses_entry_id` is what makes "an entry may be
  reversed once" true even under a race.
- **Close / reopen** flips `periods.status` and appends its audit row in the
  same statement.

### One personal book per user, enforced by the database

Sign-up and sign-in each fan out into several concurrent server requests, so
"create it if the user has none" runs concurrently with itself. The partial
unique index `idx_books_one_personal_per_owner (owner_id) WHERE is_personal`
plus `ON CONFLICT … DO NOTHING` makes the racing requests converge on one book.
`led-m2-09` fires eight `/api/me` and three `/accounts` requests in a single
`Promise.all` and requires exactly one book at every read.

### `src/lib/write-barrier.ts`

Carried over from the Relay CRM reference and unchanged in substance. A browser
can fire a mutating request and navigate in the same tick (the entry form posts
then routes to the entry; delete-confirm posts then routes to `/journal`).
`serializeWrite` runs one client's mutations in submission order and
`awaitWrites` makes that client's reads wait for its own in-flight writes, both
keyed on the client's session cookies so unrelated users never wait on each
other. It is coordination only — book scoping, roles, immutability, the balance
rule and the period lock are all still enforced by SQL predicates and the guards
in `entry-service.ts`.

### `btree_gist`

`schema.sql` creates the `btree_gist` extension so `periods` can carry an
`EXCLUDE USING gist (book_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`
constraint — "two periods in one book may not overlap" as a database rule rather
than as a check the application must remember. The API still tests for an
overlap first so the caller gets the pinned 400 in `period-form-error` rather
than a constraint violation. `btree_gist` is a trusted extension, so
`CREATE EXTENSION IF NOT EXISTS` succeeds for the database owner; if a future
environment refuses it, drop the constraint — the guarded `INSERT … WHERE NOT
EXISTS` in `createPeriod` already carries the user-facing behaviour.

### The one flake found, and why it was an app bug

`led-m1-01` failed once in ~10 runs at checkpoint 2: `sign-out-button` never
appeared after sign-up. The server log showed
`duplicate key value violates unique constraint "idx_app_users_email"` — the
`(app)` layout had 500'd, so the header never rendered.

Root cause: `app_users` carried **two** unique indexes (the `user_id` primary
key and a unique `lower(email)`), and `rememberUser` upserts with
`ON CONFLICT (user_id) DO UPDATE`. Postgres can infer only **one** arbiter
index; a conflict on any *other* unique index raises an error instead of taking
the `DO UPDATE` path. Sign-up fans out into several concurrent server requests,
so two first-time inserts of the same brand-new user race by default, and
whichever one lost could hit the email index first.

The fix is in the schema, not in a retry: the email index is now non-unique.
Email uniqueness is the auth service's guarantee, not this app's, and a second
unique index bought nothing while making a normal race fatal. The lookup in
`addMember` is `ORDER BY created_at DESC LIMIT 1` so it stays deterministic
regardless. The rule generalises — every other upsert in the app touches a
table whose only unique index is its arbiter.

## Two things that cost real time here

1. **The auth handler has to be mounted.** Without
   `src/app/api/auth/[...path]/route.ts` exporting `auth.handler()`, the browser
   auth client's calls 404, no session is ever established and the suite scores
   **0/12** with no error in the server log. Nothing in `specs/ledgerly/*.md` or
   in the template's `AI_RULES.md` auth note mentions the mount — see
   "Suspected suite/spec gaps" below.
2. **Re-tagging.** `run-suite.sh` scores the tag, not the working tree. A fix
   that is committed but not re-tagged is invisible to the scorer.

## SUSPECTED SUITE DEFECTS

None. Every checkpoint-3 assertion is satisfiable by a spec-faithful app.

## Suspected spec gaps (the benchmark would penalise a correct reading)

### 1. `bookId` in a reverse body: M2 says 403, M3 says ignore (`led-m3-s06`)

M2 pins: *"Never trust a book id from a query string, header or body: if it
names a book the caller does not belong to, respond 403 with no data."*
M3 pins: *"a reversal is always an exact mirror of its original: ignore any
`lines`, amount, `bookId`, `date`, `status`, `entryNumber`, `id`, actor or role
field in a post or reverse request body."*

`led-m3-s06` sends `POST /api/entries/{E}/reverse` with
`{ …, bookId: "<a book the caller does not belong to>" }` and requires **2xx**
plus a correctly mirrored reversal. An app that applies M2's rule uniformly —
the stricter and arguably safer reading, and the one this reference shipped
first — answers 403 and fails the probe, having done nothing wrong by M2's
words.

This reference resolves it the way the suite requires, and the resolution is
defensible from the spec (M3 is later, more specific, and names `bookId`
explicitly): `/post` and `/reverse` take no input at all, so they never read the
body, not even to reject it. But the conflict is worth fixing in the prompt —
either M3 should say "for these two routes the body is ignored rather than
rejected", or the probe should accept a 403 that leaves the ledger unchanged.
Severity: **minor** (one probe, and the M3 clause does pin it), but the failure
mode is a *more* secure implementation being penalised, which is the worst kind
of false signal.

### 2. The `/api/auth/[...path]` mount is required by every test and pinned nowhere

Every CUJ and every probe in all three checkpoints depends on a working session.
With `@neondatabase/auth`'s Next.js client, that requires a route handler at
`src/app/api/auth/[...path]/route.ts` exporting `auth.handler()`. The Ledgerly
prompts say only "use the project's managed email/password authentication
service", and the task bundle's `AI_RULES.md` note documents
`authClient.signUp.email(...)`, `signIn.email(...)`, `signOut()` and the
`createNeonAuth` server helper — but not the mount. Omitting it produces a
silent total failure: sign-up appears to run, nothing is logged server-side, and
the checkpoint scores 0.

This is **cross-app**, not Ledgerly-specific (all four references need the same
file), and it lives in the shared bundle note rather than in `specs/ledgerly/`,
so it is not a defect in this app's prompts. It is recorded here because it is
the single highest-leverage sentence that could be added to the bundle note, and
because a model that fails it loses an entire checkpoint to an SDK detail rather
than to anything the benchmark means to measure. Severity: **blocker** where it
bites.
