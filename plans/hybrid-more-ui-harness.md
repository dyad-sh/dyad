# Plan: migrate UI-driven e2e specs to the hybrid harness (ChatPanel + beyond)

Goal: migrate every e2e spec whose behavior the hybrid vitest harness can
drive through **the real trigger UI**, keeping the harness's deep assertions
(LLM payloads, db rows, files, git log). Two groups:

- **ChatPanel-side (22 specs)** — the trigger UI already mounts today; 12 need
  zero harness work, 10 need a named extension (Phase CP2 table below).
- **Beyond-ChatPanel (17 specs)** — the trigger UI lives in the title bar,
  settings pages, or connector panels; needs the Phase 0 surface extensions.

Delivery model: land this as **one large consolidated PR**, not lots of little
PRs. Use reviewable sections or commits inside that single PR, but do not open
phase-by-phase, family-by-family, or spec-by-spec PRs. Keep Phase 0/1/2/3
progress on the same branch and keep updating the same PR as additional
families migrate. Each migrated e2e spec is deleted or slimmed in the same PR as
its replacement integration coverage.

Beyond-ChatPanel flows, grouped by the surface that must become mountable:

| Family                         | Specs                                                                                                                                         | New surface(s)                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Title-bar / app-list / dialogs | `copy_app`, `delete_app`, `rename_app`, `switch_apps`, `new_chat`                                                                             | TitleBar + `/app-details` page (+ ChatList / home-lite)                                                     |
| Settings / dialog pages        | `telemetry`, `max_tool_call_steps`, `smart_context_options`, `turbo_edits_options`, `dyad_pro_key_validation`, `supabase_migrations` (toggle) | settings page sections / standalone settings components + `/settings/providers/$provider`                   |
| Publish / connector panels     | `github`, `github-import`, `git_collaboration`, `neon_branch`, `neon_migration`, `media_library`                                              | GitHub/Neon connectors (via `/app-details`), ImportAppDialog, DatabaseSection/MigrationPanel, `/media` page |

---

## Phase CP1 — ChatPanel specs ready NOW (12; no harness work, can start before Phase 0)

These drive surfaces the harness already mounts (chat input, message cards,
banners, queue header, aux menus). Same migration discipline as everything
else: keep the expect-by-expect migration checklist, delete each e2e spec in
the same consolidated PR as its replacement, and group the work into reviewable
commits/sections instead of many small PRs. Where a spec has a case outside
ChatPanel, the case that stays e2e is named here explicitly.

| Spec                           | Drive / assert                                                                                                | Stays e2e                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `chat_input.spec.ts`           | Send enable/disable vs approve/reject proposal buttons                                                        | —                                               |
| `context_limit_banner.spec.ts` | context-limit banner + summarize button; seed custom-model config via settings instead of the settings UI     | —                                               |
| `default_chat_mode.spec.ts`    | chat-mode selector default text after seeding `defaultChatMode` setting                                       | settings-page dropdown case                     |
| `local_agent_basic.spec.ts`    | questionnaire/blueprint approval cards + file/db effects                                                      | name-conflict dialog / title-bar case           |
| `local_agent_consent.spec.ts`  | consent banner, Always/Once/Decline buttons + message snapshots                                               | —                                               |
| `local_agent_grep.spec.ts`     | dyad-grep card content/clicks; convert aria snapshots to text assertions                                      | —                                               |
| `notification_banner.spec.ts`  | in-chat notification-tip banner dismiss/enable + settings delta                                               | native-notification guide dialog case           |
| `pause_queue.spec.ts`          | queue header pause/resume/paused state (queue processor mounts in the harness as of the step-limit migration) | —                                               |
| `plan_mode.spec.ts`            | accept-plan buttons, questionnaire, mode selector, plan file on disk                                          | plan annotations / View-Plan PreviewPanel cases |
| `streaming_renderer.spec.ts`   | streamed dyad-write block rendering + pending indicators                                                      | —                                               |
| `theme_selection.spec.ts`      | chat-input themes menu, selection + settings persistence                                                      | home-page variant                               |
| `voice_to_text.spec.ts`        | mic button pro-gating/enabled states in chat input                                                            | real getUserMedia recording case                |

