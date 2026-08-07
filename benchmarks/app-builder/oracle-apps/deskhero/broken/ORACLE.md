# Deskhero oracle — broken twin

A copy of `../reference` with **authorization deliberately removed**, and
nothing else changed. It is the negative control for the scoring harness: the
reference proves the suite can be *satisfied*, this twin proves the suite can
*detect*. If a run against this directory does not reproduce the numbers below —
in particular if **any** `m1-p-*` / `m2-p-*` / `m3-p-*` probe **passes** — the
harness or the suite changed, not the app.

Every defect is marked in place with a comment naming its id and the probes it
must trip:

```bash
grep -rn "ORACLE-DEFECT" src/
```

## Fixed-point scores

| Checkpoint | Suite                                     | Reference | Broken twin | Delta                                          |
| ---------- | ----------------------------------------- | --------- | ----------- | ---------------------------------------------- |
| 1          | `cuj-tests/deskhero/checkpoint-1.spec.ts` | 11/12     | **8/12**    | all 3 `m1-p-*` probes fail                     |
| 2          | `cuj-tests/deskhero/checkpoint-2.spec.ts` | 20/20     | **12/20**   | all 8 `m2-p-*` probes fail                     |
| 3          | `cuj-tests/deskhero/checkpoint-3.spec.ts` | 22/22     | **12/22**   | all 10 `m3-p-*` probes fail                    |

Failing test ids, exactly:

```
ckpt1 (8/12)  m1-close-reopen*, m1-p-unauth, m1-p-idor-read, m1-p-idor-write
ckpt2 (12/20) m2-p-idor, m2-p-self-promote, m2-p-agent-promote, m2-p-user-list-leak,
              m2-p-skip-transition, m2-p-role-transition, m2-p-unassigned-transition,
              m2-p-notes-leak
ckpt3 (12/22) m3-p-dead-cookie-read, m3-p-dead-cookie-write, m3-p-self-promote,
              m3-p-audit-leak, m3-p-replies-idor, m3-p-note-serialization,
              m3-p-canned-leak, m3-p-agent-deactivate, m3-p-admin-self-deactivate,
              m3-p-sla-edit-role
```

`*` `m1-close-reopen` fails in **both** directories for the reason documented in
the reference's `ORACLE.md` (it is unsatisfiable by an M2/M3-faithful app: the
M2 matrix has no requester `open → closed` edge, so `ticket-close` is never
rendered). It is not a defect of this twin.

**No non-probe CUJ regresses.** All 12 checkpoint-3 CUJs, all 12 checkpoint-2
CUJs and the same 8 checkpoint-1 CUJs pass here that pass in the reference. That
is the point: a probe failure against this twin is attributable to a named
defect, never to a broken app.

## How to run it

Requires a running neon-sim and a local Postgres. From `benchmarks/app-builder`:

```bash
./oracle/run-suite.sh oracle/deskhero/broken deskhero 1 4300   # 8/12
./oracle/run-suite.sh oracle/deskhero/broken deskhero 2 4300   # 12/20
./oracle/run-suite.sh oracle/deskhero/broken deskhero 3 4300   # 12/22
```

`schema.sql` is identical to the reference's — every defect is in application
code, none in the database.

## Design rules the defects follow

1. **One defect per probe family**, each a mistake real submissions actually
   make: a deleted server-side check, a privileged default branch, or an
   ownership rule that was *moved into the browser* rather than enforced.
2. **The rendered UI stays correct.** Every page guard, every rendered control
   and every client-side filter behaves exactly as in the reference. The twin
   *looks* right in a browser; it is wrong only to a raw HTTP client. That is
   the precise failure mode the design says the probes exist to catch — mid-tier
   models "ship client-side-only gating, which the raw-HTTP probes catch"
   (`design/app-2-deskhero.md`).
3. **No collateral damage.** Every defect makes the server strictly *more*
   permissive, and where a CUJ asserts the same invariant as a probe through the
   UI (`m1-isolation-ui`, `m2-isolation`, `m2-notes-hidden`,
   `m2-button-gating`), the twin re-implements that invariant client-side so the
   CUJ still passes.

## Defect table

