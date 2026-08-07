# Slotline — oracle reference implementation

A reference build of **Slotline** that scores **100% on all three CUJ
checkpoints**. It exists so a scoring run can validate itself: if this app ever
scores below 100%, the harness (or its environment) is broken, not the app under
test.

It was written from `specs/slotline/m1.md`, `m2.md` and `m3.md` only. The suites
in `cuj-tests/slotline/` were read to diagnose failures, never to derive
behaviour, and no test was modified. Where a test demanded something the spec
does not pin, it is recorded under **Spec sufficiency findings** below.

## Final scores

| Checkpoint | Suite                                    | Result             |
| ---------- | ---------------------------------------- | ------------------ |
| 1          | `cuj-tests/slotline/checkpoint-1.spec.ts` | **13 / 13 passed** |
| 2          | `cuj-tests/slotline/checkpoint-2.spec.ts` | **20 / 20 passed** |
| 3          | `cuj-tests/slotline/checkpoint-3.spec.ts` | **22 / 22 passed** |

Verified repeatedly, not once: after the last app change, checkpoint 1 ran green
5 consecutive times and checkpoints 2 and 3 four times each, with no flake in any
run.

`schema.sql` applies cleanly to an empty database and is idempotent on re-apply
(every object is `IF NOT EXISTS`; the one construct that has no such form — the
exclusion constraint — is guarded by an explicit `pg_constraint` lookup).

## How to run it

`neon-sim` must be running (see `../../neon-sim/README.md`). From
`benchmarks/app-builder/`:

```bash
./oracle/run-suite.sh oracle/slotline/reference slotline 1 4200   # 13/13
./oracle/run-suite.sh oracle/slotline/reference slotline 2 4200   # 20/20
./oracle/run-suite.sh oracle/slotline/reference slotline 3 4200   # 22/22
```

Add a 5th argument to grep a single test, e.g. `… slotline 3 4200 slot-m3-06`.
Each invocation provisions a fresh project + database, applies `schema.sql`,
installs, builds, serves on the given port and runs that checkpoint's suite. The
server log path is printed at the end; runtime SQL/auth errors surface there.

**`run-suite.sh` checks out `checkpoint-m<N>`, so an untagged fix is invisible to
the scorer.** After every change, re-tag: `git tag -f checkpoint-m3`.

## Milestone tags

Milestones legitimately change behaviour, so each checkpoint is scored against
its own tag and no single tree satisfies all three:

| Tag             | What it holds                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `checkpoint-m1` | Every signed-in user manages practitioners and services; `POST /api/bookings` takes any parseable start |
| `checkpoint-m2` | Roles, availability, the slot generator, the no-overlap constraint; practitioner/service writes are staff-only |
| `checkpoint-m3` | Reschedule, the 48-hour window, `completed`/`no_show`, the staff day view, hardening                    |

`schema.sql` evolves with them: M1 has three tables, M2 adds `user_roles`,
`availability` and the `bookings_no_overlap` exclusion constraint, M3 widens the
status check to four values.

## How it is built

### The clinic timezone lives in exactly one module

`src/lib/clinic-time.ts` owns `CLINIC_TZ`, `clinicInstant` (clinic wall clock →
UTC instant, resolved by the two-pass format-and-correct technique so it is right
across both DST transitions), `clinicWall` / `clinicDateOf` / `clinicClockOf`
(instant → clinic wall clock), `clinicDayBounds` (the two instants that bracket a
clinic calendar day) and `addDays` (calendar arithmetic on Y-M-D fields, never
`+86_400_000` on an instant). No offset is written down anywhere, no other file
constructs a `Date` from a local string, and the module is isomorphic so the
booking form converts its `datetime-local` value with the *same* helper the
server validates it with.

`start_at` / `end_at` are `timestamptz`; availability windows are a `weekday`
plus two `time` columns, because a weekly window is a wall clock and not an
instant. `GET /api/practitioners/[id]/bookings` and `/staff/schedule` bracket the
day with `clinicDayBounds`, which is what makes `slot-m3-06` (an 18:00 clinic
appointment whose UTC date is the *next* day) file on the right clinic day.

### One slot generator, three callers

