## App 2: Deskhero — role-based helpdesk/ticketing

### Overview & what it stresses

Deskhero is a three-role helpdesk (admin / agent / requester) with an explicit ticket state machine. It uniquely exercises **authorization depth** (three roles with asymmetric powers, per-row ownership, field-level redaction of internal notes) and **workflow correctness** (a pinned transition matrix that must be enforced server-side, not just hidden in the UI). Where App 1 (CRM) stresses tenant isolation breadth, Deskhero stresses _vertical_ permission logic — the dimension where mid-tier models most often ship client-side-only gating, which the raw-HTTP probes catch.

All prompts are engine-agnostic: they never mention Dyad, Neon, or migration mechanics — schema changes are the system prompt's business (`<dyad-execute-sql>` per `src/prompts/neon_prompt.ts:120-126`), and auth wording ("email/password auth") drives every app onto Neon Auth / better-auth (`src/prompts/neon_prompt.ts:92` forbids homegrown auth) while remaining actionable verbatim by Claude Code / Codex CLI in Phase 2. Per the unified auth contract, each app builds its **own** sign-up/sign-in forms with pinned testids rather than the prebuilt `AuthView`, and email verification is off (`require_email_verification:false`). Because the guide documenting `authClient.signUp.email()` / `signIn.email()` is suppressed when verification is off (`src/prompts/neon_prompt.ts:81`), the starting template snapshot ships a short factual note — `AI_RULES.md` for Dyad, an identical `AGENTS.md` for the phase-2 CLIs — documenting `authClient.signUp.email({email,password,name})`, `authClient.signIn.email({email,password})`, `authClient.signOut()`, and server-side session reading via the `createNeonAuth` server helper; this note is part of the task bundle, identical for every model and harness. Because the template uses a plain `DATABASE_URL` connection, authorization must live in server code and SQL filters, not RLS (`src/prompts/neon_prompt.ts:133`) — the probes are designed to verify exactly that. Base template: `dyad-sh/nextjs-template` (`src/shared/templates.ts:42`).

**Suite mechanics (applies to all three checkpoints).** Each checkpoint's Playwright suite runs serially (one spec file, `test.describe.serial`) against `localhost:3000` and creates all personas through the UI with timestamp-suffixed emails (`admin+<ts>@deskhero.test`, `agent1+<ts>@deskhero.test`, `req1+<ts>@deskhero.test`, `req2+<ts>@deskhero.test`); persona sessions are captured once as `storageState` and reused. Security probes replay captured cookies via `request.newContext({ storageState })` raw `fetch` calls — never through the UI — so client-side gating cannot mask a server hole. The admin bootstrap rule (M2 prompt) keys off the email prefix, not sign-up order, so suites work whether or not the DB persists across checkpoints. Auth-form locators use the pinned custom-form testids — `signup-name` / `signup-email` / `signup-password` / `signup-submit` (and `signup-error`) for sign-up, `signin-email` / `signin-password` / `signin-submit` (and `signin-error`) for sign-in — which every app must implement as its own forms; the prebuilt `AuthView` is not acceptable.

### Data model expectations (informative — the model designs its own schema)

Expected shape (not prescribed): a `tickets` table (subject, body, priority, status, requester id, assignee id, `sla_due_at` from M3, timestamps); an app-side user/profile table keyed to the auth user id carrying `role` and `active` (Neon Auth owns credentials; the app must not fork auth); `ticket_notes` (internal), `ticket_replies` (public, M3), `canned_responses` (M3), `audit_events` (M3: actor, event type, target, old→new detail, timestamp). Reasonable models may merge notes/replies into one table with a `visibility` column — fine, as long as redaction is enforced at query/serialization level.

### Milestone 1 — Auth + ticket CRUD

**Prompt (verbatim)**:

