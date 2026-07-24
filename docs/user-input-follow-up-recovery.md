# User-input follow-up recovery

This is the lightweight alternative to the durable cross-machine handoff
proposed in PR 8 of `plans/state-machines-hardening.md`. It fixes the #4047
orphaned-queue failure without adding a second persisted lifecycle.

## Ownership and identity

The main-process `userInputRegistry` owns consent, questionnaire, and
integration follow-ups for the lifetime of the app process. A follow-up remains
`due` until chat-stream reports that main accepted its user message, or until a
queue action explicitly rejects it.

The user-input request ID is also the stable idempotency key at the chat
receiver. That is separate from the chat-stream `InvocationRef`, which
correlates one renderer-to-main stream attempt. Rehydration may create several
invocations with the same request ID; the receiver's existing unique
`(chat_id, user_input_request_id)` message constraint makes those acceptance
attempts idempotent.

## Recovery protocol

Renderer startup subscribes to user-input events before calling `getPending`.
Every `due` follow-up is submitted through the injected chat-stream facade with
a typed `user-input-follow-up` queue owner. Submitting the same owner again
refreshes its callbacks instead of appending another queue item.

Main acknowledges acceptance through the existing chat chunk only after the
idempotent user-message insert. The renderer then settles the memory owner as
`dispatched`. If notification or dispatch fails first, the owner stays `due`;
renderer remount, focus, or another retry pass can submit it again safely.

Machine-owned queue items are never written to queue persistence. Queue delete
and bulk-clear atomically claim their current items so the queue driver cannot
start them, then reject each owner. Failed settlement restores the item and
surfaces the error. Ordinary chat errors do not sweep a `due` follow-up, while
explicit chat deletion settles all requests for that chat. Parent app deletion
and full reset likewise settle affected memory owners before database rows are
deleted, so cascades cannot strand follow-ups targeting missing entities.

## Restart boundary

A renderer crash or reload keeps the main registry alive, so hydration rebuilds
the queue entry with fresh callbacks. A full app-process restart intentionally
drops the memory-owned request. Because its queue entry was never persisted,
there is no callback-less immutable orphan to restore.

This design does not promise durable delivery across full app restarts or
exactly-once model execution. It targets the observed #4047 renderer-lifetime
failure with minimal state: at-least-once acceptance attempts inside one app
process, receiver-side message deduplication, and no persisted state whose
authority is memory-only.
