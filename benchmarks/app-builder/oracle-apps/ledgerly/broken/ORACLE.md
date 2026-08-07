# Ledgerly — oracle broken twin

A copy of `../reference/` (which scores 12/12, 20/20, 22/22) with
**seventeen controls deliberately removed**. It is the negative control of the
oracle: the reference proves the harness can score a correct app, and this twin
proves the harness can _catch_ an incorrect one.

The bar is per-checkpoint and per-probe, not per-app: **every security probe at
every checkpoint must fail here**. A probe that passes this twin has never been
demonstrated to detect anything and must be treated as unvalidated —
`preflight.sh` enforces exactly that and refuses to score model cells otherwise.

Everything else is untouched — same routes, same test ids, same UI, same
non-security behaviour — so a probe failure is attributable to a named defect
and nothing else.

## Scores

| Checkpoint | Reference | Broken twin | Probes tripped | Failing probes              |
| ---------- | --------- | ----------- | -------------- | --------------------------- |
| 1          | 12 / 12   | **9 / 12**  | 3 / 3          | `led-m1-s01` … `led-m1-s03` |
| 2          | 20 / 20   | **12 / 20** | 8 / 8          | `led-m2-s01` … `led-m2-s08` |
| 3          | 22 / 22   | **11 / 22** | 11 / 11        | `led-m3-s01` … `led-m3-s11` |

Every non-probe CUJ passes at all three checkpoints: the twin's deficit is
exactly the probe count (3, 8, 11). No collateral CUJ failures. Each checkpoint
was run twice consecutively with byte-identical failing lists, and again after
this file was added.

```bash
./oracle/run-suite.sh oracle/ledgerly/broken ledgerly 1 4150   # 9/12
./oracle/run-suite.sh oracle/ledgerly/broken ledgerly 2 4150   # 12/20
./oracle/run-suite.sh oracle/ledgerly/broken ledgerly 3 4150   # 11/22
```

## How the tree is laid out

Unlike the Relay CRM twin (a single working tree), this one carries the
reference's **whole git history** and three branches, each tagged:

| Branch      | Tag             | Contents                                    |
| ----------- | --------------- | ------------------------------------------- |
| `broken-m1` | `checkpoint-m1` | reference M1 + defects **L1 – L3**           |
| `broken-m2` | `checkpoint-m2` | reference M2 + defects **L3 – L10**          |
| `broken-m3` | `checkpoint-m3` | reference M3 + defects **L5, L7, L10 – L17** |
| `main`      | —               | the unmodified reference tip, for diffing    |

`run-suite.sh` checks out `checkpoint-m<N>` and leaves the tree on a detached
HEAD, so **run `git checkout broken-m<N>` before editing and `git tag -f
checkpoint-m<N>` after committing** — the scorer only ever sees the tag.

Each tree carries only the defects its own checkpoint's probes need; a milestone
is not a superset of the one before it. `git diff <reference-tag> broken-m<N>`
is the full diff, and `grep -rn "ORACLE-DEFECT" src/ schema.sql` is the
inventory on any branch.

## The defect table