```text
Build **Deskhero**, an internal helpdesk app, in this project. Milestone 1 delivers authentication and ticket CRUD.

**Auth**
- Email/password sign-up and sign-in only (no social providers). Sign-up collects name, email, password. Build your own sign-up and sign-in forms — do not use a prebuilt/hosted auth component.
- `/` redirects: a signed-out visitor to `/` is sent to `/auth/sign-in`; a signed-in visitor to `/` is sent to `/tickets`. Signed-in users otherwise land on `/tickets`. Visiting any `/tickets*` page while signed out redirects to `/auth/sign-in`. Unauthenticated calls to any `/api/tickets*` route return 401 JSON.
- `GET /api/me` returns the signed-in caller's `{ id, email, name }` as JSON; unauthenticated calls return 401 JSON.
- The sign-up form must carry `data-testid`s `signup-name`, `signup-email`, `signup-password`, `signup-submit`, and `signup-error` (validation/auth error). The sign-in form must carry `signin-email`, `signin-password`, `signin-submit`, and `signin-error`.

**Tickets**
A ticket has: subject (required, non-empty), body (text), priority (`low` | `medium` | `high`), status (`open` | `closed`, default `open`), creator, created timestamp. Users can only ever see and modify their own tickets — enforce this on the server for every read and write; a request for another user's ticket must return 404. Owners can edit subject/body/priority, close, reopen, and delete their tickets. Submitting an empty subject must show a validation error and create nothing.

**Pages** (exact routes)

| Route | Purpose |
|---|---|
| `/auth/sign-in`, `/auth/sign-up` | auth |
| `/tickets` | list my tickets (newest first) + link to create |
| `/tickets/new` | create form |
| `/tickets/[id]` | detail with edit/close/reopen/delete |

**API routes** (must exist exactly at these paths; the browser UI must perform all ticket reads/writes through them — do not use Server Actions for these operations)

| Route | Purpose |
|---|---|
| GET `/api/me` | signed-in caller's `{ id, email, name }` (401 if unauthenticated) |
| GET / POST `/api/tickets` | list own tickets / create |
| GET / PATCH / DELETE `/api/tickets/[id]` | read / update (incl. status) / delete — owner only |

**data-testids** (every element below must carry the exact `data-testid`)

| testid | element |
|---|---|
| `signup-name`, `signup-email`, `signup-password`, `signup-submit`, `signup-error` | sign-up form fields, submit control, and validation/auth error message |
| `signin-email`, `signin-password`, `signin-submit`, `signin-error` | sign-in form fields, submit control, and validation/auth error message |
| `user-email` | signed-in user's email in the header |
| `sign-out` | sign-out control |
| `new-ticket-link` | link to `/tickets/new` |
| `ticket-subject`, `ticket-body`, `ticket-priority`, `ticket-submit` | create/edit form fields; priority must be a native `<select>` with option values exactly `low`, `medium`, `high` |
| `ticket-error` | validation error message |
| `ticket-list`, `ticket-row` | list container and each row (row shows subject, priority, status) |
| `ticket-empty` | empty state when the user has no tickets |
| `ticket-detail-subject`, `ticket-detail-body`, `ticket-detail-status`, `ticket-detail-priority` | detail page fields |
| `ticket-edit`, `ticket-close`, `ticket-reopen`, `ticket-delete` | detail page actions |

Style everything cleanly with the existing Tailwind/shadcn setup. Keep the schema minimal — later milestones will extend it.
```

**CUJ suite (checkpoint 1)** — 9 CUJs:

| #   | id                 | Steps summary                                                                     | Pass criterion                                                                                     |
| --- | ------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `m1-signup-land`   | Sign up R1 (via `signup-*` form) → observe landing                                | URL is `/tickets`; `user-email` shows R1's email; `ticket-empty` visible                           |
| 2   | `m1-create`        | `new-ticket-link` → subject "Printer broken <ts>", body, priority `high` → submit | `ticket-row` appears with subject text, priority `high`, status `open`                             |
| 3   | `m1-validation`    | Submit create form with empty subject                                             | `ticket-error` visible; row count unchanged                                                        |
| 4   | `m1-detail`        | Click the row                                                                     | All four `ticket-detail-*` fields match created values                                             |
| 5   | `m1-edit`          | `ticket-edit` → change subject, priority → `medium` → save                        | Detail reflects new subject and `medium`                                                           |
| 6   | `m1-close-reopen`  | `ticket-close`, then `ticket-reopen`                                              | Status shows `closed` then `open` after each action                                                |
| 7   | `m1-delete`        | Create a 2nd ticket, `ticket-delete` it                                           | Row gone from `ticket-list`; only 1 row remains                                                    |
| 8   | `m1-signout-guard` | `sign-out`, then goto `/tickets`                                                  | Redirected to `/auth/sign-in`                                                                      |
| 9   | `m1-isolation-ui`  | Sign up R2 (via `signup-*` form); goto R1's ticket URL directly                   | R2 sees `ticket-empty`; R1's ticket page yields 404/redirect and R1's subject text appears nowhere |

**Security probes (checkpoint 1)** — light at M1:

