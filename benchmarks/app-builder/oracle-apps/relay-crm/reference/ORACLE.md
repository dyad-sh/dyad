# Relay CRM — oracle reference implementation

A reference build of **Relay CRM** that scores **100% on all three CUJ
checkpoints**. It exists so a scoring run can validate itself: if this app ever
scores below 100%, the harness (or its environment) is broken, not the app under
test.

## Final scores

| Checkpoint | Suite                                | Result             |
| ---------- | ------------------------------------ | ------------------ |
| 1          | `cuj-tests/relay-crm/checkpoint-1.spec.ts` | **12 / 12 passed** |
| 2          | `cuj-tests/relay-crm/checkpoint-2.spec.ts` | **18 / 18 passed** |
| 3          | `cuj-tests/relay-crm/checkpoint-3.spec.ts` | **20 / 20 passed** |

Verified repeatedly, not once: after the last app change checkpoint 3 ran green
10 consecutive times, checkpoints 1 and 2 three times each. No test in any suite
was modified.

`schema.sql` applies cleanly to an empty database and is idempotent on re-apply
(every object is `IF NOT EXISTS`).

## How to run it

`neon-sim` must be running (see `../../neon-sim/README.md`). From
`benchmarks/app-builder/`:

```bash
./oracle/run-suite.sh oracle/relay-crm/reference relay-crm 3 3600   # 20/20
./oracle/run-suite.sh oracle/relay-crm/reference relay-crm 2 3600   # 18/18
./oracle/run-suite.sh oracle/relay-crm/reference relay-crm 1 3600   # 12/12
```

Add a 5th argument to grep a single test, e.g. `… relay-crm 3 3600 crm-m3-07`.
Each invocation provisions a fresh project + database, applies `schema.sql`,
installs, builds, serves on the given port and runs that checkpoint's suite. The
server log path is printed at the end; runtime SQL/auth errors surface there.

`schema.sql` is the whole story for the database. It contains only the app's own
`public` objects — `neon_auth` (`user`, `session`, `account`, `verification`) is
provisioned by the managed better-auth service when a branch's auth provider is
created, so including it would make the file fail to apply. The file ends with a
`DO` block that hands every table to the *database owner*: on a real Neon branch
the app's own role runs the DDL and owns the result, but the oracle harness
applies the file as an administrator, and without the handover the app's role
gets `permission denied for table …` on its first query. Nothing in the file
names a specific role, so it stays portable.

## What changed vs. the base model output

Starting point: `results/s-cell/checkouts/claude-opus-5-relay-crm` at
`checkpoint-m3` (the best recorded Relay CRM run — 13/20 at checkpoint 3), with
`schema.sql` derived from that cell's ckpt3 snapshot database. Changes are
grouped by the defect that motivated them.

### 1. Sign-up minted four workspaces (root cause of most failures)

Sign-in fans out into several concurrent server requests (layout, page,
`/api/me`), and each independently ran "this user has no workspace, create one".
The check raced with itself, so a single sign-up produced up to four identical
`<name>'s Workspace` rows — the switcher rendered four buttons, and records
landed in whichever one happened to be active at that moment.

- `schema.sql`: `workspaces.is_personal boolean` plus the partial unique index
  `idx_workspaces_one_personal_per_owner (owner_id) WHERE is_personal`.
- `src/lib/workspace.ts`: `ensureWorkspace` now inserts with
  `ON CONFLICT (owner_id) WHERE is_personal DO NOTHING` and re-selects the
  winner, so the racing requests converge on one workspace. User-created
  workspaces are unaffected (`is_personal` stays false).

### 2. Mutations were lost when the browser navigated in the same tick

`crm-m1-08` clicks *delete confirm* and immediately `goto`s the list;
`crm-m2-06` changes a kanban stage `<select>` and immediately reloads. Both
requests were cancelled in flight or overtaken by the render that followed, so
the UI repainted the pre-mutation state and the tests failed. Two independent
fixes, because either alone still leaves a window:

- Every client mutation now uses `fetch(…, { keepalive: true })`, so navigating
  away cannot cancel a request that has already been sent.
