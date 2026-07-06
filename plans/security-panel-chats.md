# Reuse Existing Security Fix Chats

## Summary

When a user clicks `Fix Issue` or `Fix N Issues` in the Security panel, Dyad should reopen the existing fix chat for that security finding instead of creating duplicate chats. If no fix chat exists yet, Dyad should create one, show it immediately, run the fix prompt, and record the association for future clicks.

When an existing fix chat is reopened, Dyad does not automatically resend the prompt; instead it shows a toast with a `Re-run fix` action so the user can explicitly send the fix prompt again into the same chat. This also covers the recovery case where the fix chat was created but the original prompt never ran (stream failure, app quit).

The Security panel should remain visible on the right. The chat pane should be forced open so the user can see the fix run or review the prior fix chat.

## Key Changes

- Add a durable `security_fix_chats` SQLite table:
  - Columns: `appId`, `reviewChatId`, `findingKey`, `fixChatId`, `createdAt`.
  - Foreign keys, all with cascade delete: `appId` → `apps.id`, `reviewChatId` → `chats.id`, `fixChatId` → `chats.id`. Deleting the fix chat removes the mapping, so the next click creates a fresh fix chat (intended behavior).
  - Unique index on `(appId, reviewChatId, findingKey)`.
- Generate the Drizzle migration with `npm run db:generate`; do not write migration SQL by hand.
- Add a new security IPC endpoint, `getOrCreateSecurityFixChat`, taking `{ appId, reviewChatId, findings }` and returning `{ chatId, created }`.
  - Validate `findings` with `z.array(SecurityFindingSchema).min(1)`.
  - Make get-or-create atomic: `insert ... onConflictDoNothing()` against the unique index, then re-select — no check-then-insert, so a double-click cannot create two chats.
  - Create the chat via the same logic as the `createChat` handler (extract a shared helper) so `initialCommitHash` is captured — do not do a bare `db.insert(chats)`.
  - Give the chat a meaningful title: `Fix: <finding title>` for a single finding, `Fix <N> security issues` for multi-select.
- Compute `findingKey` in the main process from normalized finding data:
  - Single finding: sha256 of `title|level|description` (fields trimmed). Do not store raw JSON as the key — descriptions can be kilobytes and this is an indexed column.
  - Multi-select: sha256 of the sorted per-finding hashes joined, so the same selected set reuses the same fix chat regardless of selection order.
- Update `SecurityPanel`:
  - Call `getOrCreateSecurityFixChat` from both single-finding and multi-select fix flows.
  - Always set `isChatPanelHiddenAtom` to `false` and select the returned chat immediately. Also set it to `false` in `handleRunSecurityReview` for consistency.
  - Only call `streamMessage` automatically when `created === true`.
  - When `created === false`:
    - Do not send another prompt automatically.
    - Immediately clear the fixing state (`fixingFindingKey` / `isFixingSelected`) — there is no stream, so no `onSettled` will fire.
    - Show a sonner toast (e.g. `toast.info("Opened existing fix chat", { action: { label: "Re-run fix", onClick } })`) whose action streams the same fix prompt into the existing chat, with the normal fixing state and `onSettled` handling.

## Public Interfaces

Add a new IPC contract under `securityContracts`:

```ts
input: {
  appId: number;
  reviewChatId: number;
  findings: SecurityFinding[]; // min 1
}

output: {
  chatId: number;
  created: boolean;
}
```

`getLatestSecurityReview` already returns `chatId`; use that value as `reviewChatId`.

## Test Plan

- Add E2E coverage in `e2e-tests/security_review.spec.ts`:
  - Run a security review.
  - Click `Fix Issue`; assert the fix prompt appears.
  - Switch back to Security and click the same `Fix Issue` again.
  - Assert the selected chat is the same chat and no duplicate fix prompt or chat tab is created; assert the "existing fix chat" toast appears.
  - Click the toast's `Re-run fix` action; assert a second fix prompt is sent into the same chat (no new chat).
  - Multi-select reuse: select the same set of findings twice — same chat; select a different set — new chat.
  - Include the hidden-chat case: hide chat first, click `Fix Issue`, and assert the existing or new fix chat is visible.
  - Deleted-fix-chat case: delete the fix chat, click `Fix Issue` again, assert a new fix chat is created.
- Run:

```sh
npm run build
PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/security_review.spec.ts
```

## Assumptions

- "Already clicked" means the same finding from the same security review chat. Re-running the security review creates a new review chat, so an identical still-unfixed finding from the new review gets a fresh fix chat — this is intended (fresh review, fresh context).
- Re-clicking opens the existing fix chat only; it does not rerun the agent or create a new chat. Re-running is an explicit user action via the toast's `Re-run fix` button.
- Multi-select fix gets the same reuse behavior for the exact selected set; overlapping-but-different sets create separate chats.