| #   | id                | Setup                                                          | Attack                                                              | Pass criterion                                                                         |
| --- | ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `m1-p-unauth`     | none                                                           | `GET /api/tickets` with no cookies                                  | 401 (or 3xx to sign-in with no ticket data); response body contains no ticket subjects |
| 2   | `m1-p-idor-read`  | R1's ticket id captured from R1's detail URL (`/tickets/[id]`) | `GET /api/tickets/{id}` with R2's cookies                           | 404 (403 accepted); body does not contain R1's subject string                          |
| 3   | `m1-p-idor-write` | same                                                           | `PATCH /api/tickets/{id}` (`{"subject":"pwned"}`) with R2's cookies | 4xx; R1's UI still shows original subject                                              |

### Milestone 2 — Roles, assignment, workflow, internal notes

**Prompt (verbatim)**:

```text
Extend Deskhero with roles and a real ticket workflow.

**Roles**: `admin`, `agent`, `requester`. Every user has exactly one role, stored server-side; new sign-ups default to `requester`. **Bootstrap rule (local dev)**: a user whose email local part starts with `admin+` (e.g. `admin+1@x.test`) is granted `admin` at sign-up. Users must never be able to change their own role — only admins change roles, via the users page below. Extend `GET /api/me` to also return the caller's `role`.

**Dashboards** — after sign-in (and when a signed-in user visits `/`), route by role: admin → `/admin`, agent → `/agent`, requester → `/tickets`. Visiting a page above your role (requester on `/admin` or `/agent`; agent on `/admin`) must redirect away or render 403 — and every underlying API must enforce the same rule server-side.

- `/admin`: ticket counts by status + link to `/admin/users`.
- `/admin/users`: table of all users (name, email, role) with a native `<select>` per row to change role, effective immediately; each `user-row` also carries a `data-user-id` attribute equal to that user's id.
- `/agent`: two lists — unassigned open tickets, and tickets assigned to me.

**Assignment**: admins assign any agent via a native `<select>` on the ticket detail; agents can self-assign unassigned tickets. Requesters cannot assign.

**Status workflow**: statuses are now `open | in_progress | resolved | closed`. Only the transitions below are legal. Reject everything else server-side (403 when the caller's role/identity is not allowed, 422 when the transition itself is illegal) and hide the corresponding buttons in the UI — a viewer sees buttons only for transitions they may perform.

| From | To | Allowed for |
|---|---|---|
| open | in_progress | assigned agent, admin (an assignee must be set) |
| in_progress | resolved | assigned agent, admin |
| in_progress | open | assigned agent, admin |
| resolved | closed | ticket requester, admin |
| resolved | open | ticket requester, admin |
| closed | open | admin only |

**Internal notes**: agents and admins can add notes to any ticket; requesters must never see them. Exclude note content server-side from every requester-visible response — not just the UI.

**Requesters** keep their Milestone 1 experience: only their own tickets, now with read-only status and assignee shown.

**New/changed API routes** (browser UI uses these; server enforces role + ownership):

| Route | Purpose |
|---|---|
| GET `/api/me` | now also returns the caller's `role` |
| GET `/api/admin/users`; PATCH `/api/admin/users/[id]` | list users / change role — admin only |
| POST `/api/tickets/[id]/transition` | body `{ "to": "<status>" }` |
| PATCH `/api/tickets/[id]` | now also accepts `assigneeId` (per assignment rules) |
| GET / POST `/api/tickets/[id]/notes` | agent/admin only |

**New data-testids**: `role-badge` (header), `admin-dashboard`, `agent-dashboard`, `users-table`, `user-row` (carries a `data-user-id` attribute), `user-role-select`, `queue-unassigned`, `queue-mine`, `ticket-assignee`, `assignee-select`, `assign-to-me`, `transition-open`, `transition-in_progress`, `transition-resolved`, `transition-closed`, `notes-section`, `note-input`, `note-submit`, `note-item`.
```

**CUJ suite (checkpoint 2)** — 12 CUJs ((R) = regression re-run of an M1 scenario, adapted to persona):