| Defect  | Branch | Site(s)                                                                                                            | Class                                             | Probes tripped                           | Observed result                                                                                            |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **L1**  | m1     | `src/app/api/accounts/route.ts`                                                                                    | auth error swallowed → unscoped read              | `led-m1-s01`                             | anonymous `GET /api/accounts` → **200** with every user's chart                                             |
| **L2**  | m1     | `src/app/api/entries/[id]/route.ts`, `src/lib/entries.ts`                                                          | missing owner filter (IDOR)                       | `led-m1-s02`                             | outsider `GET /api/entries/{a}` → **200** carrying the memo and every line                                  |
| **L3**  | m1, m2 | `src/lib/entries.ts`, `schema.sql`                                                                                 | per-line entry rules dropped                      | `led-m1-s03`, `led-m2-s05`               | a line carrying **both** a 5000 debit and a 5000 credit → **201**, not 400                                  |
| **L4**  | m2     | `src/app/api/accounts/route.ts`, `src/lib/accounts.ts`                                                             | auth error swallowed → unscoped read              | `led-m2-s01`                             | anonymous `GET /api/accounts` → **200** with every book's chart _and balances_                              |
| **L5**  | m2, m3 | `src/lib/context.ts`, `src/lib/books.ts`                                                                           | trusts a client-supplied book id                  | `led-m2-s02`, `led-m3-s03`, `led-m3-s10` | `?bookId=` / `X-Book-Id:` naming a foreign book → **200** with its accounts, periods and audit trail        |
| **L6**  | m2     | `src/lib/context.ts`                                                                                               | stored active-book pointer trusted                | `led-m2-s03`                             | `POST /api/books/{B1}/activate` as a non-member → **200**, and the move sticks on the next request          |
| **L7**  | m2, m3 | `src/lib/entry-service.ts`, `src/lib/entries.ts`                                                                   | immutability guard removed                        | `led-m2-s04`, `led-m3-s04`               | `PATCH /api/entries/{posted}` → **200** and memo/date/lines really change; `DELETE` really deletes          |
| **L8**  | m2     | `src/lib/entry-service.ts`                                                                                         | line accounts not scoped to the book              | `led-m2-s06`                             | a balanced entry whose lines name **another book's** account ids → **201**                                  |
| **L9**  | m2     | `src/lib/entry-service.ts`, `src/lib/entries.ts`                                                                   | tenant derived from the record, not the session   | `led-m2-s07`, (`led-m2-s08`)             | outsider `POST /api/entries/{a}/reverse` → **201**; the reversal lands in the victim's book                 |
| **L10** | m2, m3 | `src/lib/context.ts`                                                                                               | role check is a no-op                             | `led-m3-s02`, (`led-m2-s08`)             | bookkeeper `POST /api/periods/{P}/close` → **200** where 403 is pinned                                      |
| **L11** | m3     | `src/lib/entry-service.ts`                                                                                         | period lock missing from four of five write paths | `led-m3-s01`                             | `POST /api/entries {status:'posted'}` dated inside a **closed** period → **201**                            |
| **L12** | m3     | `src/lib/entry-service.ts`, `src/lib/entries.ts`, `schema.sql`                                                     | create-as-posted skips numbering and the trail    | `led-m3-s07`                             | 36 create-as-posted entries all carry `entryNumber: null` and appended no `entry.posted` row                |
| **L13** | m3     | `src/lib/entries.ts`, `schema.sql`                                                                                 | illegal state-machine edge (reverse twice)        | `led-m3-s05`                             | a second `POST …/reverse` on the same entry → **201**; the touched account goes to `−125010`                |
| **L14** | m3     | `src/app/api/entries/[id]/reverse/route.ts`, `src/lib/context.ts`, `src/lib/entry-service.ts`, `src/lib/entries.ts` | reversal rebuilt from the request body            | `led-m3-s06`                             | the reversal takes the body's `date` (`2026-03-20`) and its `9999999`-cent line instead of mirroring        |
| **L15** | m3     | `src/app/api/audit/[id]/route.ts`, `schema.sql`                                                                    | append-only trail is mutable                      | `led-m3-s08`                             | `DELETE /api/audit/{id}` → **200**; `PATCH` rewrites `action`, `actorEmail`, `actorUserId` and `targetId`   |
| **L16** | m3     | `src/app/api/entries/[id]/post/route.ts`, `src/lib/entry-service.ts`                                               | actor read from the request body                  | `led-m3-s09`                             | the clerk's posting is filed in the trail under the **owner's** email and user id                           |
| **L17** | m3     | `src/lib/validate.ts`, `schema.sql`                                                                                | amount validation dropped                         | `led-m3-s11`                             | a line with `creditCents: -5000` → **201**, and the negative amount reaches the ledger                      |

### L1 / L4 — the accounts endpoint does not require a session → `led-m1-s01`, `led-m2-s01`

Resolving the caller (M1) or the caller and their active book (M2) is wrapped in
a `try` whose `catch` "degrades gracefully" to `listAllAccounts()` — an unscoped
read of the whole table — instead of answering 401. An authenticated caller
still gets exactly their own chart, which is why every list CUJ, the
book-isolation CUJ `led-m2-02` and the id-provenance helpers are unaffected.
Both probes' path lists start with `/api/me`, which still answers 401; they fail
on the next path.

