# PR A5 — Multi-producer channels get owned stores

Implement PR A5 of plans/cleanup-state-machines.md ("A5 — Multi-producer
channels with explicit non-machine owners"). The plan wins over this
prompt. Prereq: A4 landed (facade pattern, applyUrl/token coupling
resolved, app-exit template from A3). Remove retired atoms' allowlist
entries; update the plan's A5 status.

Appendix recipes: "app_run/preview_iframe: previewError channel",
"app_run: console trio", "app_run/chat_stream: package-manager warning
unit", "clearPreviewRuntimeForAppAtom (retire last)". The verified
corrections in these recipes are load-bearing — especially the SIX
preview-error writer sites (four in PreviewIframe.tsx, including
dyad-app-sourced cloud-sandbox errors) and the release-age-over-
pnpm-migration priority direction.

Scope, three units plus the finalizer:

1. previewError channel → preview_iframe-owned state ({message, source}
   on PreviewIframeState) with ALL SIX writer sites landing in one change
   (or a temporary dual-write within the PR — never across PRs). New
   events per the recipe (IFRAME_ERROR, SYNC_ERROR, SYNC_RECOVERED,
   DISMISS) plus a microtask-deferred facade for app_run's set/clear
   commands (they execute inside app_run's command pipeline; the
   preview_iframe clear currently runs in beforeNotify — synchronous
   facade calls are forbidden). Encode in transitions: source-priority
   updater semantics (dyad-sync must not clobber preview-app/dyad-app;
   recovery clears own source only), dismiss-clears-any, and an explicit
   definition of the app_run-sets/preview_iframe-clears race (Jotai
   serializes it today — the transition must decide it deliberately).
   The source discriminant is load-bearing for hasStartupError.
2. Console trio → keyed PreviewConsoleStore preserving
   createPreviewConsoleTail ring-buffer semantics; migrate ALL FIVE
   producers atomically (interleaved dual-write forks the buffer);
   readers per recipe, including the narrower useLatestConsoleEntry for
   PreviewPanel (kills re-render-per-log). The recipe's cheaper fallback
   (keep as shared UI log buffer, only remove app_run's machine writes)
   is available if the PR runs hot — say so in the PR description if
   taken.
3. Package-manager warning unit → standalone keyed store with
   setWarning/clear/dismiss/clearAllForApp, porting verbatim: the
   dismissed-set guard, and the priority rule WITH THE CORRECT DIRECTION
   (release-age (2) beats pnpm-migration (1); strictly-higher keeps;
   equal kind last-write-wins) including the ported characterization
   test. All FOUR producers (chat_stream, app_run clear with the rebuild
   exception, useRunApp with the pnpm-migration settings-gate bypass,
   and the entity-disposal path) migrate in this unit. The dismiss pair
   from the UI-only bucket retires with the channel.
4. clearPreviewRuntimeForAppAtom reaches empty and is deleted along with
   src/atoms/previewRuntimeAtoms.ts; each replacement store registers its
   own disposeKey cleanup on the entity-disposal path.

Cross-cutting: stores expose source interfaces a later remote/main
producer can feed (plan: "not described as authoritative shared
lifecycle"); facade methods tagged with intent classes; multi-consumer
registries.

Verify: typecheck, full unit tests, lint. Suites per recipes:
preview_iframe/commands.test.ts, useRunApp.test.tsx (error/console/
warning ranges), PackageManagerWarningBanner.test.tsx (ported priority
test), previewRuntimeAtoms.test.ts (deleted; buffer/tail cases become
store unit tests), harness seeds via controller events;
e2e-tests/package_manager.spec.ts must pass UNCHANGED. /deep-review —
this is a heavy PR. Branch cleanup-a5-multi-producer; /pr-push.
