# Curbside — oracle broken twin

A copy of `../reference/` (which scores 13/13, 20/20, 22/22) with
**authorization, exclusivity and server-authoritative money deliberately
removed**. It is the negative control of the oracle: the reference proves the
harness can score a correct app, and this twin proves the harness can *catch*
an incorrect one.

The bar is per-checkpoint and per-probe, not per-app: **every security probe at
every checkpoint must fail here**. A probe that passes this twin has never been
demonstrated to detect anything and must be treated as unvalidated —
`preflight.sh` enforces exactly that and refuses to score model cells otherwise.

Everything else is untouched — same `schema.sql`, same UI, same non-security
behaviour — so a probe failure is attributable to a named defect and nothing
else.

## Scores

| Checkpoint | Reference | Broken twin | Probes tripped | Failing probes                |
| ---------- | --------- | ----------- | -------------- | ----------------------------- |
| 1          | 13 / 13   | **10 / 13** | 3 / 3          | `curb-m1-s01` … `curb-m1-s03` |
| 2          | 20 / 20   | **12 / 20** | 8 / 8          | `curb-m2-s01` … `curb-m2-s08` |
| 3          | 22 / 22   | **12 / 22** | 10 / 10        | `curb-m3-s01` … `curb-m3-s10` |

Every non-probe CUJ passes at all three checkpoints: the twin's deficit is
exactly the probe count (3, 8, 10). No collateral CUJ failures.

```bash
./oracle/run-suite.sh oracle/curbside/broken curbside 1 4350   # 10/13
./oracle/run-suite.sh oracle/curbside/broken curbside 2 4350   # 12/20
./oracle/run-suite.sh oracle/curbside/broken curbside 3 4350   # 12/22
```

**The `checkpoint-m1/2/3` tags are load-bearing and this tree does not have a
linear history.** Each checkpoint is a branch of its own (`broken-m1`,
`broken-m2`, `broken-m3`) forked from the reference's own tag for that
milestone, because the milestone's code — and therefore where each control
lives — differs. After changing anything, commit **on that milestone's branch**
and re-run `git tag -f checkpoint-mN` before scoring; an untagged fix is
invisible to the scorer. `run-suite.sh` leaves the tree on a detached HEAD at
the tag it checked out.

## The defect table

`grep -rn "ORACLE-DEFECT" src/` is the full inventory; every site carries its
defect id and the probes it is meant to trip. Defects are cumulative — the M2
branch carries D1–D3 and the M3 branch carries D1–D10 — so the twin reads as
one app that was built badly, not three.

