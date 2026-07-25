# C1 — app_run main-hosted pilot

Implement C1 of plans/cleanup-state-machines.md ("Phase C — C1"). The
plan wins; the design of record is plans/distrbuted-machines.md
("Pilot 1: main-hosted app_run") plus the B0 ADR's deletion list and
lifecycle-matrix row. Prereqs: B2–B4 merged, audit-rewiring pagehide
split landed, B0 deletion list exists.

This is a multi-PR wave — land in the distributed plan's reviewable steps,
each its own PR on a shared feature sequence, ONE COMMAND AUTHORITY at
every step:

1. Extract/reuse main app-runtime service boundaries (process
   start/restart/stop, sandbox recreation, producer callback
   registration, external-agent lifecycle claims, cancellation
   tombstones) behind a service the actor will consume directly.
2. Define app_run wire codecs + the safe remote projection (phase,
   operation, startedAt, url/mode, operation error, exit details,
   capabilities — NO process handles, paths, or command runtime data).
   Intent classes per the B0 ADR; cancellation carries the invocation
   ref.
3. Construct the main actor on the ActorHost; route producer events
   (PROCESS_SPAWNED/FAILED, PROXY_READY, PROCESS_EXITED) bound to the
   actor invocation AT PRODUCER CREATION — this deletes the stale-output
   compensation class structurally. Transition preserves existing
   behavior including proxy-ready-before-spawn-settlement. A pure
   effect-free shadow transition may consume copied events for trace
   comparison; it runs no commands and publishes nothing.
4. Renderer remote hook behind the composition boundary; migrate
   consumers (they already read machine-shaped state after Phase A);
   preview_iframe consumes committed remote snapshots/typed events via
   the A4 facade seam (swap the facade's source — callers unchanged).
5. Remove renderer authority: delete renderer AppRunController,
   AppRunManager, the renderer invocation registry for producer routing,
   remaining lifecycle projections, renderer-to-main lifecycle command
   adapters, timestamp/map-edge restart inference. The B0 deletion list
   is the checklist; the pilot FAILS architecturally if it adds more
   permanent layers than it removes.

Acceptance: the distributed plan's 12 scenarios PLUS the plan's
multi-window set (same app two windows one process; restart from B after
start from A; stale-revision action follows declared policy;
invocation-targeted cancel; close A during pending start → work
continues; reload B while A attached; keyed console fan-out; screenshot
targets a valid capability lease). Packaged Electron E2E for reload
survival, second window, quit cleanup — rebuild before E2E.

Every PR in the wave: security review against the B3 checklist for the
new remote definition; golden suite green; /deep-review on the
authority-cutover PR specifically. Update the plan's C1 status and the
lifecycle matrix if reality diverged. Branch prefix c1-app-run-\*.

Trailing deletion (part of this wave, per the plan's rolling Phase D):
land the wave's adapter/channel deletion as a SEPARATE PR immediately
behind the cutover (same day is fine — no bake, no soak; per the plan's
recorded corrections: no update window, no runtime toggle, stragglers
are compile-time-detectable, and dead-code deletion cannot regress
runtime once typecheck/CI pass). The separation exists ONLY to keep the
high-scrutiny cutover diff pure for review; a later cutover revert
simply reverts both PRs. The wave is not complete until it lands.

Rebatch note (see DEPENDENCIES.md): steps 1-2 are pulled forward — step 1
(main app-runtime service extraction) has no transport dependency and may
start immediately, parallel with Phase B; step 2 (codecs + safe projection
design) needs only the B0 ADR. Only steps 3+ wait for B4. The cutover step
occupies the single cutover slot.