**Deliverables**: 12 integration tests; 6 e2e specs deleted outright, 6
slimmed to their named remaining case(s).

## Phase CP2 — ChatPanel specs needing an extension first (10)

Each row names the blocking extension and where it lives in this plan. Three
of the five extensions are already scoped by Phase 0 (0.1/0.3/0.4); only 0.6
and 0.7 are new work items.

| Spec                                                                                                              | Blocking extension                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.spec.ts`, `mcp_auto_consent.spec.ts`, `mcp_out_of_order.spec.ts`, `local_agent_advanced.spec.ts` (MCP cases) | **0.6 MCP fake-server bootstrapping** — the biggest single unlock (4 specs)                                                                                                 |
| `local_agent_large_attachment.spec.ts`, `queued_message.spec.ts` (attachment cases)                               | **0.7 attachment injection** via the bridge (file-picker seeding); `queued_message`'s queue-while-streaming timing is already solved (`pressEnterInChat`)                   |
| `chat_image_generation.spec.ts`                                                                                   | in-chat image-generator dialog — needs only the 0.3 dialog drivers (it opens from the chat aux menu, inside ChatPanel)                                                      |
| `version_search.spec.ts`                                                                                          | **covered** by the existing `/chat` mount: `ChatHeader` opens the real `VersionPane`, so no new surface was needed                                                          |
| `supabase_stale_ui.spec.ts`                                                                                       | fake-supabase connect trigger — settings seeding the way `supabase_branch.integration.test.ts` does, plus a connect-state toggle helper                                     |
| `local_agent_explore_code.spec.ts`                                                                                | **defer** — needs the code-explorer/tsc worker backend, which isn't available under vitest (worker bundling); migrate as node-harness payload test or keep e2e until solved |

### 0.6 MCP fake-server bootstrapping (new)

Stand up the same fake MCP servers the e2e suite uses (stdio/http) in-process
under vitest, plus settings-driven MCP config seeding. Unknowns: whether the
stdio transport spawns cleanly from a vitest fork; timebox a spike before
committing. Unlocks 4 specs.

### 0.7 Attachment injection via the bridge (new)

A harness helper that seeds attachments the way the real file-picker handoff
does (bridge-level injection into the chat input's attachment state), so
attachment-carrying prompts can be sent through the real submit path. Unlocks
2 specs.

**Migrated CP2 coverage so far**: `version_search.spec.ts` is covered in
`src/ipc/handlers/__tests__/version_search.integration.test.tsx`, which drives
`ChatHeader` -> `VersionPane` through the existing `/chat` mount and asserts
version-number/message/note search, empty results, clear, favorite-only
filtering, note persistence, favorite persistence, and close/reopen reset
behavior. `e2e-tests/version_search.spec.ts` is deleted on the same
consolidated migration PR.

---

## 0. Current state and the extension point

`setupHybridChatHarness` (`src/testing/hybrid_chat_harness.tsx`) already runs
**every** main-process IPC handler (`registerIpcHandlers()` — the same call
`main.ts` makes), a real sqlite db, a real git checkout, the real fake-LLM
server, and a real `window.electron` bridge. The only thing that is
chat-specific is `mount()`: it builds a **private route tree with a single
`/chat` route** rendering `<ChatPanel>` inside QueryClient + Jotai + Theme +
Toaster scaffolding (lines ~335–400).

So the work is almost entirely **renderer-side**: mount more surfaces over the
already-real IPC stack. `copy-app`, `delete-app`, `rename-app`, `create-chat`,
`github:*`, `neon:*`, `media:*`, `set-user-settings`, `validate-provider-api-key`
handlers are all registered today; the buttons that call them just aren't
rendered.

Verified constraints to design around (from the component mapping):

1. **No native OS dialogs anywhere in the 17 flows' core paths.** The only
   native pickers nearby (`select-app-location` folder move, ImportAppDialog's
   "Local Folder" tab, `selectAppFolder`) are outside or severable from these
   flows. `openExternalUrl` appears in several places but is fire-and-forget.
2. **`E2E_TEST_BUILD` / `FAKE_LLM_PORT` are not set by the harness today**
   (verified: no reference in `src/testing/*`). GitHub handlers
   (`src/ipc/handlers/github_handlers.ts` ~L67–80) and the Neon mock client
   (`src/neon_admin/neon_management_client.ts` `getNeonClient()` L98) both gate
   on `IS_TEST_BUILD` (= `E2E_TEST_BUILD === "true"`, read at **import time**)
   and route to `http://localhost:${FAKE_LLM_PORT}/github/...` / an in-process
   mock. The harness's fake server already serves the `/github/*` routes
   (`testing/fake-llm-server/githubHandler.ts`).
3. **The i18n mock renders raw keys** (`src/testing/hybrid.setup.ts`:
   `t: (key, fallback) => typeof fallback === "string" ? fallback : key`).
   Several target components select by translated text in e2e
   (e.g. "Copy app with history", `ai.maxToolCallSteps` combobox name).
4. **Import-graph hazards are real and precedented**: mounting `ChatPage`
   instead of `ChatPanel` hangs on Monaco/iframe (HYBRID_HARNESS.md §7).
   `PublishPanel` lives in `src/components/preview_panel/` — same risk class.
   Every new surface needs an import audit before it's blessed.
5. Measured cost of hybrid tests: ~2–4s fixed per file (collect + harness
   boot), ~0.3–1.2s per test. Adding surfaces mostly adds collect time; keep
   surface mounts narrow so unrelated files don't pay for it.

Design principles (carried over from the existing harness):

- **Real handlers, never mocked IPC.** If a flow needs a fake, it's the same
  fake e2e uses (fake-llm-server routes, `IS_TEST_BUILD` mock Neon,
  `neon:fake-connect`). We do not stub `ipc.*` client methods.
- **One harness per test file**, forks pool, unchanged.
- **Harness edits only in this plan's Phase 0/first-use commits** — migrated
  tests themselves must not patch the harness (CHAT_FLOW_HARNESS.md rule).
- Prefer `data-testid`/`aria-label` selectors; where a spec's identity depends
  on user-visible text, fix the i18n mock (Phase 0.4) instead of weakening the
  selector.

---

## Phase 0 — core harness extensions (prerequisite for all families)

### 0.1 `mountSurface()` + a multi-route private tree

Extend `mount()`'s scaffolding into a reusable `mountSurface(opts)`:

```ts
harness.mountSurface({
  route: "/app-details", // one of the registered test routes
  search: { appId: harness.appId }, // validated by the REAL route schema
  withTitleBar: true, // wrap in a layout that renders <TitleBar/>
});
```

- Build the route tree from the union of surfaces we support, each importing
  the **real** `validateSearch` schema from its route module the way `/chat`
  imports `chatSearchSchema` (and, like `chatSearchSchema`, split schemas out
  of route files whose static imports drag in preview/Monaco — audit first):
  - `/` (home-lite — see 1.5), `/chat` (existing), `/app-details`
    (`AppDetailsPage` from `src/pages/app-details.tsx`), `/settings`
    (`src/pages/settings.tsx`), `/settings/providers/$provider`
    (`ProviderSettingsPage`), `/media` (`src/pages/media.tsx`).
  - Routes are **registered lazily per mount** (only the surface a test asks
    for, plus navigation targets it declares) so a settings test doesn't
    collect the app-details import graph.
- Optional layout route rendering the real `<TitleBar/>` above `<Outlet/>` so
  flows that start with `title-bar-app-name-button` → navigate → app-details
  run the true entry path (TitleBar needs `selectedAppIdAtom` + `list-apps`,
  both already live).
- Keep the existing `mount()` as a thin alias for
  `mountSurface({ route: "/chat" })` — zero churn for existing tests.
- Expose `harness.router` / `harness.currentLocation()` so tests can assert
  post-action navigation (delete-app → `/`, copy-app "Open in Chat" → `/chat`)
  against the memory history.
- Add provider shims to the scaffolding, gated per surface: `SidebarProvider`
  (TelemetryBanner calls `useSidebar()`), `TooltipProvider`, and the DeepLink
  provider (`useDeepLink` — required by `NeonConnector`).

### 0.2 `testBuild: true` option (GitHub/Neon fakes)

New harness option that, **after** the fake server has bound its ephemeral
port and **before** the dynamic `await import("@/ipc/ipc_host")`:

- sets `process.env.E2E_TEST_BUILD = "true"` and
  `process.env.FAKE_LLM_PORT = <fake server port>`;
- snapshots/restores both on `dispose()` (same pattern as
  `DYAD_SKIP_MANAGED_PNPM_INSTALL`).

This is sufficient because `github_handlers` / `neon_management_client` read
the flags at module import, and `ipc_host` is only imported dynamically inside
setup. It unlocks: fake GitHub device flow + repo/push routes, test-only
endpoints (`/github/api/test/push-events`, `/clear-push-events`,
`/reset-repos` — expose small `harness.github.*` fetch helpers over
`fakeLlmUrl`), the in-process mock Neon client, and the `neon:fake-connect`
handler. Renderer modules must be audited for their own import-time reads of
these flags (none known today; the guard smoke test in 0.5 catches drift).

### 0.3 Dialog / popover / menu drivers

happy-dom needs the same coaxing for Radix/Base UI popups that
`selectFromBaseUiSelect` already implements. Add:

- `openPopover(trigger)` / `clickMenuItem(name)` — pointerDown/Up + click +
  keyboard fallback, used for the app-details more-options popover, media
  thumbnail action menus, branch-actions menus.
- `confirmDialog(matcher)` / `findDialog(matcher)` — wait for
  `role="dialog"`/`"alertdialog"`, click a named action, wait for close.
- `setSwitch(labelOrTestId, on)` — Radix `Switch` driver (supabase migrations
  toggle, github auto-sync).

Each helper lands with the first test that needs it, in the harness file, with
a cookbook entry in HYBRID_HARNESS.md.

### 0.4 i18n mock upgrade

Replace the passthrough `t` in `src/testing/hybrid.setup.ts` with one that
synchronously loads the real `src/i18n/locales/en/*.json` resources (key
lookup + `{{var}}` interpolation; fall back to key). This makes user-visible
text selectors ("Copy app with history", "Write SQL migration files",
"Max Tool Calls (Agent)") work identically to production and removes a whole
class of silent selector drift. Existing tests keep passing (keys they relied
on either resolve to the same string or they used testids).

### 0.5 Per-surface guard tests

For each new surface, a tiny `*.integration.test.tsx` that mounts it and
asserts (a) it renders its landmark testid, (b) no missing-channel failures at
dispose (already enforced), (c) the Monaco/iframe modules were not loaded
(same class of guard as `hybrid_chat_harness.guard.integration.test.tsx`).
This is the cheap tripwire for import-graph regressions.

**Exit criteria for Phase 0**: guard tests green for `/app-details` and
`/settings`; `mount()` alias keeps all 16 existing hybrid tests byte-identical
green; `testBuild: true` smoke proves a `github:start-flow` round trip against
the fake server.

---

## Phase 1 — title-bar / app-list / dialog family

All five flows confirmed native-dialog-free. Entry: `mountSurface({ route:
"/app-details", search: { appId }, withTitleBar: true })`.

| Spec          | Drive                                                                                                        | Assert                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy_app`    | more-options popover → "Copy app" dialog → with/without history                                              | `copy-app` handler effects: new app dir + files, versions; `check-app-name` warning renders for dupes; "Open in Chat" navigates to `/chat` (router assert) |
| `delete_app`  | more-options → Delete dialog → "Delete App"                                                                  | db row gone, app dir removed, navigation to `/`                                                                                                            |
| `rename_app`  | `app-details-rename-app-button` → rename dialog → confirm dialog ("Rename app and folder" / "app only")      | db name, folder renamed (or not), `list-apps` refresh reflected in TitleBar `data-app-name`                                                                |
| `new_chat`    | mount ChatList (sidebar list, the lighter of the two `new-chat-button`s) or ChatHeader inside `/chat`; click | new `chats` row, navigation to `/chat?id=<new>`, messages list empty                                                                                       |
| `switch_apps` | see 1.5                                                                                                      | second app created; TitleBar `data-app-name` switches; chats scoped per app                                                                                |

### 1.5 `switch_apps` / home-lite

The real flow runs through `home.tsx` + `HomeChatInput` (heaviest mount:
streaming hooks + Lexical + several home atoms). Two-step approach:

1. First land `switch_apps` by creating the second app through the real
   `create-app` handler + `useSelectChat`-equivalent seeding, then assert the
   **UI switch** via TitleBar/app-details mounts (this covers the spec's
   actual assertions, which are app-identity, not home-page rendering).
2. Promote to a real home-route mount only if/when other home-driven specs
   (`home_chat_existing_app` etc.) justify a `HomeChatInput` surface; that is
   explicitly out of scope here.

**Deliverables**: `copy_app`, `delete_app`, `rename_app`, `new_chat`,
`switch_apps` as `*.integration.test.tsx`; delete the five e2e specs. Covered
in `src/ipc/handlers/__tests__/app_details_actions.integration.test.tsx` on the
single consolidated migration PR.

---

## Phase 2 — settings / dialog pages family

All six flows funnel through `set-user-settings`; assert on the harness's real
settings file plus the rendered control state. Mount targets are deliberately
narrow — a standalone component where the spec never leaves it, the settings
page only where section context matters.

| Spec                           | Mount                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `telemetry`                    | `PrivacyBanner` (`src/components/TelemetryBanner.tsx`) standalone, inside `SidebarProvider`                                | seed `telemetryConsent: "unset"`; Accept/Reject → settings delta; "Later" → no delta, `hideBannerAtom` hides banner                                                                                                                                                                                                                    |
| `max_tool_call_steps`          | `/settings` page (AI section) or `MaxToolCallStepsSelector` standalone                                                     | drive with `selectFromBaseUiSelect`; assert `maxToolCallSteps` in settings file (Default → `undefined`)                                                                                                                                                                                                                                |
| `smart_context_options`        | `ProModeSelector` standalone (it's a Popover off the chat input, so it can also be driven from the existing `/chat` mount) | seed pro key + `enableDyadPro: true` or buttons are disabled; assert `enableProSmartFilesContextMode` / `proSmartContextOption`                                                                                                                                                                                                        |
| `turbo_edits_options`          | same `ProModeSelector` mount                                                                                               | assert `enableProLazyEditsMode` / `proLazyEditsMode` (`v1`/`v2`)                                                                                                                                                                                                                                                                       |
| `dyad_pro_key_validation`      | `/settings/providers/$provider` route with `provider: "auto"`                                                              | **no IPC mocking**: pass `engine: true` (existing option) so the real `validate-provider-api-key` handler streams against the fake server, which 401s keys matching `/invalid/i` → real "API key rejected" AlertDialog; happy path with `testdyadkey`. The ApiKeyConfiguration "Paste" button (`navigator.clipboard`) is not exercised |
| `supabase_migrations` (toggle) | `SupabaseIntegration` standalone or `/settings` Integrations section                                                       | toggle only renders when `isSupabaseConnected(settings)` — seed connected supabase settings the way `supabase_branch.integration.test.ts` seeds them; assert `enableSupabaseWriteSqlMigration` delta. The migration-files-on-disk half is covered by a hybrid `/chat` test that also asserts the native-git clean regression.          |

**Deliverables**: six integration tests; delete `telemetry`,
`max_tool_call_steps`, `smart_context_options`, `turbo_edits_options`,
`dyad_pro_key_validation`, and `supabase_migrations` e2e specs. Covered in
`src/ipc/handlers/__tests__/settings_actions.integration.test.tsx` and
`src/ipc/handlers/__tests__/supabase_migrations.integration.test.tsx` on the
single consolidated migration PR.

---

## Phase 3 — publish / connector panels family

Requires `testBuild: true` (0.2). Mount connectors via `/app-details` (they
render there in production) — **not** via `PublishPanel` until its
`preview_panel` import graph passes the 0.5 guard; `DatabaseSection` /
`MigrationPanelBody` are imported directly to sidestep that initially.

| Spec                | Drive                                                                                                                                                                                                                      | Assert / notes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`            | `/app-details` → `GitHubConnector`: device flow (fake server issues FAKE-CODE; flow events arrive through the real bridge `ipc.events.github.*`), create-repo / connect-existing, sync                                     | covered in `src/ipc/handlers/__tests__/github_actions.integration.test.tsx`: push events via `harness.github.pushEvents()` (fake server test endpoint); app repo rows; settings delta on disconnect/reconnect. Reset with `/reset-repos` + `/clear-push-events` between tests                                                                                                                                                                |
| `github-import`     | `ImportAppDialog` mounted through the harness-only `/import-app` surface                                                                                                                                                   | covered in `src/ipc/handlers/__tests__/github_import.integration.test.tsx`: drive the "GitHub URL" tab with custom app name/advanced commands and the authenticated "Your GitHub Repos" tab against the fake GitHub git base; assert imported `package.json`/`vite.config.ts`, app DB rows, persisted commands, and default component-tagger upgrade. `e2e-tests/github-import.spec.ts` is deleted on the same consolidated migration PR     |
| `git_collaboration` | `GithubBranchManager` + `GithubCollaboratorManager` via `/app-details`                                                                                                                                                     | covered in `src/ipc/handlers/__tests__/git_collaboration.integration.test.tsx`: create/switch/rename/merge/delete branches against the harness's real git checkout, pull through the branch-actions menu, invite/remove collaborators through fake GitHub routes, and seed direct-git merge conflicts for the AI-resolution and cancel-sync UI paths. `e2e-tests/git_collaboration.spec.ts` is deleted on the same consolidated migration PR |
| `neon_branch`       | `NeonConnector` via `/app-details` (DeepLink provider from 0.1)                                                                                                                                                            | covered in `src/ipc/handlers/__tests__/neon_branch.integration.test.tsx`: seed the connected Neon account state, then drive project/branch selects via the real connector UI; assert `.env.local` `DATABASE_URL`/`POSTGRES_URL`/`NEON_AUTH_BASE_URL`, per-branch auth cookie secret persistence, and app DB branch rows. `e2e-tests/neon_branch.spec.ts` is deleted on the same consolidated migration PR                                    |
| `neon_migration`    | `DatabaseSection` + `MigrationPanelBody` mounted through the harness-only `/database` surface, app row seeded with `neonProjectId`/branch ids the mock client serves (`test-main-branch-id`, `test-development-branch-id`) | covered in `src/ipc/handlers/__tests__/neon_migration.integration.test.tsx`: "Migrate to Production" → review-SQL dialog (destructive warnings, "I understand…") → real `migration:migrate`; assert persisted deploy-branch choice, success state, production-branch skip state, and production `DATABASE_URL`. `e2e-tests/neon_migration.spec.ts` is deleted on the same consolidated migration PR                                          |
| `media_library`     | `/media` route                                                                                                                                                                                                             | covered in `src/ipc/handlers/__tests__/media_library.integration.test.tsx`: seed files under `<app>/.dyad/media` with `fs`, drive thumbnail action menu → rename/move/delete dialogs, drive move's `AppSearchSelect` popover, and assert filesystem + app rows. `e2e-tests/media_library.spec.ts` is slimmed to the named "Start New Chat With Image" attachment/navigation remnant                                                          |

**Deliverables**: six integration tests; `github` is covered in
`src/ipc/handlers/__tests__/github_actions.integration.test.tsx`,
`github-import` is covered in
`src/ipc/handlers/__tests__/github_import.integration.test.tsx`,
`git_collaboration` is covered in
`src/ipc/handlers/__tests__/git_collaboration.integration.test.tsx`,
`neon_branch` is covered in
`src/ipc/handlers/__tests__/neon_branch.integration.test.tsx`,
`neon_migration` is covered in
`src/ipc/handlers/__tests__/neon_migration.integration.test.tsx`, and
`e2e-tests/github.spec.ts`, `e2e-tests/github-import.spec.ts`,
`e2e-tests/git_collaboration.spec.ts`, `e2e-tests/neon_branch.spec.ts`, and
`e2e-tests/neon_migration.spec.ts` are deleted on the same consolidated
migration PR. `media_library` leaves one explicitly-named test in a slimmed e2e
spec (attachment strip); every other e2e file in this family is deleted.

---

## Risks and mitigations

| Risk                                                                                    | Mitigation                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import graph of a new surface drags Monaco/preview/iframe (the `ChatPage` failure mode) | 0.5 guard test per surface before any migration lands; import route-schemas not route-files; mount `DatabaseSection` not `PublishPanel`                                 |
| `E2E_TEST_BUILD` leaks between files/workers                                            | env snapshot/restore in dispose (existing pattern); forks-pool isolation means per-file anyway                                                                          |
| Radix popovers/menus dead under happy-dom                                               | 0.3 drivers extend the proven `selectFromBaseUiSelect` recipe; each driver validated by the guard test of the first surface using it                                    |
| i18n mock change breaks existing 16 hybrid tests                                        | 0.4 keeps key-fallback behavior; run full integration project before merging                                                                                            |
| Device-flow polling timers stall fake-timer-less tests                                  | GitHub flow is real-timer polling against a local server (fast); cap with `waitForEvent("github:flow-success")`-style helpers, generous timeouts as in existing harness |
| Per-file collect time grows as route tree grows                                         | lazy per-mount route registration (0.1); surfaces a test doesn't request are never imported                                                                             |
| Migrated test silently asserts less than the e2e original                               | migration checklist: enumerate every `expect`/snapshot in the spec, map each to the new test or to an explicit keep/drop note in the PR description (lesson from #3801) |

## Out of scope (stays Playwright regardless)

Native folder pickers (`selectAppFolder`, `select-app-location`), real
`openExternalUrl` browser handoff, preview-iframe behaviors, aria/visual
snapshots of full-app layout, Lexical keystroke fidelity, and the home-page
`HomeChatInput` surface (revisit only with a dedicated plan).

## Sequencing

Ship this as **one consolidated PR**, not a series of many small PRs. Keep the
phases as the internal implementation and review order, with commits/sections
that make the large diff navigable. Phase checkpoints may be pushed for review,
but they should update the same PR instead of creating new PRs:

1. **Phase 0** (harness core) first; no spec deletions until the harness guard
   tests are green and the existing hybrid tests still pass.
2. **Phase 1** next; delete the title-bar/app-list/dialog e2e specs in the same
   consolidated PR as their integration replacements.
3. **Phase 2** can proceed once 0.1/0.4 are in place (no `testBuild`
   dependency except pro-key validation, which needs only the existing
   `engine: true`).
4. **Phase 3** follows 0.2; `github` first (proves device flow + fake routes),
   then `git_collaboration` (reuses it), then neon pair, `media_library`,
   `github-import` last (dialog-direct mount is independent).

Before requesting final review on the consolidated PR, run the full relevant
verification once across the final combined diff: existing hybrid tests, new
guard tests, and every migrated integration spec. The PR description should
include the migration checklist mapping each removed e2e assertion to its new
integration assertion or named keep/drop note.

End state: 15 of the 17 specs fully deleted from `e2e-tests/`, 2 slimmed to a
single named native-dependent test each, and every migrated flow driven
through the same clicks a user makes — with payload/db/git/file assertions the
Playwright versions never had.