| Defect  | Site(s)                                                                    | Class                                   | Probes tripped                              | Observed result                                                                           |
| ------- | -------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **D1**  | `src/app/api/orders/route.ts`, `src/lib/orders.ts` (`listAllOrders`)        | auth error swallowed → unscoped read     | `curb-m1-s01`                               | anonymous `GET /api/orders` → **200** with every order in the database                    |
| **D2**  | `src/lib/orders.ts` (`canReadOrder`), `src/app/(app)/orders/[id]/page.tsx`  | authorizes by existence, not ownership   | `curb-m1-s02`, `curb-m2-s06`, `curb-m3-s09` | any signed-in caller holding an order id reads it, in JSON **and** on the HTML page       |
| **D3**  | `src/lib/orders.ts` (`declaredCents`, `parseCart`, `createOrder`)           | client-supplied money trusted            | `curb-m1-s03`, `curb-m3-s05`                | a forged `subtotalCents` is stored verbatim (`1797` → **1**)                               |
| **D4**  | `src/lib/actor.ts` (`requireMerchant`, `requireCourier`)                    | actor-type check is a no-op              | `curb-m2-s01`                               | a plain customer gets **200** from `/api/merchant/orders` and both courier lists          |
| **D5**  | `src/lib/lifecycle.ts` (`mayDrive`, merchant case)                          | restaurant ownership not checked         | `curb-m2-s02`                               | a foreign merchant drives `placed → accepted` on another merchant's order → **200**       |
| **D6**  | `src/lib/lifecycle.ts` (`mayDrive`, merchant case)                          | actor kinds conflated                    | `curb-m2-s03`                               | a courier drives the kitchen's `accepted → preparing` → **200**                           |
| **D7**  | `src/lib/lifecycle.ts` (`mayDrive`, courier case)                           | actor kinds conflated                    | `curb-m2-s04`                               | the order's customer drives `ready → picked_up` → **200**                                 |
| **D8**  | `src/lib/lifecycle.ts` (`mayDrive`, courier case)                           | "which courier claimed it" not checked   | `curb-m2-s05`                               | a non-claiming courier drives `ready → picked_up` → **200**                               |
| **D9**  | `src/app/api/merchant/orders/route.ts`                                      | auth error swallowed → unscoped read     | `curb-m2-s07`                               | anonymous `GET /api/merchant/orders` → **200** with every order                           |
| **D10** | `src/lib/lifecycle.ts` (`findEdge`)                                         | the state machine takes an illegal edge  | `curb-m2-s08`                               | the owning merchant's `placed → ready` → **200** instead of 409                           |
| **D11** | `src/lib/orders.ts` (`claimDelivery`)                                       | read-then-write with no exclusivity      | `curb-m3-s01`, `curb-m3-s02`                | a second claim → **200** and takes the delivery over; six concurrent claims → six **200** |
| **D12** | `src/app/api/orders/[id]/cancel/route.ts`                                   | refusal answered **200**                 | `curb-m3-s03`                               | cancelling an `accepted` order → **200** `{ok:false,error}`; nothing changes              |
| **D13** | `src/lib/orders.ts` (`cancelOwnOrder`)                                      | ownership check dropped                  | `curb-m3-s04`                               | a second customer cancels somebody else's `placed` order → **200**, order `cancelled`     |
| **D14** | `src/lib/orders.ts` (`rateOwnOrder`)                                        | state rule dropped                       | `curb-m3-s06`                               | rating a `picked_up` order → **200** and the stars are stored                             |
| **D15** | `src/lib/orders.ts` (`rateOwnOrder`)                                        | ownership check dropped                  | `curb-m3-s07`                               | a second customer rates somebody else's delivered order → **200**                         |
| **D16** | `src/app/api/orders/[id]/rate/route.ts`                                     | refusal answered **200**                 | `curb-m3-s08`                               | re-rating a rated order → **200** `{ok:false,error}`; the original rating stands          |
| **D17** | `src/lib/orders.ts` (`parseCart`, `createOrder`)                            | trusts client-supplied ownership fields  | `curb-m3-s10`                               | `POST /api/orders {status:'delivered', courierId, customerId}` is stored verbatim         |

### D1 — the order list does not require a session → `curb-m1-s01`

`GET /api/orders` treats resolving the caller as best-effort: with no session it
"degrades gracefully" to `listAllOrders()` — an unscoped read of the whole table
— instead of answering 401. Authenticated callers still get exactly their own
orders, so every list CUJ and the isolation CUJ `curb-m1-10` are unaffected.

### D2 — the order read authorizes by existence → `curb-m1-s02`, `curb-m2-s06`, `curb-m3-s09`

