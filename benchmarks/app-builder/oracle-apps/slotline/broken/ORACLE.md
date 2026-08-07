# Slotline — oracle broken twin

A copy of `../reference/` (which scores 13/13, 20/20, 22/22) with
**authorization, the write-time slot re-check and the temporal policy
deliberately removed**. It is the negative control of the oracle: the reference
proves the harness can score a correct app, and this twin proves the harness can
_catch_ an incorrect one.

The bar is per-checkpoint and per-probe, not per-app: **every security probe at
every checkpoint must fail here**. A probe that passes this twin has never been
demonstrated to detect anything and must be treated as unvalidated —
`preflight.sh` enforces exactly that and refuses to score model cells otherwise.

Everything else is untouched — same UI, same slot generator, same clinic-time
handling, same non-security behaviour — so a probe failure is attributable to a
named defect and nothing else. `schema.sql` differs from the reference's in
exactly one place (the `bookings_no_overlap` exclusion constraint is gone) and
that removal is itself a named defect.

## Scores

| Checkpoint | Reference | Broken twin | Probes tripped | Failing probes                |
| ---------- | --------- | ----------- | -------------- | ----------------------------- |
| 1          | 13 / 13   | **10 / 13** | 3 / 3          | `slot-m1-s01` … `slot-m1-s03` |
| 2          | 20 / 20   | **12 / 20** | 8 / 8          | `slot-m2-s01` … `slot-m2-s08` |
| 3          | 22 / 22   | **12 / 22** | 10 / 10        | `slot-m3-s01` … `slot-m3-s10` |

Every non-probe CUJ passes at all three checkpoints: the twin's deficit is
exactly the probe count (3, 8, 10). No collateral CUJ failures.

```bash
./oracle/run-suite.sh oracle/slotline/broken slotline 1 4250   # 10/13
./oracle/run-suite.sh oracle/slotline/broken slotline 2 4250   # 12/20
./oracle/run-suite.sh oracle/slotline/broken slotline 3 4250   # 12/22
```

## Repository shape

Milestones legitimately change behaviour, so each checkpoint is a **separate
branch** forked from the corresponding reference commit, and each carries only
the defects its own checkpoint's probes need (probes are never re-run as
regressions across checkpoints — only CUJs are):

| Branch      | Tag             | Defects         |
| ----------- | --------------- | --------------- |
| `broken-m1` | `checkpoint-m1` | `D1`–`D3`       |
| `broken-m2` | `checkpoint-m2` | `Dm2-A`–`Dm2-F` |
| `broken-m3` | `checkpoint-m3` | `Em3-1`–`Em3-9` |

`run-suite.sh` checks out `checkpoint-m<N>`, so **an untagged fix is invisible to
the scorer**: after every change re-tag with `git tag -f checkpoint-m<N>`.

`grep -rn "ORACLE-DEFECT" src/ schema.sql` on each branch is the full inventory;
every site carries its defect id and the probes it is meant to trip.

## Checkpoint 1 — the defect table

| Defect | Site(s)                                                                         | Class                                        | Probe         | Observed result                                                                                            |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| **D1** | `src/lib/http.ts` (`openRoute`), `src/app/api/{practitioners,services}/route.ts` | a read is served without a session           | `slot-m1-s01` | unauthenticated `GET /api/practitioners` → **200** listing `Dr Vale ${TOKEN}`                              |
| **D2** | `src/lib/queries.ts` (`getBookingForPatient`)                                   | possession of an id treated as authorization | `slot-m1-s02` | patientB `GET /api/bookings/{aId}` → **200** with patientA's booking                                       |
| **D3** | `src/lib/booking-service.ts`, `src/lib/queries.ts` (`insertBooking`)             | client-supplied fields trusted on create     | `slot-m1-s03` | a create carrying `patientId`/`endAt`/`status` files an 8-hour cancelled booking in another patient's name |

### D1 — the clinic catalogue is public → `slot-m1-s01`

"Practitioners and services are clinic-wide reference data, so the two list
endpoints do not need a session." They are served through `openRoute`, which
skips `sessionUser()` entirely, so an anonymous caller gets 200 and the
practitioner names instead of 401 with no data. Every page still redirects a
signed-out visitor, so `slot-m1-03` (the signed-out routes CUJ) still passes;
only the JSON API is open.

### D2 — a booking id is treated as authorization → `slot-m1-s02`