| #   | id                                    | Steps summary                                                                                          | Pass criterion                                                                                            |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | `m2-admin-bootstrap`                  | Sign up A (`admin+<ts>@…`)                                                                             | Lands on `/admin`; `admin-dashboard` visible; `role-badge` = `admin`                                      |
| 2   | `m2-promote-agent`                    | Sign up G (lands `/tickets`); A sets G's `user-role-select` → `agent` on `/admin/users`; G reloads     | G routed to `/agent`; `agent-dashboard` visible; select value persists after A reloads                    |
| 3   | `m2-create` (R: `m1-create`)          | Sign up R1; create ticket T1, priority `high`                                                          | Row with status `open` in R1's `ticket-list`                                                              |
| 4   | `m2-assign`                           | A opens T1, picks G in `assignee-select`                                                               | `ticket-assignee` shows G's name/email                                                                    |
| 5   | `m2-agent-queue`                      | G opens `/agent`                                                                                       | T1 listed under `queue-mine`                                                                              |
| 6   | `m2-self-assign`                      | R1 creates T2; G clicks `assign-to-me` on it from `queue-unassigned`                                   | T2 moves to `queue-mine`                                                                                  |
| 7   | `m2-happy-path`                       | G on T1: `transition-in_progress`, then `transition-resolved`; R1 opens T1, clicks `transition-closed` | Status displays `in_progress` → `resolved` → `closed` after each step                                     |
| 8   | `m2-reopen`                           | G resolves T2; R1 clicks `transition-open` on T2                                                       | T2 status back to `open`                                                                                  |
| 9   | `m2-button-gating`                    | R1 views own `open` ticket; G visits `/admin/users`                                                    | R1 sees no `transition-in_progress`/`transition-resolved` buttons; G is redirected/403 off `/admin/users` |
| 10  | `m2-notes`                            | G adds a note (unique marker string) on T1; A opens T1                                                 | `note-item` with marker visible to both G and A                                                           |
| 11  | `m2-notes-hidden`                     | R1 opens T1 (their own ticket)                                                                         | No `note-item`; marker string absent from entire page content                                             |
| 12  | `m2-isolation` (R: `m1-isolation-ui`) | Sign up R2; visit T1's URL                                                                             | `ticket-empty` for R2; T1 page 404/redirect, subject absent                                               |

**Security probes (checkpoint 2)** — raw HTTP with captured persona cookies:

| #   | id                                | Setup                                                        | Attack                                                                                | Pass criterion                                                                                                                     |
| --- | --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `m2-p-idor` (R: `m1-p-idor-read`) | T1 id known (from R1's `/api/tickets` id / detail URL)       | `GET /api/tickets/{T1}` as R2                                                         | 404/403; subject absent from body                                                                                                  |
| 2   | `m2-p-self-promote`               | R1's own user id from `GET /api/me` (as R1)                  | `PATCH /api/admin/users/{R1}` `{"role":"admin"}` as R1                                | 403; R1 still routed to `/tickets`, `/admin` still blocked                                                                         |
| 3   | `m2-p-agent-promote`              | R1's id captured from R1's `GET /api/me` during R1's session | `PATCH /api/admin/users/{R1}` `{"role":"admin"}` as G                                 | 403                                                                                                                                |
| 4   | `m2-p-user-list-leak`             | —                                                            | `GET /api/admin/users` as R1                                                          | 403; other personas' emails absent from body                                                                                       |
| 5   | `m2-p-skip-transition`            | Fresh `open` ticket, assigned to G                           | `POST …/transition` `{"to":"closed"}` as G                                            | 422 (any 4xx accepted); status still `open` in UI                                                                                  |
| 6   | `m2-p-role-transition`            | R1's own `open` ticket                                       | `POST …/transition` `{"to":"in_progress"}` as R1                                      | 403/4xx; status unchanged                                                                                                          |
| 7   | `m2-p-unassigned-transition`      | Unassigned `open` ticket                                     | `POST …/transition` `{"to":"in_progress"}` as G (not assignee)                        | 4xx; status unchanged                                                                                                              |
| 8   | `m2-p-notes-leak`                 | T1 has G's note (marker string)                              | As R1 (the ticket's owner): `GET /api/tickets/{T1}` and `GET /api/tickets/{T1}/notes` | Notes endpoint 403/404; detail response 200 but marker string absent — client-side filtering of an included field fails this probe |

### Milestone 3 — SLA, canned responses, user management, audit, hardening

**Prompt (verbatim)**:

