# Relay CRM — oracle broken twin

A copy of `../reference/` (which scores 12/12, 18/18, 20/20) with
**authorization deliberately removed**. It is the negative control of the
oracle: the reference proves the harness can score a correct app, and this twin
proves the harness can *catch* an incorrect one.

The bar is per-checkpoint and per-probe, not per-app: **every security probe at
every checkpoint must fail here**. A probe that passes this twin has never been
demonstrated to detect anything and must be treated as unvalidated —
`preflight.sh` enforces exactly that and refuses to score model cells otherwise.

Everything else is untouched — same `schema.sql`, same UI, same non-security
behaviour — so a probe failure is attributable to a named defect and nothing
else.

## Scores

| Checkpoint | Reference | Broken twin | Probes tripped | Failing probes              |
| ---------- | --------- | ----------- | -------------- | --------------------------- |
| 1          | 12 / 12   | **10 / 12** | 2 / 2          | `crm-m1-s01`, `crm-m1-s02`  |
| 2          | 18 / 18   | **12 / 18** | 6 / 6          | `crm-m2-s01` … `crm-m2-s06` |
| 3          | 20 / 20   | **12 / 20** | 8 / 8          | `crm-m3-s01` … `crm-m3-s08` |

Every non-probe CUJ passes at all three checkpoints: the twin's deficit is
exactly the probe count (2, 6, 8). No collateral CUJ failures.

```bash
./oracle/preflight.sh relay-crm 1 4200   # reference 12/12, twin 10/12, all 2 probes tripped
./oracle/preflight.sh relay-crm 2 4200   # reference 18/18, twin 12/18, all 6 probes tripped
./oracle/preflight.sh relay-crm 3 4200   # reference 20/20, twin 12/20, all 8 probes tripped
```

## The defect table

`grep -rn "ORACLE-DEFECT" src/` is the full inventory; every site carries its
defect id and the probes it is meant to trip. Line numbers are as of this
revision.

| Defect  | Site(s)                                                                                                 | Class                                           | Probes tripped                             | Observed result                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **D1**  | `src/lib/workspace.ts:196`                                                                              | role check is a no-op                           | `crm-m3-s01`, `crm-m3-s08`                 | viewer `POST /api/contacts` → **201**; viewer `PATCH /api/deals/{id}` → **200**                                 |
| **D2**  | `src/lib/workspace.ts:208`                                                                              | owner check is a no-op                          | `crm-m3-s02`, (`crm-m3-s03`)               | member `GET /api/workspaces/{W1}/members` → **200** with the full roster                                        |
| **D3**  | `src/lib/queries.ts:116`, `src/lib/activities.ts:8`, `src/app/api/contacts/[id]/activities/route.ts:10` | missing tenant filter                           | `crm-m3-s05`                               | outsider `POST /api/contacts/{adaId}/activities` → **201**; forged note renders on the victim's timeline        |
| **D4**  | `src/lib/workspace.ts:160`, `src/app/api/contacts/[id]/route.ts:63`, `src/lib/queries.ts:138,177`       | trusts a client-supplied workspace id           | `crm-m3-s04`, `crm-m2-s03`                 | foreign `workspaceId` silently **ignored (200)** instead of 403; a PATCH carrying it re-homes the record        |
| **D5**  | `src/app/api/export/contacts.csv/route.ts:32`                                                           | auth error swallowed                            | `crm-m3-s06`                               | unauthenticated `GET /api/export/contacts.csv` → **200** with the whole contacts table                          |
| **D6**  | `src/lib/members.ts:249`, `src/lib/workspace.ts:122,172`                                                | revocation does not revoke a live session       | `crm-m3-s07`                               | after removal the member's `GET /api/contacts` still returns W1's contacts                                      |
| **D7**  | `src/app/api/contacts/route.ts:22`, `src/lib/queries.ts:76`                                             | auth error swallowed → unscoped read            | `crm-m1-s01`, `crm-m2-s05`                 | anonymous `GET /api/contacts` → **200** with every contact row (name + email) in the database                   |
| **D8**  | `src/app/api/contacts/[id]/route.ts:27,57,101`                                                          | tenant derived from the record, not the session | `crm-m1-s02`, `crm-m2-s01`, `crm-m2-s02`   | outsider `GET /api/contacts/{adaId}` → **200** containing `Ada …`; outsider `PATCH` → **200**                   |
| **D9**  | `src/lib/members.ts:142`, `src/app/api/invites/[id]/accept/route.ts:16`                                 | possession of an id treated as authorization    | `crm-m2-s04`                               | outsider `POST /api/invites/{inviteId}/accept` → **200**; outsider joins a workspace nobody invited them to     |
| **D10** | `src/lib/deals.ts:37`, `src/app/(app)/deals/[id]/page.tsx:17`                                           | missing tenant filter on a page                 | `crm-m2-s06`                               | outsider `GET /deals/{dealId}` → **200** HTML rendering `deal-detail-title` = `Deal ${RUN_ID}`                  |