`getBookingForPatient(id, patientId)` no longer puts `patient_id` in the SELECT.
Every per-booking route — `GET`, `PATCH`, `DELETE` and `/cancel` — funnels
through it, so any signed-in patient holding a leaked id can read, move, cancel
and delete a stranger's appointment. `GET /api/bookings` (the list) is still
owner-scoped, which is why `slot-m1-10` still passes.

### D3 — the create body is trusted → `slot-m1-s03`

`resolveBookingRequest` now reads `endAt`, `status` and `patientId` from the
request body and falls back to the server's values only when they are absent.
The pinned UI never sends any of the three, so `slot-m1-06`/`07`/`09` are
unaffected; a crafted create books an 8-hour, already-cancelled appointment
owned by somebody else.

## Checkpoint 2 — the defect table

| Defect    | Site(s)                                                                     | Class                                        | Probes                                      | Observed result                                                            |
| --------- | --------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| **Dm2-A** | `src/lib/slots.ts` (`assertStartWithinWindow`)                              | write-time check weaker than the generator   | `slot-m2-s01`                               | `POST /api/bookings` at clinic 09:07 → **201**                             |
| **Dm2-B** | same function (no future check)                                             | a temporal rule dropped                      | `slot-m2-s02`                               | a booking on `PAST_DATE` → **201**                                         |
| **Dm2-C** | same function (no overlap check) + `schema.sql`                             | the atomicity guarantee removed              | `slot-m2-s03`, `slot-m2-s04`, `slot-m2-s05` | the same slot is sold twice; a 30-minute start lands inside a 60-minute one |
| **Dm2-D** | `src/lib/queries.ts` (`getBookingForPatient`)                               | possession of an id treated as authorization | `slot-m2-s06`                               | patientB `GET /api/bookings/{aId}` → **200**                               |
| **Dm2-E** | `src/app/api/practitioners/[id]/bookings/route.ts`                          | the role check skipped                       | `slot-m2-s07`                               | a patient reads a practitioner's whole day, names and emails included      |
| **Dm2-F** | `src/lib/roles.ts` (`syncRoleFromRequest`), `src/app/api/bookings/route.ts` | a role writable from a request body          | `slot-m2-s08`                               | a booking body carrying `role:"staff"` promotes the caller                 |

### Dm2-A/B/C — the create path stops asking the generator

`createBooking` calls `assertStartWithinWindow` instead of `assertSlotOffered`.
The relaxed rule asks only "does this start fall inside one of the
practitioner's windows for that weekday?", which drops three separate controls
at once: the grid and fit rules (**Dm2-A**), the "starts in the future" rule
(**Dm2-B**) and the overlap rule (**Dm2-C**, together with the removal of the
`bookings_no_overlap` exclusion constraint from `schema.sql`, so nothing below
the application enforces it either).

`GET /api/slots`, `/bookings/new` and the reschedule path all still use the real
generator, so every offered slot is still correct and `slot-m2-03`…`slot-m2-08`
all still pass. Only a crafted `POST /api/bookings` can tell offered from
accepted.

### Dm2-D — see D2. The same removal, in the same file, at the M2 tree.

### Dm2-E — the day view has no role check → `slot-m2-s07`

`requireStaff(ctx)` is gone from `GET /api/practitioners/[id]/bookings`: "it is
read-only, and the staff navigation is hidden from patients anyway."
Authorization lives entirely in which links the UI renders. The four
clinic-data write legs of `slot-m2-s07` are deliberately left guarded so the
probe's failure is attributable to this one removal (see the coverage note
below).

### Dm2-F — a role can be smuggled through a booking → `slot-m2-s08`

`POST /api/bookings` calls `syncRoleFromRequest(user.id, body.role)` to "keep
the stored role record in sync with what the client says". `/api/staff/claim`
still demands the correct access code, and `/api/me` still reports only the
caller — so the first three legs of the probe still pass — but an ordinary
booking body promotes the caller to staff.

## Checkpoint 3 — the defect table