### L2 — the entry detail read has no owner filter → `led-m1-s02`

`getEntryAnyOwner(id)` is a lookup by primary key with no `user_id` predicate,
so "does this entry exist" stands in for "may this caller see it". The session
is still required and still resolved; it is simply never compared with the
record. Same-owner requests behave identically, so `led-m1-06/07/08` and `s02`'s
own positive control are unaffected.

### L3 — the per-line entry rules are gone → `led-m1-s03`, `led-m2-s05`

M1 pins _"each line names one account and carries a debit and a credit, exactly
one of which is above zero"_ and _"two or more lines"_. Both rules — and the
`entry_lines_one_sided` CHECK that backed the first — are removed; only "total
debits equal total credits, and that total is above zero" survives. That is
deliberately the narrowest removal that trips the probes without touching a CUJ:
the probes' unbalanced and single-line shapes are still refused by the surviving
balance rule, so `led-m1-07` (an unbalanced entry submitted through the form,
expecting `entry-error`) still passes, and only shape (c) — a line carrying a
5000 debit _and_ a 5000 credit — is accepted.

### L5 — a client-supplied book id is honoured → `led-m2-s02`, `led-m3-s03`, `led-m3-s10`

`getLedgerContext` still resolves a book id from the query string, a header or
the body, but the membership test that gated it is gone: `bookAsGuest()` looks
the book up directly and returns a membership-shaped record, so nothing
downstream can tell the difference. `?bookId={foreign}` therefore answers with
that book's accounts, periods and audit rows instead of 403.

### L6 — the stored active-book pointer is trusted → `led-m2-s03`

Two halves, and the probe needs both. `POST /api/books/{id}/activate` resolves
the path id through the same (now-ungated) context, so activating a stranger's
book is a 200; and the _next_ request trusts whatever
`user_settings.active_book_id` says without re-checking membership, so the move
sticks. Authorization has become "what was this session last pointed at" rather
than "is this user a member of that book". `/api/me`'s `memberships` correctly
still excludes the book — which is exactly why the probe has to check the data
too.

### L7 — a posted entry is not immutable → `led-m2-s04`, `led-m3-s04`

`assertMutable(entry)` is gone from `patchEntryWrite` and `deleteEntryWrite`,
and the `status = 'draft'` predicates are gone from `updateEntry` and
`deleteEntry`, so the write really lands. The entry detail page still renders
`entry-edit-button` / `entry-delete-button` only for a draft (the component
branches on `status`), so `led-m2-05` — "a posted entry offers neither control"
— still passes and only the JSON API rewrites a posted entry.

### L8 — an entry's lines are not scoped to the book → `led-m2-s06`

`assertBookAccounts` is no longer called from either write path. An account id
is trusted because it exists, so a _balanced_ entry can pull another book's
accounts into its lines — precisely the shape `led-m2-s06` uses so that the
balance rule cannot be what rejects it.

### L9 — post and reverse take the tenant from the record → `led-m2-s07`

`bookOfEntry(entryId)` answers "which book is this entry in?" by primary key,
with no reference to the caller, and the posting and reversal handlers operate
in _that_ book. A session is still required; it is never compared with the
entry's book. Legitimate flows resolve to exactly `ctx.bookId`, so `led-m2-04`,
`led-m2-06` and `led-m2-s07`'s own positive control are unaffected.

### L10 — the owner-only check is a no-op → `led-m3-s02`, (`led-m2-s08`)

`requireOwner()` returns unconditionally. Every route still calls it, and both
`/books/[id]/members` and `/periods/[id]` still gate their controls on
`isOwner(ctx.role)` in the page, so the browser flow is unchanged — `led-m3-04`
("a bookkeeper sees periods read-only") still passes because the close and
reopen buttons are simply not rendered. Only the JSON API is open.

### L11 — the period lock is enforced on one write path out of five → `led-m3-s01`

`assertPeriodOpen` survives in `postEntryWrite` and nowhere else: create-as-
posted, reverse, draft-patch and draft-delete no longer ask whether the entry's
date falls inside a closed period. This is exactly the failure mode the app was
designed to measure — "a model that scatters `if (status === 'posted')` through
some handlers passes the UI CUJs and fails the probes". Because the pinned
`POST /api/entries/[id]/post` still checks, the UI-driven lock CUJs `led-m3-02`
and `led-m3-03` keep passing and only the API notices.

