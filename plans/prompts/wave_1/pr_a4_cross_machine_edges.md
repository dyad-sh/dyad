# PR A4 — Cross-machine signal edges

Implement PR A4 of plans/cleanup-state-machines.md ("A4 — Cross-machine
signal edges"). The plan is the source of truth over this prompt. Prereqs
landed: A1 (#4090), A2 (#4091); rebase over A3 (#4092). Delete each
retired atom's A1 boundary-allowlist entry; update the plan's A4 status.

Read first: plans/cleanup-state-machines.md — the A4 section (it AMENDS
the appendix on screenshot scope), Target architecture facade rules,
Remote intent policy, single-window audit. Then the appendix recipes in
plans/claude-cleanup-machines.md: "screenshot: pendingScreenshotAppIdsAtom",
"app_run: previewRunStateByAppIdAtom" (facade bullet only — derived trio
landed in A2), "app_run: reload token family", "app_run: appUrl family".

Scope, four units:

1. Screenshot ingress — per the PLAN's amended scope (not the appendix's
   older split): BOTH producers (useCommitChanges and chat_stream's
   end-of-stream command) migrate to one local
   requestCapture(appId, source) facade injected via deps, and
   pendingScreenshotAppIdsAtom is DELETED in this PR. The chat_stream
   call site carries a marker comment tied to Phase B1 (the window
   capability router later replaces the facade's implementation, not its
   call sites). Respect the verified mount-order correction when wiring
   (chat_stream deps register above ScreenshotProvider — hoist manager
   creation into layout via the injected-manager path, or register from
   a child below the provider; late binding is fine). Delete the mailbox
   consume loop, the state.ts mailbox doc sentence, and the previewAtoms
   inbox comment. Rewrite ScreenshotProvider.test.tsx to drive
   manager.send.

2. previewRunStateByAppIdAtom + setter → AppRunManager lifecycle facade
   for preview_iframe. Delivery MUST be microtask-deferred (onStateChange
   fires inside AppRunController setState; preview_iframe has no
   re-entrancy buffer). Edge-triggered or invocation-identified — never
   deduped by startedAt alone. Drop this map from
   clearPreviewRuntimeForAppAtom; fix the stale comments the recipe
   lists.

3. Reload-token family, three steps: (a) chat_stream's bump →
   appRunManager.send(appId, {type:"MANUAL_RELOAD"}) via a narrow dep on
   ChatStreamRuntimeDeps (recipe verifies the wiring works); flag the
   transient-`reloading` semantic delta or add a dedicated
   BUMP_RELOAD_TOKEN event — pick one, document why; mirror in
   hybrid_chat_harness. (b) machine-owned per-app monotonic counter on
   AppRunManager, reset in disposeKey. (c) PreviewPanel →
   usePreviewReloadToken(appId); delete the three atoms + their
   clearPreviewRuntimeForAppAtom branch.

4. appUrl family: readers move to RunState's url on ready/reloading
   (machine dropping URL on stop/errored is strictly more correct — flag
   as intentional delta); keep bump-after-url ordering with unit 3;
   delete both atoms and derived selectors.

Cross-cutting: every facade method tagged with its Remote intent class
(requestCapture: idempotent; MANUAL_RELOAD: idempotent; run-state
subscription: read). All callback registries are multi-consumer sets.
Events carry invocation identity, not timestamps.

Verify: typecheck, full unit tests, lint. Suites:
ScreenshotProvider.test.tsx, usePreviewIframe.test.tsx,
app_run/manager.test.ts, useRunApp.test.tsx, PreviewPanel.test.tsx,
harness wiring. /deep-review; fix confirmed findings. Branch
cleanup-a4-cross-machine-edges; /pr-push. PR description: four units,
enumerated deltas, B1 marker location.