### D1 — the write-role check is a no-op → `crm-m3-s01`, `crm-m3-s08`

`requireWrite()` returns unconditionally. Every route still calls it and the UI
still hides mutating controls from viewers via `canWrite`, so the app looks
correct in a browser — only the JSON API is open.

### D2 — the owner check is a no-op → `crm-m3-s02`, (`crm-m3-s03`)

`requireOwner()` returns unconditionally. `/settings/members` still gates itself
with `canManageMembers`, so `crm-m3-04` ("member cannot reach members
management") still passes; the roster, invite, remove and role-change endpoints
are open to any member.

### D3 — the activity timeline has no tenant filter → `crm-m3-s05`

`getContactAnyWorkspace(id)` is a lookup by primary key with no workspace
predicate; both activity handlers use it, so "does this contact exist" stands in
for "may this caller see it". `listActivities` no longer filters on workspace
either, so a note filed by an outsider under *their* workspace renders on the
victim's timeline.

### D4 — client-supplied workspace id, twice → `crm-m3-s04`, `crm-m2-s03`

Two halves; either alone is harmless, together they re-home a record across
tenants.

- `getWorkspaceContext` **silently ignores** a requested workspace id the caller
  does not belong to instead of answering 403 with no data; the request proceeds
  against the caller's own active workspace.
- The contact PATCH copies `workspaceId`/`workspace_id` out of the request body
  onto the record, and `updateContact` writes it.

`crm-m2-s03` was tightened to require a 403 for a client-supplied foreign
workspace id (m2.md pins "respond 403 and return no data"); the silent-ignore
half trips it on status. See "What this twin taught us" — that status check is
the probe's only exercised assertion here.

### D5 — the CSV export does not require a session → `crm-m3-s06`

Auth + tenant resolution is wrapped in a `try` whose `catch` "degrades
gracefully" to exporting every contact in the database. An authenticated caller
still gets only their active workspace, which is why the export CUJ `crm-m3-07`
keeps passing and only the probe notices.

### D6 — removal does not revoke a live session → `crm-m3-s07`

`removeMember` deletes the membership row but no longer clears the removed
user's `user_settings.active_workspace_id`, and `getWorkspaceContext` trusts
that stored pointer on its own. Authorization becomes "what was this session
last pointed at" instead of "is this user still a member". (Their `/api/me`
`memberships` correctly drops the workspace — which is exactly why the probe has
to check the data too.)

### D7 — the contacts list does not require a session → `crm-m1-s01`, `crm-m2-s05`

`GET /api/contacts` treats resolving the caller and their workspace as
best-effort: on `WorkspaceAccessError` (no session, expired cookie, no
membership) it "degrades gracefully" to `listAllContacts()` — an unscoped read
of the whole table — instead of answering 401.

Authenticated callers still get exactly their active workspace, so every list
CUJ, the workspace-isolation CUJ `crm-m2-02` and the id-provenance helper
`findIdByValue` are unaffected. Only the unauthenticated probes notice.

Verified directly against a running twin, not only through the probe:

```
$ curl -s -o body.json -w '%{http_code}\n' http://localhost:4321/api/contacts
200
$ head -c 160 body.json
[{"id":"6b5e979b-…","workspace_id":"1111…","name":"Ada ORACLE-PROOF","email":"ada@victim.test",…
```

### D8 — the tenant comes from the record, not the session → `crm-m1-s02`, `crm-m2-s01`, `crm-m2-s02`

`/api/contacts/[id]` resolves the workspace to operate in by looking the contact
up by primary key and using **the workspace the record says it belongs to**
(`recordWorkspaceId`). The session is still required and still resolved, but its
membership is never compared with the record's workspace, so any signed-in user
holding a contact id can read, edit and delete that contact across tenants.

