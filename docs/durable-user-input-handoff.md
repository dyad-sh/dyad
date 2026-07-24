# Durable user-input follow-up handoff

This is the protocol design for PR 8 of
`plans/state-machines-hardening.md`. It is intentionally specific to the
`user_input` → `chat_stream` pilot. A shared handoff API is deferred until this
pilot proves that one is useful.

## Ownership and record

The main-process `user_input` registry owns the request while it is live. Each
registry construction mints an owner-session ID. SQLite stores one versioned
`user_input_follow_up_handoffs` row:

| Field                                    | Meaning                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `request_id`                             | Primary key and stable delivery idempotency key                   |
| `schema_version`                         | Record version; initially `1`                                     |
| `owner_session_id`                       | Main-process registry lifetime that can settle the request        |
| `chat_id`, `prompt`                      | Immutable receiver payload                                        |
| `status`                                 | `created`, `accepted`, `executing`, `acknowledged`, or `rejected` |
| `attempt_count`, `last_error`            | Retry diagnostics                                                 |
| `created_at`, `updated_at`, `settled_at` | Retention and pruning timestamps                                  |

`request_id` is the idempotency identity. The `InvocationRef` minted when
`chat_stream` actually starts an attempt is its correlation identity. They are
deliberately distinct: retries keep the request ID and receive a new invocation
reference.

SQLite is used instead of settings because the handoff has keyed records,
conditional state transitions, retention queries, and must join an existing
chat-message acceptance transaction. Settings provide none of those
transactional guarantees.

## Acceptance and acknowledgement

The sender first commits a `created` row before broadcasting that a follow-up
is due. If that commit succeeds but renderer notification fails, renderer
hydration obtains the live request from `user_input`; redelivery uses the same
request ID.

The receiver accepts by transactionally changing the row from `created` to
`accepted`. Replaying the same immutable payload returns the existing accepted
or executing row; a different payload is rejected as an idempotency-key
collision. The facade reports acceptance to `user_input` only after this
transaction commits. A renderer-local enqueue is therefore a projection of
durable acceptance, never the acceptance point itself.

Before an attempt, the receiver changes `accepted` to `executing` and increments
`attempt_count`. Main-process chat-turn acceptance then inserts the user message
and changes the handoff to `acknowledged` in the same SQLite transaction. The
accepted-user-input chunk is emitted only after that transaction commits, and
only then does the facade settle the owning registry as acknowledged. The
unique `(chat_id, user_input_request_id)` message index is receiver-side durable
deduplication: delivery is at least once, while execution is not claimed to be
exactly once.

## Cancellation and removal

- Before receiver acceptance, cancellation rejects the `created` row and
  settles the live owner.
- After acceptance but before execution, deleting the typed machine-owned queue
  item or bulk-clearing its queue calls the injected facade, transactionally
  marks the row `rejected`, and settles the live owner before removing the
  projection.
- During execution, chat cancellation owns the active stream outcome. It marks
  an unacknowledged handoff rejected after the attempt ends; an already
  acknowledged handoff remains acknowledged.

Machine-owned queue entries carry typed ownership
`{ kind: "user-input-follow-up", requestId }`. They may be moved, but not edited.
Removal is permitted only through the settling facade path.

## Failure, recovery, and retention

A setup, IPC, or dispatch failure before durable chat-turn acceptance changes
`executing` back to `accepted` with `last_error`. The renderer removes the
failed active projection. A focus event, renderer remount, or explicit queue
retry fetches/redelivers accepted work with the same idempotency key.

A renderer crash loses only projections and callbacks. `user_input` hydration
plus idempotent receiver acceptance recreates the typed queue entry. Ordinary
queue JSON persistence excludes machine-owned entries.

A full main-process restart creates a new owner-session ID. During registry
startup, every nonterminal record owned by another session is marked
`rejected`; it is never projected as immutable queued work because its
authoritative registry and callbacks no longer exist. This is the intentional
difference between renderer reload recovery and full-process recovery.

Acknowledged and rejected rows are tombstones for deduplication. Owner-session
initialization prunes terminal rows older than 30 days, while nonterminal rows
are never age-pruned within their live owner session. Deleting a chat cascades
its handoffs. Retry is safe after renderer crashes or lost notifications;
exactly-once execution is not promised.