| Defect    | Site(s)                                                          | Class                                       | Probes                       | Observed result                                                            |
| --------- | ---------------------------------------------------------------- | ------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| **Em3-1** | `src/lib/policy.ts` (`assertChangeable`)                         | a temporal policy skipped on the server     | `slot-m3-s01`                | a patient cancels a booking 9 hours away → **200**                         |
| **Em3-2** | `src/lib/booking-service.ts` (`loadActionableBooking`)            | ownership check removed                     | `slot-m3-s02`                | patientB cancels patientA's booking → **200**                              |
| **Em3-3** | `src/lib/slots.ts` (`assertStartWithinWindow`)                    | reschedule validated by a looser rule       | `slot-m3-s03`                | a reschedule to clinic 09:07 / to the past → **200**                       |
| **Em3-4** | same function (no overlap check) + `schema.sql`                   | the atomicity guarantee removed             | `slot-m3-s04`, `slot-m3-s06` | two bookings moved onto the same instant, both **200**                     |
| **Em3-5** | `src/app/api/bookings/[id]/reschedule/route.ts`                   | the window judged against the wrong instant | `slot-m3-s05`                | a booking starting tomorrow is moved freely because its target is far away |
| **Em3-6** | `src/app/api/bookings/[id]/{no-show,complete}/route.ts`           | the role check skipped                      | `slot-m3-s07`                | a patient marks a booking `no_show` → **200**                              |
| **Em3-7** | `src/app/api/practitioners/[id]/bookings/route.ts`                | the role check skipped                      | `slot-m3-s08`                | a patient reads a practitioner's day with names and emails                 |
| **Em3-8** | `src/app/api/bookings/[id]/route.ts`, `src/lib/queries.ts`        | client-supplied fields trusted on update    | `slot-m3-s09`                | a `PATCH` re-homes a booking to another patient, practitioner and service  |
| **Em3-9** | `src/lib/policy.ts` (`isChangeable`)                              | the state machine takes an illegal edge     | `slot-m3-s10`                | a `cancelled` booking is cancelled again and rescheduled back to life      |

### Em3-1 — the cancellation window is a reschedule-only rule → `slot-m3-s01`

`assertChangeable` returns before the window check for every action but
`reschedule`: "giving a slot back is always welcome, and the detail page already
hides the button." `patientMayChange` — what the UI asks — is untouched, so
`slot-m3-02` (the control is hidden inside the window) still passes and only the
server disagrees with itself.

### Em3-2 — see D2/Dm2-D, at the one gate M3 funnels every per-booking route through

`loadActionableBooking` drops the patient branch and always uses
`getBookingAnyOwner`, so read, PATCH, delete, cancel, reschedule and
`excludeBookingId` all accept a leaked id as authorization.

### Em3-3/Em3-4 — the reschedule path stops asking the generator

The mirror image of Dm2-A/C, one milestone later and on the move path: grid,
fit and past-date rules gone (**Em3-3**), overlap rule and exclusion constraint
gone (**Em3-4**). `POST /api/bookings` at M3 is left correct, which is what
keeps `slot-m3-01`, `slot-m2-04` and `slot-m2-05` passing and makes the failure
attributable to the reschedule path alone.

### Em3-5 — the window is applied to the destination → `slot-m3-s05`

The reschedule route builds a synthetic booking whose `start_at` is the
**requested** start and asks the policy about that, so the 48-hour notice is
measured from where the appointment is going rather than from where it is. A
booking nine hours away can be moved at will as long as its target is far
enough out — precisely the notice the rule exists to protect.

### Em3-6 — marking is authorized by access, not by role → `slot-m3-s07`

`requireStaff(ctx)` is gone from `/no-show` and `/complete`: "they are only
reachable from the staff schedule." Combined with Em3-2, any signed-in patient
can mark any booking.

### Em3-7 — see Dm2-E, at the M3 tree

### Em3-8 — the update body is trusted → `slot-m3-s09`

`PATCH /api/bookings/[id]` copies `practitionerId`, `serviceId`, `patientId`,
`endAt` and `status` out of the request body onto the row via
`applyBookingPatch` — "the editor sends the whole record back". The milestone
pins the exact opposite. No UI surface sends those fields, so every CUJ is
unaffected.

### Em3-9 — `cancelled` is no longer terminal → `slot-m3-s10`

`isChangeable` becomes `status !== "completed" && status !== "no_show"`, so the
state machine takes an edge M3 forbids: a cancelled booking can be cancelled
again, rescheduled, and patched back to `booked`. `completed` and `no_show`
remain terminal, which is why `slot-m3-07` (a patient cancelling a booking staff
marked `no_show` must get 409) still passes.

## What this twin says about the probes

Every one of the 21 probes tripped, and — read from the failure message of each
scoring run — **each tripped on its own control**, at the first assertion that
exercises it:

