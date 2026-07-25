# B1 — WindowRegistry, routing, cache coherence, two-window harness

Implement B1 of plans/cleanup-state-machines.md ("Phase B — B1"). The
plan wins over this prompt. Prereqs: the golden single-window suite has
landed (verify — do not start without it); B0 ADR merged.

Read: the plan's "Window identity and routing", "Cross-window React
Query coherence", "High-volume window subscriptions", and "Single-window
protection" sections — they ARE the spec; this prompt only adds execution
discipline.

Scope:

1. WindowRegistry (main-owned): register/unregister per webContents;
   stable WindowSessionId (and TabInstanceId type, schema only — no tab
   UX); focus tracking; setVisibleEntities/findWindowsShowing;
   routePresentation implementing recorded decision 5's matrix — WITH
   the N=1 identity rule: exactly one window → unconditional
   short-circuit to it, plus a dev-mode assert comparing the full
   fallback chain's answer and reporting divergence (permanent shadow
   comparison).
2. Capability leases, minimal and screenshot-scoped per the plan: single
   holder per (kind, appId), revoked on webContents.destroyed or
   iframe-epoch change, requester retries/settles per declared policy.
   Do NOT generalize (rule of three noted in the plan).
3. Typed React Query invalidation channel: scopes mapped to the central
   queryKeys factory (no renderer-supplied keys on the wire); ONE global
   epoch counter; batching; origin windows KEEP their synchronous local
   invalidation — the broadcast is additive and epoch-deduped (never
   delete a local invalidateQueries call); reconnect/epoch-gap →
   conservative invalidation of affected families. Wire the channel but
   convert only ONE mutation path in this PR as the reference
   implementation; the full conversion is the audit-rewiring PR (wave 4)
   guarded by the golden suite's refetch-count baselines.
4. Keyed high-volume interest plumbing (appId/chatId interest per
   webContents, per-destination batching, interest removed on window
   destruction, bootstrap/terminal-flush closing the attach/detach
   race) — plumbing + tests; production channels convert in the
   audit-rewiring PR.
5. The two-window test harness: create two trusted renderer windows
   independent of product UX, assign session IDs, reload/destroy either
   independently, inspect subscriptions, dispatch from either, exercise
   adopt-then-remove transfer at the protocol level. This harness is what
   every later B/C conformance suite runs on.

Constraints: no production flow reroutes in this PR except the single
reference mutation path (run the golden suite against it); everything
else ships dark. Kernel purity where applicable; boundary tests extended
to forbid renderer code importing the registry's main-side internals.

Verify: typecheck, full unit tests, lint, golden suite green, harness
self-tests green. /deep-review — new permanent subsystem. Branch
cleanup-b1-window-infra; /pr-push; update plan status.
