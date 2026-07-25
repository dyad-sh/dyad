# C2 — version_preview host migration

Implement the version_preview wave of C2 in plans/cleanup-state-machines.md.
The plan wins. Prereq: github_ops wave landed (it establishes the
git-adjacent migration patterns; reuse them).

Pre-code artifacts per the plan: lifecycle matrix row verified (active
checkout/recovery retained; reattach on reload; continue on window close;
preserve/enter recovery contract on quit; reconcile branch/checkout state
on restart; dispose after safe return/settlement on entity deletion —
the mid-checkout recovery semantics are the heart of this machine, they
must survive the move exactly); serializability audit (checkout intents,
originBranch retention, recovery state — all data; the navigate/toast
effects become presentation events routed per decision 5 with the N=1
identity rule); safe projection; deletion budget (renderer controller +
manager, per-command-class dispatch plumbing).

Key semantics to preserve verbatim (from the machine's review history):
epoch-keyed reads with mutations never dropped; semantic checkout intent
(preview/return); recovery-required capability gating (restore buttons
disabled — the capability selectors from the hardening work port to the
remote projection); return-branch preservation until preview checkout
completes; Neon uncached-app restart on return; bulk-delete ordering
(entity deletion disposes the actor without firing APP_CHANGED into a
deleted app — the A-phase fix must hold across the process boundary).

Tests: existing version_preview transition/recovery suites unchanged;
mid-checkout window close + reattach from a second window; app deletion
during checkout; restart reconciliation; ChatHeader mutation indicator
(A2's selector) reads the remote projection identically. Golden suite
green. /deep-review. Branch c2-version-preview; /pr-push; update plan
status + matrix.