`src/lib/slots.ts` is the only place the grid rules exist. `offeredSlots()`
applies all four in order — grid from the window start by `durationMinutes`, the
whole appointment fits before the window end, no overlap with an active booking,
starts in the future — and `assertSlotOffered()` is the write-time re-check that
`GET /api/slots`, `POST /api/bookings`, `POST /api/bookings/[id]/reschedule` and
`PATCH /api/bookings/[id]` all funnel through. Nothing computes a slot in the
browser: `src/hooks/use-slots.ts` fetches `/api/slots` and renders the answer.

`assertSlotOffered` derives the clinic day from the requested instant, so the
accepted set is *by construction* the offered set — an off-grid start, a start
after the window, a start inside another appointment and a start in the past all
fail for the same reason and through the same code.

### Double-booking is prevented by the database

```sql
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (practitioner_id WITH =, tstzrange(start_at, end_at) WITH &&)
  WHERE (status <> 'cancelled');
```

The read-side check and the write are therefore atomic with respect to a
competing request: whatever the interleaving, two overlapping active bookings for
one practitioner cannot both commit. The loser raises `23P01`, which
`src/lib/http.ts` maps to `409 { "error": … }`. The same constraint covers the
reschedule path, because an `UPDATE` that moves a row is checked against the
other rows only — so a booking never blocks itself. `WHERE status <> 'cancelled'`
is also the rule that releases a cancelled slot while `completed` and `no_show`
keep occupying theirs.

`btree_gist` is required (equality on `practitioner_id` inside a GiST index) and
is created by `schema.sql`.

### Policy and authorization are centralised

- `src/lib/policy.ts` holds `CANCEL_WINDOW_HOURS = 48` once. `assertChangeable()`
  is the single server rule (status must be `booked`; a patient must be outside
  the window; staff are exempt) and `patientMayChange()` is the *same* predicate
  the booking detail page uses to hide the cancel and reschedule controls. The
  notice text is derived from the constant too.
- `src/lib/http.ts` `route()` wraps every JSON handler: it reads the session,
  answers 401 with no data, resolves the caller's role once, and converts any
  thrown `ValidationError` / `ConflictError` / `ForbiddenError` (and a short list
  of Postgres error codes) into the pinned `{ "error": … }` body. No handler
  builds an error response itself, so no stack trace or SQL string can leak.
- `requireStaff(ctx)` is the one staff gate; `loadActionableBooking(ctx, id)` is
  the one ownership gate — a patient's lookup carries its own `patient_id`
  predicate, so a stranger's booking is never read at all and is
  indistinguishable from one that does not exist (404).
- Roles are written by exactly one endpoint, `POST /api/staff/claim`, which reads
  the access code and nothing else. No body field anywhere names a user or a
  role, so there is no request shape that could promote anybody.

### Ignoring client-supplied fields

`resolveBookingRequest()` reads `practitionerId`, `serviceId` and `startAt` and
never looks at `id`, `patientId`, `endAt`, `durationMinutes`, `status` or `role`.
`PATCH /api/bookings/[id]` reads `startAt` only. The only reliable way to ignore
a field is never to consult it, so the forged-field probes pass by construction
rather than by a deny list.

## Spec sufficiency findings

These are cases where a suite assertion is stricter than the milestone prompt the
model receives. They are implemented here so the reference reaches 100%, but a
spec-faithful implementation could lose the point.