### L12 — create-as-posted is a second, unguarded write path → `led-m3-s07`

`POST /api/entries {status:"posted"}` no longer funnels through
`postEntryWrite`; it flips the row to `posted` itself
(`markPostedWithoutNumber`), so no number comes off the book's counter and no
`entry.posted` row reaches the trail. The `entries_number_iff_posted` CHECK is
dropped so the row is insertable. The pinned post endpoint still does both,
which is why every posting, numbering and audit CUJ is unaffected. See "What
this twin taught us" — this is _not_ the control `led-m3-s07` advertises.

### L13 — an entry can be reversed any number of times → `led-m3-s05`

"A reversal cannot itself be reversed" and "an entry may be reversed once" are
removed from `reverseEntryWrite`, from the `reverseEntry` statement's `WHERE`,
and from the schema (the partial unique index on `reverses_entry_id` is now an
ordinary index). "Only a posted entry can be reversed" is kept, so reversing a
draft is still 409 — the probe fails on its first leg, the second reversal of a
posted entry, which drives the touched account from `0` to `−125010`.

### L14 — a reversal is regenerated from the request body → `led-m3-s06`

The reverse route now parses the body (`mutateActiveBookWithBody`) and honours
its `lines` and `date` in place of the mirror derived from the stored original,
"because the caller is only correcting their own entry". The injected lines get
no balance rule, no line rule and no book-scoping check. The UI reverse button
sends no body and neither does `reverseEntryViaApi`, so `led-m2-06`,
`led-m3-05` and every legitimate reversal are unaffected.

`bookId` in that body is still ignored (the route resolves only the caller's own
active book), so the probe fails on `reversal.date` — `2026-03-20` from the body
where `2026-03-05` was stored — rather than on the cross-book assertion.

### L15 — the audit trail is an ordinary table → `led-m3-s08`

`src/app/api/audit/[id]/route.ts` exists at all — "so an administrator can fix a
mistyped trail entry" — exporting `PATCH`, `PUT` and `DELETE`, and the
`audit_log_no_mutate` trigger is dropped from `schema.sql` so the writes
succeed. The probe's first three attacks are still refused (the collection route
exports only `GET`, so `PATCH` / `PUT` / `DELETE /api/audit` are 405); it fails
on `DELETE /api/audit/{auditId}` → 200.

### L16 — the audit actor comes from the request body → `led-m3-s09`

`postEntryWrite` takes `actorUserId` / `actorEmail` from the body when they are
present and falls back to the session user otherwise. Every legitimate caller —
the detail page's post button, `postEntryViaApi` — sends no body, so `led-m3-05`
and `led-m3-06` (which asserts the _clerk's_ email on the clerk's own posting)
keep passing. Only a caller who names somebody else is believed.

### L17 — amounts are no longer validated → `led-m3-s11`

`wholeCents` keeps only "is this a finite number"; the "whole" and
"non-negative" rules are gone, and so are the `debit_cents >= 0` /
`credit_cents >= 0` CHECKs. M3's hardening list pins both. The probe's negative
shape balances (`10000` debit vs `-5000 + 15000` credit) and satisfies every M1
line rule, so only the amount rule could have rejected it — and it is created
instead.

## What this twin taught us about the probes

### 1. `led-m3-s07` cannot be tripped on the property it advertises

`led-m3-s07` is sold as the app's headline arithmetic probe: 36 postings, then
"both account balances and the enclosing period's totals equal integers the test
computed itself, and every monetary field satisfies `Number.isInteger`". Its
money assertions have **no independent detection power**, because the CUJs
already pin exact integers on amounts that drift just as badly under the naive
float implementation:

| Surface                    | Values                   | Naive `Σ(cents/100) × 100` | Pinned by             |
| -------------------------- | ------------------------ | -------------------------- | --------------------- |
| `led-m3-s07` balance/total | the 12-value cycle × 3   | `210000.0000000001`        | `led-m3-s07` (probe)  |
| `led-m3-08` Cash balance   | `1111, 2222, 4444, 8888` | `16664.999999999996`       | `led-m3-08` (**CUJ**) |
| `led-m3-01` period total   | `125010, 50010`          | `175019.99999999997`       | `led-m3-01` (**CUJ**) |