| Id      | File : line                                                                 | Probes tripped                                                     | ckpt1 | ckpt2 | ckpt3 |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----- | ----- | ----- |
| **D1**  | `src/lib/current-user.ts:22`                                                | `m3-p-dead-cookie-read`, `m3-p-dead-cookie-write`                   | —     | —     | ✅ both fail |
| **D2**  | `src/app/api/admin/users/[id]/route.ts:8`                                   | `m3-p-self-promote`, `m3-p-agent-deactivate`, `m3-p-admin-self-deactivate`, `m2-p-self-promote`, `m2-p-agent-promote` | —     | ✅ 2 fail | ✅ 3 fail |
| **D3**  | `src/app/api/admin/audit/route.ts:4`                                        | `m3-p-audit-leak`                                                   | —     | —     | ✅ fails |
| **D4**  | `src/app/api/tickets/[id]/replies/route.ts:14`                              | `m3-p-replies-idor`                                                 | —     | —     | ✅ fails |
| **D5**  | `src/app/api/tickets/[id]/route.ts:7` (`findTicket`)                        | `m3-p-note-serialization`, `m2-p-notes-leak`                        | —     | ✅ fails | ✅ fails |
| **D6**  | `src/app/api/canned-responses/route.ts:4` + `src/app/api/admin/canned-responses/route.ts:4` | `m3-p-canned-leak`                                  | —     | —     | ✅ fails |
| **D7**  | `src/app/api/tickets/[id]/route.ts:63` (`slaDueAt` branch)                  | `m3-p-sla-edit-role`                                                | —     | —     | ✅ fails |
| **D8**  | `src/app/api/tickets/route.ts:6` (`GET`)                                    | `m1-p-unauth`                                                       | ✅ fails | —   | —     |
| **D9**  | `src/app/api/tickets/[id]/route.ts:22` + `:46`, `src/components/ticket-detail.tsx:144` | `m1-p-idor-read`, `m1-p-idor-write`, `m2-p-idor`         | ✅ 2 fail | ✅ fails | —  |
| **D10** | `src/app/api/admin/users/route.ts:4` (`GET`)                                | `m2-p-user-list-leak`                                               | —     | ✅ fails | —     |
| **D11** | `src/app/api/tickets/[id]/transition/route.ts:26`                           | `m2-p-skip-transition`, `m2-p-role-transition`, `m2-p-unassigned-transition` | — | ✅ 3 fail | — |

Every probe at every checkpoint is covered: 3/3 at M1 (D8, D9), 8/8 at M2 (D2,
D5, D9, D10, D11), 10/10 at M3 (D1–D7).

## The defects

### D1. Deactivation is no longer enforced per request

`src/lib/current-user.ts:22` — `getCurrentUser()` returns the account regardless
of `active`.

- **Probes it should trip:** `m3-p-dead-cookie-read`, `m3-p-dead-cookie-write`
- **Why the CUJs still pass:** page guards call `getSessionAccount()` (not
  `getCurrentUser()`) and branch on `active` themselves, so `/tickets` still
  renders `DeactivatedNotice` with no `ticket-row`; `GET /api/me` keeps its own
  explicit `active` check, so the header still reports the account correctly.
  `m3-deactivate` and `m3-reactivate` are untouched.
- **Observed:** `GET /api/tickets` with the dead cookie → **200** with the
  persona's own ticket in the body (expected 401/403). `POST /api/tickets` →
  **201**, and the created subject then shows up in the admin's
  `GET /api/tickets` — which is what the *hardened* `m3-p-dead-cookie-write`
  now checks, so the probe fails on both of its assertions.

### D2. The user-mutation route has no admin gate and no self-guard

`src/app/api/admin/users/[id]/route.ts:8` — both `actor.role !== "admin"` and
`id === actor.id` are deleted from `PATCH`.

- **Probes it should trip:** `m3-p-self-promote`, `m3-p-agent-deactivate`,
  `m3-p-admin-self-deactivate`, `m2-p-self-promote`, `m2-p-agent-promote`
- **Why the CUJs still pass:** `/admin/users` is still redirect-guarded
  server-side, so the only way to reach this route through the UI is as an
  admin — exactly as before. `m3-setup`, `m3-audit-role`, `m3-deactivate`,
  `m3-reactivate`, `m2-promote-agent` are untouched.
- **Observed:** requester `PATCH /api/admin/users/{self} {"role":"admin"}` →
  **200**, role becomes `admin`. Agent deactivating a requester → **200**.
  Admin deactivating itself → **200**.

### D3. The audit trail is readable by anyone signed in

`src/app/api/admin/audit/route.ts:4` — `user.role !== "admin"` deleted from
`GET`.

- **Probes it should trip:** `m3-p-audit-leak`
- **Why the CUJs still pass:** `/admin/audit` (the page) keeps its admin guard,
  and it is the only surface any CUJ uses. `m3-audit-role` and
  `m3-audit-transitions` read it as the admin.
- **Observed:** requester and agent both get **200** with the full event list,
  including `role_change` rows carrying actor and target emails.

### D4. Ticket replies are readable by any signed-in account (IDOR)

`src/app/api/tickets/[id]/replies/route.ts:14` — the computed `allowed`
participant check is no longer consulted on `GET`, so the ticket id becomes the
capability. `POST` keeps the check.