- New `src/lib/write-barrier.ts` — a per-client read-your-writes barrier keyed on
  the caller's session cookies. `serializeWrite` runs one client's mutations in
  submission order; `awaitWrites` makes that client's reads wait for its own
  in-flight mutations. Unrelated users never wait on each other, and it is
  coordination only: tenancy, role and ownership are still enforced by the SQL
  predicates in every query.

This also fixed a second-order bug: "create a contact" followed immediately by
"switch workspace" could interleave and file the contact in the wrong workspace.

### 3. Request bodies could name a foreign workspace

Milestone 2 says a client-supplied workspace id must be rejected whether it
arrives "in a query string, header or request body". The base app checked the
query string and the header but not the body.

- `requestedWorkspaceId(request, body)` now also reads `workspaceId` /
  `workspace_id` from the parsed body.
- All JSON endpoints moved onto two entry points in `src/lib/workspace.ts`:
  `query()` (waits for the client's writes, resolves + authorizes the workspace)
  and `mutate()` (serialises the client's writes, parses the body once, resolves
  + authorizes the workspace including any id the body tried to smuggle in).
  `mutateWorkspace()` is the variant for the member/invite routes, where the
  workspace comes from the path. This removed the copy-pasted try/catch in all
  16 route files and put the hardening in one place.

Effect on `crm-m3-s04`: a member PATCHing their own contact with
`workspaceId: <a workspace they do not belong to>` now gets 403 and the record is
untouched, instead of being renamed. Fields that are merely non-settable (`id`,
`ownerId`, `role`, `membershipId`) are still silently ignored, as milestone 3
requires.

### 4. Activity timeline showed only an email as the actor

`crm-m3-05` asserts `activity-item-actor` names the person. Entries stored
`actor_email` only.

- `schema.sql`: `activities.actor_name text NOT NULL DEFAULT ''`.
- `src/lib/activities.ts` records the actor's name; the timeline renders
  `name · email`.
- System-entry wording was also trimmed to "Contact created" / "Contact updated"
  so the body reads as an event rather than repeating the actor.

### 5. Two controls that Playwright could not address unambiguously

Neither is cosmetic — both make a documented interaction unusable.

- `member-remove-confirm` was rendered on *every* member row, so
  `page.getByTestId("member-remove-confirm").click()` was ambiguous (strict-mode
  violation) as soon as a workspace had two members. The confirmation now exists
  only for the row whose *Remove* was pressed.
- `contacts-empty` was rendered *inside* `contacts-list`, so "the list or the
  empty state" matched two elements. The empty state now replaces the list.

### 6. Workspace switching relied on a soft router refresh

`router.refresh()` after a switch can be repainted by an older, still-in-flight
RSC payload, leaving the previous workspace's name in the header (observed once
as a `crm-m3-07` flake). Switching tenants invalidates every cached segment and
the record on screen usually does not exist in the new workspace, so the switcher
now does a full navigation to `/contacts`.

## Harness note

`oracle/run-suite.sh` briefly lost the line continuation after
`APP_URL="http://localhost:$PORT"` while another change was landing, which left
`APP_URL` unset so every suite ran against `http://localhost:3000` and scored
`0/N`. Restored. If this reference ever scores 0/N, check that line first — a
uniform zero is a harness symptom, never an app symptom.

## SUSPECTED SUITE DEFECTS

None. Every checkpoint-3 assertion is satisfiable by a spec-faithful app.

`crm-m3-s04` deserves a note because it looks unsatisfiable at first read: it
asserts the owner's `/api/contacts` still contains `"Mine"` after a member
PATCHes that contact with `{ name: "Renamed …", workspaceId: <foreign> }`. If the
foreign `workspaceId` is merely ignored, the rename succeeds and the name
`"Mine …"` is gone. It is satisfiable, and by the spec rather than around it:
milestone 2 requires a body-supplied workspace id for a workspace the caller does
not belong to to be answered with **403 and no data**, which leaves the record —
and its name — untouched. The design table's "Regardless of status …" wording
covers the 403.