Same-workspace requests resolve to exactly `ctx.workspaceId`, so behaviour is
identical for every legitimate flow — which is why `crm-m1-05/06/07/08` and the
M2/M3 contact CUJs all still pass.

### D9 — a leaked invite id is enough to join a workspace → `crm-m2-s04`

`acceptInvite` no longer compares the invite's address to the session's. Holding
the invite id is treated as proof of entitlement — the classic capability-URL
argument ("the id is a random UUID and `/invites` only ever lists your own"), so
authorization lives entirely in which ids the UI shows you. The legitimate
invitee's flow is unchanged, so `crm-m2-03`, `crm-m2-04` and every
`joinWorkspace`-based CUJ keep passing.

### D10 — the deal detail page has no tenant filter → `crm-m2-s06`

`/deals/[id]` looks the deal up with `getDealAnyWorkspace(id)`.
`pageWorkspaceContext()` still runs, so signed-out visitors are still redirected
to sign-in, but the resolved workspace is never compared with the deal's. The
kanban list query stays scoped, so the board CUJs and the JSON API are
unaffected — only direct navigation leaks.

## What this twin taught us about the probes

1. **Before D7–D10, eight probes had never detected anything.** The twin scored
   12/12 at checkpoint 1 and 18/18 at checkpoint 2 — identical to the reference.
   `crm-m2-s03` was the only M2 probe with any coverage at all, and only
   incidentally, because M3's D4 happens to trip it. Checkpoints 1 and 2 are now
   covered by construction rather than by luck.
2. **`crm-m3-s03` does not detect a missing owner check.** (Verified in the
   session that built D1–D6.) With D1 restored and D2 still in place — a
   member-role endpoint with *zero* server-side authorization — s03 **passes**.
   Its two escalation PATCHes are answered 403 by an unrelated business rule in
   `updateMemberRole` ("You cannot change your own role"), because the probe only
   ever tries to change its *own* role. s03 fails in this twin solely on its
   trailing line-546 assertion, which re-tests D1.
3. **`crm-m3-s02` detects the missing owner check on only one of its four
   attempts.** (Same session; verified by restoring `requireOwner` one call site
   at a time.)
   - (a) roster enumeration — the real detection, a 200 with every member's
     email and membership id.
   - (b) `POST …/invites {role:"owner"}` → **400**, not 403: the route rejects
     `owner` as an invitable role before authorization ever matters. The probe
     notices only because it demands exactly 403. Had the member asked for
     `role:"member"`, the invite would have been created by an unguarded
     endpoint and the probe would have seen nothing.
   - (c) `DELETE …/members/{ownerMembershipId}` → **400**, not 403: blocked by
     "a workspace must always have at least one owner". Again status-only.
   - (d) self-promotion → 403 from the same self-role rule as s03. With the
     owner check removed *only* from that route, s02 **passes**.
4. **`crm-m2-s03`'s data assertions are still unexercised.** The probe fails on
   its first assertion (`expect([401,403]).toContain(200)`) on the very first
   attempt; `expect(text).not.toContain(ADA)` and `…(DEAL)` never run against
   this twin. That is the tightening working as designed — a silently-ignored id
   is *only* visible as a status code — but the leak assertions themselves still
   have no negative control. A variant that honours a foreign workspace id
   (rather than ignoring it) would exercise them.
5. **Six of the eight checkpoint-1/2 failures land on a status assertion, not a
   body assertion.** For `crm-m1-s01`, `crm-m1-s02`, `crm-m2-s01`, `crm-m2-s02`,
   `crm-m2-s04` and `crm-m2-s05` the twin answers 200 where 401/403/404 was
   required, so the probe aborts before its `not.toContain(record)` line. The
   leak is real in each case (D7's body is dumped by hand above; `crm-m2-s06`
   *does* fail on its body assertion, since a 200 HTML page is permitted), but
   the API probes' body assertions remain unproven. They are cheap insurance
   against an app that answers 403 and leaks anyway — nothing in this twin
   demonstrates they would catch it.
6. **`crm-m2-s02`'s DELETE leg and `crm-m2-s04`'s follow-up assertions never
   run.** s02 aborts on the PATCH status, so the delete-authorization check and
   the "owner re-read still shows Ada" check are untested; s04 aborts on the
   accept status, so "owner's roster unchanged", "outsider's `/api/me` excludes
   W1" and "still acceptable by the real invitee" are untested. Anything that
   only those trailing assertions could catch is not covered by this control.