| Probe         | The assertion that fired                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `slot-m1-s01` | unauthenticated `GET /api/practitioners` (got 200)                        |
| `slot-m1-s02` | patientB `GET /api/bookings/{aId}` (got 200)                              |
| `slot-m1-s03` | "the accepted booking is in patientA's list" — it was filed under patientB |
| `slot-m2-s01` | `POST /api/bookings` at clinic 09:07 (got 201)                            |
| `slot-m2-s02` | `POST /api/bookings` on `PAST_DATE` (got 201)                             |
| `slot-m2-s03` | patientB POSTing patientA's 10:00 slot (got 201)                          |
| `slot-m2-s04` | the identical second POST for clinic 11:00 (got 201)                      |
| `slot-m2-s05` | a 30-minute start inside a 60-minute booking (got 201)                    |
| `slot-m2-s06` | patientB `GET /api/bookings/{aId}` (got 200)                              |
| `slot-m2-s07` | patientB `GET /api/practitioners/{id}/bookings` (got 200)                 |
| `slot-m2-s08` | `/api/me` reports `staff` after the smuggled-role booking                 |
| `slot-m3-s01` | `POST /api/bookings/{nearId}/cancel` (got 200)                            |
| `slot-m3-s02` | patientB cancelling patientA's booking (got 200)                          |
| `slot-m3-s03` | reschedule to 09:07 (got 200)                                             |
| `slot-m3-s04` | reschedule onto another patient's booking (got 200)                       |
| `slot-m3-s05` | reschedule of an in-window booking (got 200)                              |
| `slot-m3-s06` | the second reschedule onto 11:00 (got 200)                                |
| `slot-m3-s07` | patientA's own `no-show` answered 200 and the day list says `no_show`     |
| `slot-m3-s08` | patientB `GET /api/practitioners/{id}/bookings` (got 200)                 |
| `slot-m3-s09` | after the forged PATCH the booking's owner is patientB                    |
| `slot-m3-s10` | cancelling an already-cancelled booking (got 200)                         |

Three coverage notes. None is a probe defect — every probe detected what it
claims to — but they are what this twin does _not_ prove:

1. **Seventeen of the twenty-one failures land on a status assertion.** The
   trailing leak assertions (`expectNoLeak`, `expectNoBookingLeak`), the
   read-back assertions and the positive controls of those probes never ran
   against this twin, so they have no negative control here. They are cheap
   insurance against an app that answers 403 and leaks anyway — nothing in this
   twin demonstrates they would catch it. The four exceptions, which fail on a
   body or read-back assertion, are `slot-m1-s03`, `slot-m2-s08`, `slot-m3-s07`
   and `slot-m3-s09`.
2. **Multi-leg probes are validated on one leg only.** `slot-m2-s07` fails on
   its day-list leg while its four clinic-data write legs stay guarded (that is
   deliberate: making `requireStaff` a global no-op would also trip
   `slot-m2-s08`'s follow-up leg and destroy attribution). Likewise
   `slot-m3-s01` fails on its cancel leg, so its `PATCH`-status and `DELETE`
   legs are unexercised, and `slot-m2-s01`/`slot-m3-s03` fail on their first
   crafted instant, so the "entirely after the window" and "does not fit before
   the window ends" legs never run. A variant twin that removes one leg's
   control at a time would close these gaps.
3. **`slot-m2-s05`'s interval-vs-exact-start discrimination is not separately
   exercised.** Dm2-C removes the overlap check outright rather than downgrading
   it to a unique index on `(practitioner_id, start_at)`, so this twin proves
   s05 catches "no overlap check at all" but not the narrower "exact-start
   uniqueness only" implementation the design says it exists to catch (that
   narrower defect is the one `slot-m2-s03` and `slot-m2-s04` would _not_
   catch). A variant twin with an exact-start check is the way to validate it.

## Building it again from scratch

1. `cp -R ../reference ../broken` (history included, so the tags come along).
2. `git branch broken-m1 <m1-sha>; git branch broken-m2 <m2-sha>; git branch broken-m3 <m3-sha>`.
3. On each branch, apply that checkpoint's defects, commit, and
   `git tag -f checkpoint-m<N>`.
4. `./oracle/run-suite.sh oracle/slotline/broken slotline <N> 4250` — the pass
   count must be exactly the CUJ count, and the failing list exactly the probe
   ids.