A float-money twin therefore fails `led-m3-01` and `led-m3-08` — non-probe CUJs
— before `s07` is ever reached, and the oracle contract ("every probe fails,
every CUJ passes") is unsatisfiable through that route. The mirror image is also
true: a _per-value_ round trip, `(c/100) × 100`, is exact for all twelve cycle
amounts but wrong for `125010` and `8010`, so it breaks `led-m1-06` /
`led-m1-08` while leaving `s07` green. And an implementation that stores float
dollars but rounds at the JSON boundary passes `s07` outright.

This twin therefore trips `s07` through its one remaining independent leg —
`expect(Number.isInteger(entry.entryNumber)).toBe(true)`, tripped by **L12** —
which is an entry-numbering control, not a money control. Verified: the probe's
reported failure is `Expected: true / Received: false`, while the twin's
balances and period totals are exactly `210000`.

**Fix the probe, not the twin.** Either (a) re-pick the CUJ fixture amounts so
their naive dollar sums land exactly (the design already re-derived every
constant by running it; the same treatment applied to `led-m3-01`'s and
`led-m3-08`'s values would make volume the _only_ thing that drifts), or
(b) accept that `s07`'s money legs are a CUJ-grade regression check and give the
probe an assertion no CUJ duplicates.

### 2. `led-m2-s08`'s role-check leg never runs

`led-m2-s08` bundles three attacks: (a) posting from the wrong active book,
(b) an outsider posting / reversing / creating in another book, and (c) a
**bookkeeper adding a member**, which is the only place the M2 suite exercises
the owner-only rule. Playwright aborts at the first failed assertion, and in
this twin leg (b)'s `POST /api/entries/{d}/reverse` answers 201 (defect **L9**),
so `expect(add.status()).toBe(403)` and the member-set re-read after it **never
execute**. The `requireOwner` no-op is independently demonstrated at checkpoint 3
by `led-m3-s02` (a bookkeeper's `close` → 200 where 403 is pinned), so the
_control_ is validated — but s08's own role assertion is not, and nothing else
at checkpoint 2 covers it.

**Fix:** run leg (c) first, or split the member-add role check into its own
probe, so a cross-book defect cannot mask the only M2 test of "only owners add
members".

### 3. Seven probes fail on a status assertion, so their leak assertions are unproven

`led-m1-s02`, `led-m1-s03`, `led-m2-s03`, `led-m2-s05`, `led-m2-s06`,
`led-m2-s07` and `led-m3-s11` all abort on a status code (a 200/201 where 4xx
was pinned) before their `not.toContain(...)` / re-read assertions run. The
leaks are real in each case — L2 does dump the memo, L17 does store `−5000` —
but those trailing assertions have no negative control here. They are cheap
insurance against an app that answers 4xx and leaks anyway; nothing in this twin
demonstrates they would catch it.

The probes that _do_ fail on an invariant rather than a status are
`led-m2-s02` and `led-m3-s03` (a non-zero `…Cents` in a foreign book's chart),
`led-m3-s04` and `led-m3-s08` (a re-read that differs from the captured
fingerprint), `led-m3-s06` (the reversal's `date`), `led-m3-s07`
(`Number.isInteger`), `led-m3-s09` (the trail's `actorEmail`) and `led-m3-s10`
(a foreign `actorEmail` in the body) — which is the dimension this app was
designed to add and the reason those are the strongest tests in the suite.

### 4. Two rules had to be enforced by the database as well as the code

Removing an application guard is not enough when the schema restates it: the
twin also had to drop `entry_lines_one_sided` (L3), `entries_number_iff_posted`
(L12), the partial unique index on `reverses_entry_id` (L13), the
`debit_cents >= 0` / `credit_cents >= 0` CHECKs (L17) and the
`audit_log_no_mutate` trigger (L15), or the defective write would have failed
with a constraint violation (a 500) rather than succeeding. That is a good sign
about the reference — defence in depth — and worth remembering when reading a
model's app: an app that answers 500 to these probes still fails them, but for a
different reason than an app that answers 201.
