# B4 — Remote client, hydration, React

Implement B4 of plans/cleanup-state-machines.md ("Phase B — B4"). The
plan wins; detailed design in plans/distrbuted-machines.md ("Remote
snapshot store and React API"). Prereq: B3 merged.

Scope (still against the fake transport + test-only IPC machine; no
production consumer):

1. One RemoteMachineClient per renderer window; remote actor refs
   (getStatus/getSnapshot/subscribe/dispatch→receipt/resync).
2. Revisioned remote snapshot stores: pre-bootstrap buffering (bounded),
   monotonic application, gap-triggered resync, newer-actor-instance
   supersession, disposed-envelope handling (never accept a late snapshot
   from a disposed actor).
3. Connection lifecycle: reconnect resubscribes and bootstraps; window
   recreation gets a fresh client; pending dispatch promises settle with
   a transport-specific result on renderer destruction.
4. React: useDistributedMachine returning {state, projection, connection,
   dispatch}; explicit connecting/ready/disconnected/incompatible surfaced
   so UI capabilities can account for it; state never silently fabricated
   while disconnected (definitions choose the unavailable/initial view);
   selectors pure and reference-stable via the A1 bindings; remote
   snapshots never copied into Jotai.
5. Tests: StrictMode replay, provider replacement, unrelated-key
   no-rerender, dispatch-receipt vs command-completion distinction, all
   against fake transport and the two-window harness.

Verify: typecheck, full tests, lint, golden suite green. /deep-review.
Branch cleanup-b4-remote-client; /pr-push; update plan status. After this
PR, Phase B is complete: transport proven, zero product change shipped —
C1 is unblocked.