```text
Final milestone: SLAs, canned responses, admin user management, an audit trail, and security hardening.

**SLA**: when a ticket is created, set its SLA due time server-side from priority: `high` = 4 hours, `medium` = 24 hours, `low` = 72 hours after creation. Admins can edit the due time on the ticket detail. A ticket is **overdue** when its due time is in the past and its status is neither `resolved` nor `closed`. Overdue tickets show an "Overdue" badge on every list row (all dashboards) and on the detail page.

**Replies & canned responses**: tickets get a public conversation: the requester (owner), the assigned agent, and admins can post replies. Requesters see replies but still never internal notes. Admins manage canned responses (title + body) at `/admin/canned`; on the ticket detail, agents/admins pick one from a native `<select>`, which fills the reply box for editing before sending.

**User management**: extend `/admin/users` with an active/deactivated state and a deactivate/reactivate button per row. Deactivation is immediate: every request carrying a deactivated user's existing session must be rejected server-side (401/403), and the UI shows a deactivated-account notice. Admins cannot deactivate themselves.

**Audit trail**: record every role change, activation change, and status transition — actor, event type (`role_change` | `activation_change` | `status_transition`), target, detail (old → new), timestamp. `/admin/audit` (admin-only) lists events newest first; each row renders the event type, actor email, target (user email or ticket subject), and detail.

**Hardening — recheck everything**: requesters must never be able to read other requesters' tickets or replies, nor any internal note content, through any endpoint. Enforce with server-side filtering by the authenticated user, and exclude note fields at the query/serialization level. Every route's role check lives on the server; client-side hiding alone is a failure.

**New/changed API routes**:

| Route | Purpose |
|---|---|
| GET / POST `/api/tickets/[id]/replies` | participants only (owner, assigned agent, admins) |
| GET `/api/canned-responses` | agent/admin |
| POST `/api/admin/canned-responses`; DELETE `/api/admin/canned-responses/[id]` | admin only |
| PATCH `/api/admin/users/[id]` | now also `{ "active": boolean }` — admin only, not self |
| GET `/api/admin/audit` | admin only |
| PATCH `/api/tickets/[id]` | now also `slaDueAt` — admin only |

**New data-testids**: `sla-due`, `sla-due-input`, `sla-due-save`, `overdue-badge`, `reply-input`, `reply-submit`, `reply-item`, `canned-title`, `canned-body`, `canned-submit`, `canned-row`, `canned-select`, `user-deactivate`, `user-status`, `account-deactivated`, `audit-table`, `audit-row`.
```

**CUJ suite (checkpoint 3)** — 12 CUJs:

| #   | id                                                               | Steps summary                                                                   | Pass criterion                                                                               |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `m3-setup` (R: `m2-admin-bootstrap`, `m2-promote-agent`)         | Sign up A, G (promoted by A), R1, R2                                            | Role routing as in M2 CUJs 1–2                                                               |
| 2   | `m3-sla-set`                                                     | R1 creates ticket, priority `high`                                              | `sla-due` present on detail; parsed time within 3.5–4.5h of now                              |
| 3   | `m3-overdue`                                                     | A sets `sla-due-input` to yesterday, `sla-due-save`                             | `overdue-badge` visible on detail and on the row in R1's `/tickets` list                     |
| 4   | `m3-overdue-clears`                                              | A assigns G; G runs `in_progress` → `resolved` on the overdue ticket            | `overdue-badge` no longer shown                                                              |
| 5   | `m3-canned-crud`                                                 | A creates canned response (unique marker body) at `/admin/canned`               | `canned-row` with title visible; survives reload                                             |
| 6   | `m3-canned-apply`                                                | G picks it in `canned-select` on an assigned ticket, edits, `reply-submit`      | `reply-input` was prefilled with marker body; `reply-item` appears with final text           |
| 7   | `m3-reply-thread`                                                | R1 opens own ticket, sees G's reply, posts one back; G reloads                  | Both `reply-item`s visible to both parties, oldest→newest                                    |
| 8   | `m3-deactivate`                                                  | A clicks `user-deactivate` on R2; R2 (signed-in session) reloads `/tickets`     | `user-status` shows deactivated; R2 sees `account-deactivated` notice, no ticket data        |
| 9   | `m3-reactivate`                                                  | A reactivates R2; R2 reloads                                                    | R2's `/tickets` works again                                                                  |
| 10  | `m3-audit-role`                                                  | A opens `/admin/audit`                                                          | An `audit-row` contains `role_change`, A's email, G's email, `requester → agent`             |
| 11  | `m3-audit-transitions`                                           | same page                                                                       | `audit-row`s for the CUJ-4 transitions with actor G and `in_progress → resolved` detail      |
| 12  | `m3-workflow-regression` (R: `m2-happy-path`, `m2-notes-hidden`) | Fresh ticket by R1: assign, full legal chain to `closed`; G adds note; R1 views | Each transition succeeds; R1 sees only legal buttons at each stage and never the note marker |

