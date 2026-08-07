# Curbside — oracle reference implementation

A reference build of **Curbside** that scores **100% on all three CUJ
checkpoints**. It exists so a scoring run can validate itself: if this app ever
scores below 100%, the harness (or its environment) is broken, not the app under
test.

## Final scores

| Checkpoint | Suite                                     | Result             |
| ---------- | ----------------------------------------- | ------------------ |
| 1          | `cuj-tests/curbside/checkpoint-1.spec.ts` | **13 / 13 passed** |
| 2          | `cuj-tests/curbside/checkpoint-2.spec.ts` | **20 / 20 passed** |
| 3          | `cuj-tests/curbside/checkpoint-3.spec.ts` | **22 / 22 passed** |

Verified repeatedly, not once: checkpoint 1 ran green three consecutive times,
checkpoint 2 three times and checkpoint 3 twice, each against its own tag. No
test in any suite was modified, and no assertion was satisfied by a shim.

`schema.sql` applies cleanly to an empty database and is idempotent on re-apply
(verified with two consecutive `psql -f` runs against a fresh database).

## How to run it

`neon-sim` must be running (see `../../neon-sim/README.md`). From
`benchmarks/app-builder/`:

```bash
./oracle/run-suite.sh oracle/curbside/reference curbside 1 4300   # 13/13
./oracle/run-suite.sh oracle/curbside/reference curbside 2 4300   # 20/20
./oracle/run-suite.sh oracle/curbside/reference curbside 3 4300   # 22/22
```

Add a 5th argument to grep a single test, e.g. `… curbside 3 4300 curb-m3-s02`.
Each invocation provisions a fresh project + database, applies `schema.sql`,
installs, builds, serves on the given port and runs that checkpoint's suite. The
server log path is printed at the end; runtime SQL/auth errors surface there.

**The `checkpoint-m1/2/3` tags are load-bearing.** `run-suite.sh` checks out the
tag for the checkpoint under test, so a fix that is committed but not re-tagged
is invisible to the scorer. After changing anything, re-run
`git tag -f checkpoint-mN` before scoring. Note also that `run-suite.sh` leaves
the tree on a **detached HEAD** at the tag it checked out; commit from there and
the commit does not land on `main` (`git reset --hard <sha>` on `main`
afterwards is the fix).

`schema.sql` is the whole story for the database. It contains only the app's own
`public` objects — `neon_auth` (`user`, `session`, `account`, `verification`) is
provisioned by the managed better-auth service when a branch's auth provider is
created, so including it would make the file fail to apply. The file ends with a
`DO` block that hands every table and sequence to the *database owner*: on a real
Neon branch the app's own role runs the DDL and owns the result, but the oracle
harness applies the file as an administrator, and without the handover the app's
role gets `permission denied for table …` on its first query. Nothing in the
file names a specific role, so it stays portable.

## How the app is built

Milestone by milestone, from `specs/curbside/m{1,2,3}.md` only. The shape that
matters for the judge rubric:

- **`src/lib/actor.ts`** — one server-side resolver. `currentActor()` returns
  `{ id, email, name, isMerchant, isCourier, restaurantIds }`, derived from the
  session and the database and never from a request body; `requireActor()`,
  `requireMerchant()` and `requireCourier()` are the only actor gates, used by
  every route handler and every server component. Nothing is authorized in a
  React component: pages check as well, but the API refuses independently.
- **`src/lib/lifecycle.ts`** — the state machine as a single source of truth.
  `EDGES` lists the six legal edges with the one actor kind each belongs to;
  `findEdge` answers "is this legal from here?", `mayDrive` answers "may this
  actor drive it?", and `nextEdgeFor` is what the merchant queue and the courier
  deliveries page use to decide which transition control to render. The UI
  therefore cannot offer an edge the server would refuse. `POST
  /api/orders/[id]/transition` checks legality **first** (409) and the actor
  **second** (403), so an illegal edge and a wrong actor are never confused.
- **`src/lib/money.ts`** — every amount is an integer number of cents, end to
  end: schema columns, API payloads, `data-cents` attributes. Tax is
  `floor((cents * 85 + 500) / 1000)` — half-up, all integers, no float ever holds
  a currency amount (1797 → 152.745 → **153**, where truncation would give 152).
  `priceOrder(subtotal, tip)` is the *only* place the breakdown is derived, and
  it is imported by both the server (`createOrder`) and the checkout component,
  so the preview and the written order cannot drift. The identity
  `subtotal + tax + fee + tip = total` is additionally enforced by a CHECK
  constraint on `orders`.