`canReadOrder` returns true for any signed-in caller. The classic capability-URL
argument ("order ids are unguessable uuids and the lists only ever show you your
own"), so authorization lives entirely in which ids the UI shows you. The
session is still required and still resolved; it is simply never compared with
the order's customer or claiming courier. Both `GET /api/orders/[id]` and the
`/orders/[id]` page consume it, which is why the JSON probes and the HTML-page
probe `curb-m3-s09` all trip on one defect. At M1 the same defect lives in
`requireReadableOrder`, which the milestone-1 tree introduces for that route.

### D3 — the server trusts money the client sent → `curb-m1-s03`, `curb-m3-s05`

`declaredCents` accepts any whole, non-negative cent amount out of the request
body and `createOrder` prefers it to the price it computed from the menu. The
lines are still priced from `menu_items` and the total is still *derived*
(`subtotal + tax + fee + tip`), so the stored row still satisfies the M3 CHECK
constraint and nothing looks corrupt — the order simply costs what the caller
said it did. The checkout posts only `{restaurantId, items, tipCents}`, so every
pricing CUJ (`curb-m3-01`, `curb-m3-02`, the `1797`/`153`/`299` fixtures) still
passes.

### D4 — the actor-type gates are no-ops → `curb-m2-s01`

`requireMerchant()` and `requireCourier()` return unconditionally. The header
still hides `nav-merchant`/`nav-courier` and every page still checks
`actor.isMerchant`/`actor.isCourier` for itself, so `curb-m2-08` (a fresh
customer reaches neither queue) still passes and the app looks correct in a
browser — only the JSON API is open. The reads behind them are still scoped by
the caller's own id, so what leaks is the *entitlement*, and for the courier
pool the contents of the pool.

### D5–D8 — four actor checks removed from the transition matrix

`mayDrive` is the one place the M2 prompt's "who may do it" column is enforced,
so the twin takes it apart one clause at a time. Each probe is staged on an edge
that is **legal from the order's current state**, so nothing but the actor check
can refuse it — the design's whole point, and why four separate defects are
needed rather than one:

- **D5** accepts being *a* merchant as being *this restaurant's* merchant.
- **D6** lets a registered courier drive the kitchen's edges.
- **D7** lets the order's own customer drive the claiming courier's edges.
- **D8** lets any registered courier drive them, whoever actually claimed it.

The legitimate flows are unchanged, so `curb-m2-02`, `curb-m2-05`, `curb-m2-06`
and every `deliverOrder`-based M3 scenario keep passing.

### D9 — the merchant queue does not require a session → `curb-m2-s07`

The same shape as D1, on the merchant surface: an unidentifiable caller gets the
whole order table rather than a 401 (the "kitchen display runs without a login"
shortcut). An authenticated merchant still gets only their own restaurants'
orders, so `curb-m2-01` and the isolation CUJ `curb-m2-07` are unaffected.

### D10 — the state machine takes an illegal edge → `curb-m2-s08`

`findEdge` falls back to synthesizing an edge whenever the requested status is
*later* in the progression than the current one, attributing it to whichever
actor kind owns that status. An order may therefore skip `accepted` and
`preparing` and go straight to `ready`. `cancelled` is not on the progression,
so cancellation is untouched — `curb-m3-s03` is tripped by D12, not by this.
`nextEdgeFor` is not touched either, so the UI still offers exactly the legal
edges and every transition CUJ still passes.

### D11 — the claim is a read-then-write with no exclusivity → `curb-m3-s01`, `curb-m3-s02`

`claimDelivery` reads the order, checks it is `ready`, and then issues
`UPDATE orders SET courier_id = … WHERE id = …` — no `courier_id IS NULL`
predicate, no rows-affected verdict, no "already claimed" refusal. The rationale
is the plausible one ("assigning the newest courier is what you want when a
courier re-taps the button"). A single claim is unchanged, so `curb-m2-05`,
`curb-m3-08` and every `deliverOrder` scenario still pass.

### D12 / D16 — a refusal is reported as 200 → `curb-m3-s03`, `curb-m3-s08`

The rule still fires and nothing is written, but the route catches its own 409
and answers **200** with `{ ok: false, error }`. The client components read the
body as well as the status, so `order-cancel-error` and `order-rate-error` still
carry the server's message and the CUJs that observe those elements
(`curb-m3-03`, `curb-m3-05`) still pass — only an API client is told the request
succeeded.

This is deliberate, and it is the only defect shape that trips these two probes
without also failing a CUJ: `curb-m3-03` and `curb-m3-05` assert the *same
invariants* as `curb-m3-s03` and `curb-m3-s08` through the UI. See "What this
twin taught us", point 2.

### D13 / D15 — cancel and rate authorize by existence → `curb-m3-s04`, `curb-m3-s07`

The same reasoning as D2, applied to the two writes a customer owns:
`cancelOwnOrder` and `rateOwnOrder` look the order up by primary key and never
compare `customer_id` with the session (the UPDATE predicates lose it too). The
owner's own flows are identical, so `curb-m3-03`, `curb-m3-04`, `curb-m3-05` and
`curb-m3-06` are unaffected.

### D14 — rating ignores the order's status → `curb-m3-s06`

"Only a delivered order can be rated" is gone from both the check and the
UPDATE's predicate. Rating a delivered order is unchanged, so `curb-m3-04`,
`curb-m3-05` and the average-rating CUJ `curb-m3-06` still pass.

### D17 — the create endpoint trusts ownership fields → `curb-m3-s10`

`parseCart` reads `status`, `courierId` and `customerId` out of the request body
and `createOrder` writes them. A customer can therefore post an order that is
born `delivered`, assigned to a named courier, and owned by somebody else. The
checkout never sends those fields, so every ordering CUJ is unaffected.

## What this twin taught us about the probes

1. **Every one of the 21 probes fails on the assertion it advertises.** The
   observed failures are: `curb-m1-s01` on the `GET /api/orders` status, `s02` on
   the non-owner read status, `s03` on `subtotalCents 1797 → 3`; `curb-m2-s01`
   … `s08` each on their own status assertion; `curb-m3-s01`…`s08` and `s10` on a
   status or a stored value, and `curb-m3-s09` on its **body** assertion (the
   victim's `Margherita …` rendered in the outsider's HTML). No probe is carried
   by an unrelated business rule, which is the failure mode `crm-m3-s03`
   exhibited in Relay CRM.

2. **`curb-m3-s03` and `curb-m3-s08` overlap with CUJs `curb-m3-03` and
   `curb-m3-05`, so only their status assertion has a negative control.** The
   CUJs assert, through the UI, exactly what the probes assert through the API:
   the refusal is visible and the record did not change. Any defect that lets the
   *write* through therefore fails a non-probe CUJ, which the twin is not allowed
   to do. D12/D16 resolve this by breaking only the status code — so the probes'
   `status` / `ratingStars` re-reads are **not** exercised by this control. An app
   that answered 409 and cancelled (or re-rated) anyway would be caught by the
   CUJ, but not demonstrably by the probe.

3. **`curb-m3-s02`'s concurrency-specific property is not independently
   validated.** D11 removes exclusivity outright, so the six-way burst fails for
   the same reason the sequential `curb-m3-s01` does. A twin that kept the
   "already claimed → 409" check but performed a `SELECT` followed by an
   unguarded `UPDATE` would pass `s01` and only sometimes fail `s02`; that variant
   is deliberately not built here, because a probe whose negative control is a
   race is not a deterministic control. `s02` is therefore validated as "a claim
   with no exclusivity at all is caught", not as "a check-then-write race is
   caught".

4. **Several multi-leg probes abort on their first leg, leaving the rest
   unexercised.** `curb-m1-s01` never gets past `GET /api/orders` (its
   `/api/orders/[id]` and cancel legs are untested); `curb-m1-s02`'s cancel and
   HTML legs, `curb-m2-s02`'s queue-scoping assertions, `curb-m2-s05`'s read leg,
   `curb-m2-s07`'s transition and claim legs, and `curb-m3-s05`'s three
   validation legs all pass or never run. Each of those properties is covered
   elsewhere (D2 covers the reads, `curb-m2-07` covers queue scoping), but the
   assertions themselves have no negative control in this twin.

5. **The probes' "no leak" body assertions are almost never reached.** As in
   Relay CRM, most API probes answer with the wrong *status* first, so
   `expectNoIdLeak` and the email / dish-name checks abort early. `curb-m3-s09` is
   the exception and the reassuring one: a 200 HTML page is permitted by that
   probe, so its verdict is carried entirely by the body — and it fires.

6. **`curb-m2-s01`'s "401 is acceptable only if `/api/me` is 200" guard works as
   designed.** With D4 the plain customer's session is live and `/api/me` answers
   200, so the probe demands 403 and gets 200 — it cannot be satisfied by an app
   that simply signs everybody out.