1. **`slot-m3-s01`, PATCH leg — blocker.** The probe requires
   `PATCH /api/bookings/{id}` with `{ status: "cancelled" }` on a *booked*
   booking inside the 48-hour window to answer **403 or 409**. M3 pins only that
   `status` is *ignored* on update ("On update, ignore client-supplied `id`,
   `patientId`, `practitionerId`, `serviceId`, `endAt`, `status` and `role`"), and
   pins the 48-hour window for *cancel*, *reschedule* and *delete* — not for
   `PATCH`. An app that ignores the field and answers `200` with the status
   untouched satisfies the prose exactly and fails this probe. The suite is
   internally inconsistent about it: `slot-m3-s07` and `slot-m3-s10` both
   explicitly admit the "the status field was ignored" outcome for the *same*
   `PATCH` shape. Resolved here by making `PATCH` subject to `assertChangeable()`
   like every other mutation, which is defensible but is an inference.

2. **`slot-m3-07`, cancel control on a `completed` / `no_show` booking —
   minor.** The row asserts `booking-cancel-button` is absent or disabled on a
   booking that is `no_show` or `completed` and whose start is still two weeks
   away. M3 pins hiding/disabling the patient's cancel control only "once the
   booking is inside the window". "Only a `booked` booking can change" makes the
   inference natural, but nothing pins the *UI* consequence for a non-`booked`
   booking outside the window.

3. **`slot-m3-08`, UI half — minor.** The test drives
   `service-form-duration` with `"0"` and expects `service-form-error` to carry a
   message. A conforming `<input type="number" min="1" required>` — an entirely
   reasonable reading of "a whole-number `durationMinutes`" — makes the browser
   block the submit, so no server message ever reaches the pinned error element
   and the test fails. Resolved here with `noValidate` on every form and no `min`
   attribute, i.e. by deliberately declining a native validation the spec does not
   forbid. (The design doc already excludes `durationMinutes: "abc"` from the UI
   half for the analogous reason; `0` has the same problem one step later.)

4. **`checkpoint-3`'s reads of the staff day list — minor.** `expectNoOverlaps`,
   `activeOf` and `dayStatus` read `startAt`, `endAt`, `status` and `id` as
   *fields* of `GET /api/practitioners/[id]/bookings` rows, and `instantMs` hard
   fails when `startAt` is absent. M2 pins that endpoint only as returning "that
   practitioner's bookings for the clinic-local date, including each patient's
   name and email" — the M1 booking-object shape is the natural inference and is
   what this reference emits, but the endpoint's own field names are never pinned.
   (Checkpoint 2 tolerates `start`/`end`; checkpoint 3 does not.)

5. **`slot-m1-01` landing URL — minor.** The row asserts the browser is on
   `/bookings` after sign-up. M1 pins "`/` goes to `/bookings` when signed in" and
   that sign-up "signs in immediately", but never pins where sign-up itself
   lands. Any app that routes sign-up to `/` passes transitively; one that routes
   it to, say, `/practitioners` fails on a contract it was not given.

Nothing else in any of the three suites required behaviour outside the prompts.

## Notes for a future maintainer

- **`src/app/api/auth/[...path]/route.ts` is load-bearing and easy to forget.**
  Without `export const { GET, POST } = auth.handler()`, `authClient.signUp.email`
  has no endpoint to call, every persona fails to get a session, and *all 13*
  checkpoint-1 tests fail identically with `/api/me` returning 401. A uniform
  "nobody can sign in" failure is almost always this file.
- **`pnpm-workspace.yaml` must carry the shared `allowBuilds` list** (copied from
  the relay-crm reference). The bare template list makes `pnpm install` exit
  non-zero with `ERR_PNPM_IGNORED_BUILDS`, and `run-suite.sh` reports
  `[oracle] install failed` before the app is ever built.
- **Slot pickers must render nothing until the server has answered.**
  `SlotList` returns `null` while `loaded` is false, and `booking-form-date`,
  `reschedule-date` and `schedule-date-input` have no default value. This is not
  cosmetic: the suites' `waitForSlots` / `openStaffSchedule` poll for
  "`slot-option` or `slot-empty`", and `clickSlot` enumerates the rendered options
  exactly once with no retry — so a stale list rendered for a previous date would
  make a correct app fail. The fetch hooks also carry a cancellation flag so an
  older response can never overwrite a newer one.
- Mutations are `await`ed before any navigation and use `keepalive`, so a click
  that immediately routes away cannot cancel its own write.
- `.env.local` is written by `run-suite.sh`. For a local `next build` you need a
  placeholder with a *well-formed* `postgresql://user:pass@host/db` URL and a
  `NEON_AUTH_COOKIE_SECRET`; both are read at module load, so the build fails
  during "Collecting page data" without them.

## Suspected suite defects

None that make a checkpoint unsatisfiable. See **Spec sufficiency findings**
above for five places where the suite is stricter than the prompt; finding 1 is
the only one where a literal, careful reading of the spec produces a failing app.