- **Probes it should trip:** `m3-p-replies-idor`
- **Why the CUJs still pass:** the detail page only fetches replies once its own
  `canReply` is true, so no non-participant ever asks. `m3-reply-thread`,
  `m3-canned-apply` and every `addReply()` call are untouched.
- **Observed:** an unrelated requester `GET /api/tickets/{id}/replies` → **200**
  with the other requester's conversation.

### D5. Internal notes are serialized into the ticket detail and filtered client-side

`src/app/api/tickets/[id]/route.ts:7` — `findTicket()` attaches the ticket's
internal notes as `internal_notes` for every viewer, including the requester who
filed it. Redaction moves from the query into the React component.

- **Probes it should trip:** `m3-p-note-serialization`, `m2-p-notes-leak`
- **Why the CUJs still pass:** `ticket-detail.tsx` renders the notes section
  only when `user.role !== "requester"`, and the data arrives through a
  client-side `fetch` that never reaches the DOM. `m2-notes-hidden` and
  `m3-workflow-regression` inspect `page.content()` and therefore still see no
  marker — which is exactly why the probes read the *raw body* instead.
- **Observed:** as the ticket's own requester, `GET /api/tickets/{id}` → **200**
  whose body contains `"internal_notes":[{…,"body":"internal-note-…"}]`.

### D6. Canned responses have no role gate on read or write

`src/app/api/canned-responses/route.ts:4` (`GET`, requester gate deleted) and
`src/app/api/admin/canned-responses/route.ts:4` (`POST`, admin gate deleted).

- **Probes it should trip:** `m3-p-canned-leak`
- **Why the CUJs still pass:** `/admin/canned` is still admin-gated and the
  agent's `canned-select` is strictly more privileged than what the route now
  allows. `m3-canned-crud` and `m3-canned-apply` are untouched.
- **Observed:** requester `GET /api/canned-responses` → **200** with every
  canned body; requester `POST /api/admin/canned-responses` → **201**.

### D7. The SLA due time is editable by non-admins

`src/app/api/tickets/[id]/route.ts:63` — `user.role !== "admin"` deleted from
the `slaDueAt` branch of `PATCH`.

- **Probes it should trip:** `m3-p-sla-edit-role`
- **Why the CUJs still pass:** `sla-due-input` / `sla-due-save` render only when
  `isAdmin`, so `setSlaDue()` — the only path `m3-overdue` and
  `m3-overdue-clears` use — is unchanged.
- **Observed:** the assigned agent `PATCH /api/tickets/{id} {"slaDueAt": <past>}`
  → **200** and the deadline is actually rewritten, so the probe fails on the
  status assertion *and* on the re-read `sla_due_at` comparison that was added
  when it was hardened.

### D8. The ticket list has no authentication check, and its default branch is the admin view

`src/app/api/tickets/route.ts:6` — `if (!user) return 401` deleted from `GET`;
the role branches become `user?.role === …`.

- **Probes it should trip:** `m1-p-unauth`
- **Realism:** authentication is "handled by middleware" — and `middleware.ts`
  matches `/tickets`, `/admin`, `/agent`, i.e. the *pages*, never `/api`. An
  anonymous caller has no role, misses both role branches, and falls through to
  the last one, which is the **admin** query: an unscoped read of every ticket.
  A privileged fall-through default plus a missing `!user` check is how this bug
  actually ships.
- **Why the CUJs still pass:** signed-in behaviour is bit-identical (the
  requester and agent branches are untouched), and no CUJ calls the API without
  a session. `m1-signout-guard` exercises the *page*, which the middleware still
  redirects.
- **Observed:** anonymous `GET /api/tickets` → **200** with every ticket in the
  database, including the probe's subject (both assertions fail).

### D9. Row ownership moved from the API into the browser

`src/app/api/tickets/[id]/route.ts:22` (`GET`) and `:46` (`PATCH`) — the
`canView()` call is deleted from both; `DELETE` still calls it. The rule is
re-implemented client-side at `src/components/ticket-detail.tsx:144`, which
renders "Ticket not found" when the fetched ticket's `creator_id` is not the
viewing requester.

- **Probes it should trip:** `m1-p-idor-read`, `m1-p-idor-write`, `m2-p-idor`
- **Realism:** the canonical client-side-only gating failure — the API is
  treated as a private data layer and "the UI decides what to show".
- **Why the CUJs still pass:** `m1-isolation-ui` and `m2-isolation` navigate a
  *browser* to another requester's ticket id, and the component still refuses to
  render it, so the subject never enters the DOM. The component blocks on both
  `ticket` and `user` before rendering anything, so there is no flash of the
  foreign subject either.
- **Observed:** R2 `GET /api/tickets/{R1 ticket}` → **200** with R1's subject;
  R2 `PATCH …{"subject":"pwned"}` → **200**, and `pwned` then appears in R1's
  own `GET /api/tickets`.