**Security probes (checkpoint 3)** — 10 probes:

| #   | id                                               | Setup                                                        | Attack                                                                   | Pass criterion                                                   |
| --- | ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 1   | `m3-p-dead-cookie-read`                          | R2's cookie captured before deactivation (CUJ 8)             | `GET /api/tickets` with that cookie while deactivated                    | 401/403; no ticket data in body                                  |
| 2   | `m3-p-dead-cookie-write`                         | same                                                         | `POST /api/tickets` with that cookie                                     | 4xx                                                              |
| 3   | `m3-p-self-promote` (R: `m2-p-self-promote`)     | R1's own user id from `GET /api/me` (as R1)                  | `PATCH /api/admin/users/{R1}` `{"role":"admin"}` as R1                   | 403; role unchanged                                              |
| 4   | `m3-p-audit-leak`                                | —                                                            | `GET /api/admin/audit` as R1 and as G                                    | 403 both; no event rows in body                                  |
| 5   | `m3-p-replies-idor`                              | R1's ticket id (from R1's `/api/tickets`)                    | `GET /api/tickets/{id}/replies` as R2 (reactivated)                      | 403/404; reply text absent                                       |
| 6   | `m3-p-note-serialization` (R: `m2-p-notes-leak`) | Note marker on R1's own ticket (id from R1's `/api/tickets`) | As R1: `GET /api/tickets/{id}` and `GET /api/tickets/{id}/replies`       | 200s allowed, but note marker string absent from both raw bodies |
| 7   | `m3-p-canned-leak`                               | —                                                            | `GET /api/canned-responses` and `POST /api/admin/canned-responses` as R1 | 403 on both; canned body text absent                             |
| 8   | `m3-p-agent-deactivate`                          | R1's id captured from R1's `GET /api/me` during R1's session | `PATCH /api/admin/users/{R1}` `{"active":false}` as G                    | 403; R1's session still works                                    |
| 9   | `m3-p-admin-self-deactivate`                     | A's own id from `GET /api/me` (as A)                         | `PATCH /api/admin/users/{A}` `{"active":false}` as A                     | 4xx; A's session still works                                     |
| 10  | `m3-p-sla-edit-role`                             | ticket id (from a pinned ticket list / detail URL)           | `PATCH /api/tickets/{id}` `{"slaDueAt": <past>}` as G                    | 403; `sla-due` unchanged in UI                                   |

### Judge rubric additions

1. **Single-source transition matrix**: the M2 workflow rules are encoded once (a shared map/table consulted by the transition endpoint, with UI buttons derived from the same source or from a server-provided "allowed transitions" list) — duplicated per-button `if` chains score low even if probes pass.
2. **Centralized authorization**: a reusable server-side guard (role + ownership) applied across all `/api` routes, rather than ad-hoc checks copy-pasted per handler; internal-note redaction done by query/column selection, not post-fetch filtering.
3. **Audit integrity**: audit rows are written in the same server code path (ideally the same transaction) as the role change / transition, so no mutation path can skip the trail.
4. **Per-request deactivation enforcement**: the `active` check runs on every authenticated request (middleware/guard), not only at sign-in.

### Estimated agent effort

Per-milestone turn caps are 15 min (M1), 20 min (M2), and 25 min (M3); a turn that hits its cap ends with outcome `truncated` (distinct from `agent_gave_up` / `infra_error` / `build_failed`) — the partial snapshot is still built and scored as-is, just flagged.

- **M1** — easy, achievable by the weakest model: ~2–5 assistant turns, ~10–20 file writes, roughly 150–300k total tokens, 5–10 min wall-clock (well inside the 15-min cap). Differentiation comes mostly from testid/route contract compliance and validation polish, not capability.
- **M2** — the core differentiator for mid-tier models: ~4–8 turns, ~300–600k tokens, 10–15 min against the 20-min cap. The transition matrix + role-scoped queries + note redaction is where client-side-only gating and matrix bugs (skip transitions, unassigned-agent transitions) appear; probes 5–8 carry most of the signal.
- **M3** — top-model differentiator: ~5–10 turns, ~400–800k tokens (cumulative codebase re-reading dominates input tokens), 12–18 min, the milestone most likely to approach its 25-min turn cap (a turn that hits it ends `truncated` and is scored as-is). Cross-cutting concerns (per-request deactivation, transactional audit, serialization-level note exclusion across two endpoints, admin-only SLA edits) require touching many existing files without regressing M2 — CUJ 12 and probes 3/6 measure exactly that.
