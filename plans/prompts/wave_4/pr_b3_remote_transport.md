# B3 — Contract-driven remote transport

Implement B3 of plans/cleanup-state-machines.md ("Phase B — B3"). The
plan wins; detailed design in plans/distrbuted-machines.md ("Remote actor
transport", "Remote snapshot protocol", "Security model", "Serialization
and wire compatibility"). Prereqs: B1 (harness, WindowRegistry), B2
(kernel, tickets).

Scope (a test-only machine is the only registered definition — no
production machine is remotely addressable after this PR):

1. IPC contracts through the EXISTING architecture: defineContract for
   subscribe/bootstrap, dispatch, unsubscribe; defineEvent for
   snapshot/disposed broadcasts; createTypedHandler; preload allowlist
   derived from contracts. Never ipcMain.handle directly.
2. Static manifest: duplicate-ID rejection, per-definition key/event/
   snapshot codecs (Zod — the event codec IS the event allowlist; no
   {type, payload: unknown}), per-definition authorizeDispatch, the only
   router target. Renderer cannot register main-hosted machines.
3. Dispatch envelope + receipts exactly per the distributed plan
   (messageId dedup within a bounded window; expectedActorInstanceId;
   optional expectedRevision honoring the B0 intent classification;
   correlation/causation IDs). Double validation: outer envelope contract,
   then the machine's codecs. Protocol version is a cheap ASSERT
   (mismatch → rejected receipt + renderer reload prompt), NOT a
   compatibility matrix — per the plan's recorded correction, live-IPC
   version skew cannot occur in production (one bundle, updates apply on
   restart); it is a dev-only HMR phenomenon. Schema versioning/migration
   applies to PERSISTED state only.
4. Atomic subscribe/bootstrap: NO await between subscriber registration
   and snapshot capture; broadcasts before invoke-resolution are buffered
   renderer-side (bounded) and applied monotonically; revision gaps →
   resync, never speculative merge; stale actor-instance envelopes
   ignored.
5. webContents cleanup: destruction removes every subscription for that
   window; unsubscribe idempotent; per-window AND cross-window reference
   counting.
6. Transport conformance on the fake duplex transport + the B1 two-window
   harness, covering the distributed plan's transport list PLUS the
   plan's B3 additions: two windows subscribe/independently disconnect;
   window B dispatches after A initiated; stale-revision mutation follows
   declared policy; cancellation requires the invocation ref;
   no-subscriber lifecycle follows the definition.

Security review is mandatory before merge (the plan's review constraints):
trusted-main-frame enforcement, manifest-only routing, codec allowlists,
authorization before actor creation where possible, no commands from
renderer, snapshot projection excludes main-only fields — walk each and
state where it's tested in the PR description.

Verify: typecheck, full tests, lint, golden suite green (nothing
production-facing changed). /deep-review. Branch
cleanup-b3-remote-transport; /pr-push; update plan status. Separate
revert point from B2.