### D10. The user roster is readable by any signed-in account

`src/app/api/admin/users/route.ts:4` — `user.role !== "admin"` deleted from
`GET`; only "signed in" remains.

- **Probes it should trip:** `m2-p-user-list-leak`
- **Realism:** the assignee picker needs the agent roster, so the route was
  relaxed "so staff can load the list too" — and requesters came along with it.
- **Why the CUJs still pass:** `/admin/users` is still redirect-guarded
  server-side (`app/admin/users/page.tsx`) so `m2-button-gating` still sees no
  `users-table` as an agent, and `ticket-detail.tsx` only fetches this list when
  `me.role === "admin"`. No rendered surface changes.
- **Observed:** requester `GET /api/admin/users` → **200** with every persona's
  name, email, role and `active` flag.

### D11. The transition endpoint no longer checks the state machine

`src/app/api/tickets/[id]/transition/route.ts:26` — the `illegal` branch is
deleted. The route still validates that `to` is a real status and still returns
403 for a `forbidden` verdict; what it no longer verifies is that `from → to` is
an **edge** of the matrix.

- **Probes it should trip:** `m2-p-skip-transition`, `m2-p-role-transition`,
  `m2-p-unassigned-transition`
- **Why the CUJs still pass:** `statusControls()` in `src/lib/workflow.ts` is
  untouched, so the buttons are still derived from the full matrix and every
  UI-driven transition (`m2-happy-path`, `m2-reopen`, `m2-button-gating`,
  `m3-overdue-clears`, `m3-audit-transitions`, `m3-workflow-regression`) is
  unchanged. Only a raw POST can leave the matrix.
- **Observed:** agent `POST …/transition {"to":"closed"}` on an `open` ticket →
  **200**, status `closed`. Requester `{"to":"in_progress"}` on their own
  unassigned ticket → **200**. Non-assignee agent on an unassigned ticket →
  **200**.
- **Sensitivity note:** see below — all three of these probes are decided by
  this one branch, and *none* of them reaches the role/assignee half of the
  check.

## Probe sensitivity — where these probes are weaker than their design criterion

Building the twin also measures the *probes*.

### Fixed since the last revision of this file

Two M3 probes used to assert a status code and stop, and both have since been
hardened; this twin still fails both, now for the right reason:

- `m3-p-sla-edit-role` now re-reads `sla_due_at` after the attack and requires
  it unchanged. (D7 both writes *and* answers 200, so it fails either way; the
  variant that motivated the hardening — write, then answer 403 — would now be
  caught.)
- `m3-p-dead-cookie-write` now asserts the ticket was never created, instead of
  accepting any 4xx. (D1 creates it, so the probe fails on both assertions.)

### Still open

- **The three M2 transition probes do not test transition *authorization* at
  all — only matrix membership.** Each of the three sets up a case whose verdict
  is `illegal` before any role check runs:
  `m2-p-skip-transition` is `open → closed` (no such edge);
  `m2-p-role-transition` and `m2-p-unassigned-transition` are both
  `open → in_progress` on an **unassigned** ticket, which the matrix rejects for
  *everyone*, including an admin. Consequence: an app that keeps the matrix but
  performs **no role or assignee check whatsoever** on transitions — the exact
  "the client only rendered legal buttons, so the server trusts it" failure the
  design calls out — passes all three probes.

  **Verified empirically.** A throwaway variant of this route (D11 reverted, the
  `forbidden` branch deleted instead — so any signed-in caller may drive any
  ticket along any legal edge, including a stranger's) was built and run:

  ```
  ./oracle/run-suite.sh oracle/deskhero/broken deskhero 2 4300 \
      "m2-p-skip-transition|m2-p-role-transition|m2-p-unassigned-transition"
  → 3/3 passed  ALL PASS
  ```

  The variant is **not** shipped here; this directory fails all three. Suggested
  hardening: give
  `m2-p-role-transition` and `m2-p-unassigned-transition` an **assigned**
  ticket, so the illegal-edge branch cannot answer for them; the requester
  attempting `in_progress` and the non-assignee agent attempting `in_progress`
  then both land on `forbidden`, which is the property those probes are named
  for. (An extra `m2-p-*` case for the unassigned precondition would keep that
  coverage.)
- **`m3-p-note-serialization` guards its second assertion** with
  `if (replies.status() === 200)`, so an app whose replies endpoint errors for
  the ticket's own owner silently skips half the probe.
- **`m1-p-unauth` accepts any status in `[401, 403, 3xx]`,** so an app that
  answers `200 []` to an anonymous list request fails it (good), but one that
  500s on the missing session also "fails" it for a non-security reason. That is
  the safe direction, and is noted only so the failure is not misread as a leak.