- **Claim atomicity** — `claimDelivery` is one conditional
  `UPDATE … WHERE id = $1 AND status = 'ready' AND courier_id IS NULL`, with the
  rows-affected count as the verdict. There is no read-then-write window; six
  simultaneous claims produce exactly one winner because the losers' `WHERE` is
  re-evaluated after the winner commits. A refused claim is distinguished
  correctly: not-a-courier is 403, already-claimed is 409.
- **Read surfaces** — `src/lib/orders.ts` has one `ORDER_QUERY` projection and
  four predicates over it (own orders, owned restaurants' orders, the unclaimed
  pool, this courier's deliveries). The same row is projected for three parties
  with the same shape and different scope; `serializeDelivery` deliberately omits
  the order's lines, which are readable only after a claim.

## Design decisions worth knowing

- **Order ids are uuids and `orders.seq` is a `bigserial`.** "Newest first" sorts
  on `seq`, not on `created_at`, so two orders placed inside the same millisecond
  still order deterministically.
- **`couriers.name`** captures the courier's display name at registration.
  `order-detail-courier` has to show *another* user's name, and the prompts pin
  `/api/me` as the caller's own identity only; reading the managed auth service's
  own `neon_auth.user` table from the app would be both unpinned and fragile, so
  the name is copied into the app's own schema at the moment the user opts in.
- **Client mutations always await the response before navigating or refreshing.**
  Every `fetch` in a client component resolves before `router.push`/
  `router.refresh` is called, so the render that follows always reads a database
  that has already committed the write. No read-your-writes barrier is needed
  (contrast Relay CRM, which needed one because it navigated in the same tick).
- **`order-cancel-button` is rendered at every status from M3 on** — M3 requires
  exactly that, so the server's 409 is observable in `order-cancel-error`. At M1
  and M2 it is rendered only while the order is cancellable, which is what those
  prompts describe.
- **`pnpm-workspace.yaml` sets `core-js: true` under `allowBuilds`.** Without it
  `pnpm install` exits non-zero with `ERR_PNPM_IGNORED_BUILDS` and
  `run-suite.sh` reports `install failed` before anything is built. The template
  ships the placeholder line that pnpm writes on the first install.

## SUSPECTED SUITE DEFECTS

None of these makes a suite unsatisfiable — the reference passes every row — but
each is a place the suite requires something the **prompt does not pin**, so a
spec-faithful model could lose the point without having done anything wrong.

1. **`curb-m3-05` requires the rating controls to stay rendered after the order
   has been rated.** `rateOrderViaUi` waits for `order-rate-stars` to be
   *visible* and then clicks `order-rate-submit` a second time, so an app that
   hides the rating form once `ratingStars` is set — a natural reading of "may
   rate it **once**", and the same instinct the prompt explicitly *overrides* for
   `order-cancel-button` ("keep `order-cancel-button` rendered and clickable …
   whatever the order's status: the rule lives on the server") — fails the row at
   the visibility check, before `order-rate-error` is ever consulted. The prompt
   spells the rule out for cancelling and is silent for rating. **This is the one
   worth fixing**: adding "keep the rating control rendered so the refusal is
   observable" to the M3 prompt costs a sentence and removes a trap.
2. **`curb-m2-05` asserts `order-detail-courier` contains the courier's full
   display name.** The prompt pins the test id and "the assigned courier's name",
   but never says where a display name that is not the caller's own may be
   obtained: `GET /api/me` is pinned as the caller's own identity and "never
   anything about anybody else", and the auth service's user table is not part of
   the app's schema. An app that stores only `courierId` (which the prompt *does*
   pin as the machine-readable surface) has to invent the name channel.
3. **Several rows require containment the test-id table does not state.**
   `curb-m1-04` scopes `restaurant-row` inside `restaurants-list`; `curb-m1-05`
   and `curb-m1-06` scope `menu-item-price` / `cart-line-name` inside their rows;
   the M2 rows scope `merchant-order-status`, `merchant-order-total` and
   `transition-*` inside `merchant-order-row`. The prompts list these ids in a
   flat table per surface and never pin the DOM nesting.
4. **`curb-m2-08` requires `merchant-orders-empty` and `my-deliveries-empty` to
   be absent for a user who lacks the actor type.** The prompt pins 403 "and no
   data" for *requests* and pins those ids as the queues' empty states, but never
   says the empty-state marker must not be drawn for a non-actor — an app that
   renders "no orders" to everybody and authorizes only the data would fail the
   row while leaking nothing.
