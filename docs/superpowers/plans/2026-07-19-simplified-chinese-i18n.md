# Simplified Chinese i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the renderer's Simplified Chinese localization, enforce resource/source parity, and publish the verified change from the user's GitHub fork.

**Architecture:** Keep the existing `react-i18next` initialization and five namespaces. Add a small, testable validation layer that compares locale resources and parses renderer source with Babel to catch untranslated UI and unregistered dynamic keys. Migrate copy by feature area, using the English JSON as the source of truth and manually authoring Mainland Chinese in `zh-CN`.

**Tech Stack:** React 19, Electron renderer, `i18next`, `react-i18next`, `@babel/parser`, Vitest, Playwright, Oxlint, Oxfmt, `tsgo`.

---

## File Map

Create:

- `src/i18n/localeValidation.ts` - flatten resources, compare keys, interpolation tokens, plural suffixes, and rich-text markers.
- `src/i18n/sourceAudit.ts` - parse renderer TypeScript/TSX and report untranslated visible strings, translation calls, and dynamic call sites.
- `src/i18n/dynamicKeys.ts` - explicit registry for non-static translation calls and their namespace-qualified keys.
- `src/i18n/englishAllowlist.ts` - reviewed technical/product/model/protocol names that may remain English in renderer copy.
- `src/i18n/localeValidation.test.ts` - resource parity, placeholder, plural, rich-text, and language fallback tests.
- `src/i18n/sourceAudit.test.ts` - renderer source hard-code and dynamic-key registration tests.
- `src/i18n/format.test.ts` - `zh-CN` date, number, and relative-time formatting tests.
- `e2e-tests/i18n_zh-CN.spec.ts` - language selection, persistence, navigation, and dialog acceptance flow.

Modify locale resources:

- `src/i18n/locales/en/common.json`
- `src/i18n/locales/en/settings.json`
- `src/i18n/locales/en/chat.json`
- `src/i18n/locales/en/home.json`
- `src/i18n/locales/en/errors.json`
- `src/i18n/locales/zh-CN/common.json`
- `src/i18n/locales/zh-CN/settings.json`
- `src/i18n/locales/zh-CN/chat.json`
- `src/i18n/locales/zh-CN/home.json`
- `src/i18n/locales/zh-CN/errors.json`

Modify renderer source in these feature groups. The source audit determines
the final member set, but no user-visible English string in these files may be
left outside the explicit technical allowlist:

- App shell and pages: `src/app/TitleBar.tsx`, `src/pages/app-details.tsx`,
  `src/pages/apps.tsx`, `src/pages/home.tsx`, `src/pages/library.tsx`,
  `src/pages/library-home.tsx`, `src/pages/media.tsx`, `src/pages/settings.tsx`,
  `src/pages/templates.tsx`, `src/pages/themes.tsx`.
- App management and shared dialogs: `src/components/AppList.tsx`,
  `src/components/AppSearchDialog.tsx`, `src/components/AppSearchSelect.tsx`,
  `src/components/AddAppsToCollectionDialog.tsx`,
  `src/components/AddOrEditCollectionDialog.tsx`,
  `src/components/AssignAppsToCollectionDialog.tsx`,
  `src/components/FeaturedAppShowcase.tsx`, `src/components/HelpDialog.tsx`,
  `src/components/ErrorBoundary.tsx`, `src/components/CopyErrorMessage.tsx`,
  `src/components/CustomErrorToast.tsx`, `src/components/BugScreenshotDialog.tsx`,
  `src/components/MacNotificationGuideDialog.tsx`.
- Settings and providers: `src/components/AutoApproveMcpSwitch.tsx`,
  `src/components/AutoApproveSqlSwitch.tsx`,
  `src/components/AutoApproveSwitch.tsx`,
  `src/components/AutoFixProblemsSwitch.tsx`,
  `src/components/AutoUpdateSwitch.tsx`,
  `src/components/BlockUnsafeNpmPackagesSwitch.tsx`,
  `src/components/ChatEventNotificationSwitch.tsx`,
  `src/components/CloudSandboxExperimentSwitch.tsx`,
  `src/components/ContextCompactionSwitch.tsx`,
  `src/components/KeepPreviewsRunningSwitch.tsx`,
  `src/components/LanguageSelector.tsx`, `src/components/ModelPicker.tsx`,
  `src/components/RuntimeModeSelector.tsx`, `src/components/SetupBanner.tsx`,
  `src/components/ThinkingEffortSelector.tsx`,
  `src/components/TelemetrySwitch.tsx`,
  `src/components/settings/ApiKeyConfiguration.tsx`,
  `src/components/settings/AzureConfiguration.tsx`,
  `src/components/settings/ModelsSection.tsx`,
  `src/components/settings/ProviderSettingsPage.tsx`,
  `src/components/settings/VertexConfiguration.tsx`,
  `src/components/CreateCustomModelDialog.tsx`,
  `src/components/EditCustomModelDialog.tsx`,
  `src/components/CreateCustomProviderDialog.tsx`.
- Integrations and source control: `src/components/GitHubConnector.tsx`,
  `src/components/GitHubIntegration.tsx`,
  `src/components/GithubBranchManager.tsx`,
  `src/components/GithubCollaboratorManager.tsx`,
  `src/components/NeonConnector.tsx`, `src/components/NeonIntegration.tsx`,
  `src/components/SupabaseConnector.tsx`,
  `src/components/SupabaseIntegration.tsx`,
  `src/components/VercelConnector.tsx`,
  `src/components/VercelIntegration.tsx`.
- Chat and agent surfaces: all user-visible copy in `src/components/chat/`,
  including `ChatInput.tsx`, `ChatModeSelector.tsx`, `ChatSearchDialog.tsx`,
  `ChatErrorBox.tsx`, `AuxiliaryActionsMenu.tsx`, `ContextLimitBanner.tsx`,
  `DyadGit.tsx`, `DyadRead.tsx`, tool result badges, `QueuedMessagesList.tsx`,
  `TokenBar.tsx`, `UncommittedFilesBanner.tsx`, and `VersionPane.tsx`.
- Preview, plans, plugins, and pro UI: all user-visible copy in
  `src/components/preview_panel/`, `src/components/preview_panel/plan/`,
  `src/components/plugins/`, and `src/pro/ui/`. Exclude code editor content,
  tool payload values, test files, and non-UI helper modules.

## Task 1: Add Failing Locale and Source Audit Tests

**Files:** Create the five files under `src/i18n/` listed above; modify no
production component yet.

- [ ] **Step 1: Add resource comparison tests.**

  Implement `flattenResource(value, prefix)` and assertions that compare the
  flattened `en` and `zh-CN` objects for every namespace. Extract
  `{{name}}` interpolation tokens, `_one`/`_other` plural siblings, and
  `<0>...</0>`-style rich-text markers before comparing each corresponding
  value. Add a failure message containing the namespace and key for every
  mismatch.

- [ ] **Step 2: Add source-audit tests.**

  Parse renderer files with `@babel/parser` using `typescript`, `jsx`, and
  `decorators-legacy` plugins. Walk JSX text, visible JSX attributes, direct
  string children, `t`/`i18n.t`/`getFixedT` calls, `<Trans>` props, and static
  toast/dialog/error arguments. Return source path, line, category, and text
  for each finding. Treat a string as exempt only when it is in the explicit
  technical allowlist or in the excluded source boundary.

- [ ] **Step 3: Add dynamic-call registration tests.**

  For every translation call whose key argument is not a string literal,
  conditional expression with string branches, or a statically resolvable
  template, record a normalized call-site signature. Assert that every
  signature appears in `dynamicKeys.ts`, and that every key listed there exists
  in both resource languages. Include the current calls in
  `app-details.tsx`, `ChatList.tsx`, and `DyadGit.tsx`.

- [ ] **Step 4: Run the focused tests and confirm the expected failure.**

  Run:

  ```bash
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- src/i18n/localeValidation.test.ts src/i18n/sourceAudit.test.ts
  ```

  Expected: FAIL with the known 60 `zh-CN` resource gaps, 17 source-used keys
  absent from `en`, and existing hard-coded renderer strings. This confirms the
  tests observe the work that remains.

## Task 2: Complete English Baseline and Chinese Resources

**Files:** The ten locale JSON files in the File Map.

- [ ] **Step 1: Add every code-used key to English.**

  Add the 17 currently missing source-used keys for voice input, Git summaries,
  Supabase organization status, migration preview, file search matches, and
  problem counts. Add all keys needed by the source migration to the namespace
  matching the feature.

- [ ] **Step 2: Add the 60 missing Chinese keys.**

  Translate the three missing chat keys, 52 missing home keys, and five missing
  settings keys. Preserve all English interpolation names and plural suffixes.

- [ ] **Step 3: Review existing Chinese resources by feature.**

  Read every value in `zh-CN/common.json`, `settings.json`, `chat.json`,
  `home.json`, and `errors.json` against the English context. Rewrite literal
  or Taiwan/Hong Kong phrasing in place using the glossary in the spec. Check
  punctuation, count wording, labels versus sentences, and technical names.

- [ ] **Step 4: Run resource tests.**

  Run:

  ```bash
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- src/i18n/localeValidation.test.ts
  ```

  Expected: the resource key, interpolation, plural, and rich-text assertions
  pass; source-audit assertions may still fail until Task 3 and Task 4 finish.

## Task 3: Migrate App, Settings, Integrations, and Shared UI Copy

**Files:** App shell/pages, app-management dialogs, settings/provider files,
integration files, and shared UI primitives listed in the File Map.

- [ ] **Step 1: Add `useTranslation` with the feature namespace to each file.**

  Use the first namespace for local keys and explicit prefixes such as
  `common:cancel` for shared keys. Keep all existing event handlers, test IDs,
  labels, and component structure unchanged.

- [ ] **Step 2: Replace visible literals and accessibility strings.**

  Convert headings, labels, buttons, placeholders, `title`, `aria-label`,
  `TooltipContent`, empty states, and static toasts to keys. Use
  `t("...", { value })` for runtime values. Keep dynamic error details as
  interpolation values after localizing the surrounding sentence.

- [ ] **Step 3: Handle rich text and technical identifiers.**

  Use `Trans` for sentences that require bold or inline links, or split them
  into separate localized spans. Keep `GitHub`, `Vercel`, `Supabase`, `Neon`,
  `Docker`, provider IDs, URL examples, branch names, and environment variables
  unchanged when they are identifiers rather than prose.

- [ ] **Step 4: Run the focused renderer tests.**

  Run:

  ```bash
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- src/components src/pages/home.test.tsx
  ```

  Expected: existing component tests pass, with any changed snapshots updated
  only when their rendered localized text is intentionally asserted.

## Task 4: Migrate Chat, Preview, Plugin, and Pro UI Copy

**Files:** `src/components/chat/`, `src/components/preview_panel/`,
`src/components/preview_panel/plan/`, `src/components/plugins/`, and
`src/pro/ui/`, excluding non-UI helpers and tests.

- [ ] **Step 1: Translate chat and agent status copy.**

  Migrate chat controls, voice input states, tool badges, Git summaries,
  queued-message actions, attachment dialogs, context warnings, questionnaire
  labels, and version history copy. Keep tool payloads and source code values
  intact while translating their surrounding UI labels.

- [ ] **Step 2: Translate preview and plan surfaces.**

  Migrate file tree/search, console filters, problems, security review, commit
  and staged-diff controls, database configuration, plan comments, loading and
  error states, tooltips, and screen-reader labels. Preserve filenames, paths,
  SQL, branch names, and diagnostic messages.

- [ ] **Step 3: Translate plugins and pro UI.**

  Migrate plugin forms, OAuth labels, MCP transport labels, media dialogs,
  annotator controls, and subscription/pro banners. Keep `stdio`, `HTTP`,
  `URL`, `MCP`, and client IDs/secrets as technical identifiers.

- [ ] **Step 4: Complete the source allowlist and dynamic registry.**

  Review each audit finding. Translate every user-facing sentence, add only
  legitimate technical names to `englishAllowlist.ts`, and add each remaining
  non-static translation call to `dynamicKeys.ts` with its namespace-qualified
  keys. Do not suppress a finding by adding a general English word pattern.

- [ ] **Step 5: Run the source audit.**

  Run:

  ```bash
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- src/i18n/sourceAudit.test.ts
  ```

  Expected: zero unapproved renderer strings, zero missing source-used keys,
  and zero unregistered dynamic calls.

## Task 5: Verify Formatting and Add the Focused E2E Flow

**Files:** `src/i18n/format.test.ts`, `e2e-tests/i18n_zh-CN.spec.ts`, and
existing page-object helpers only when a stable localization-independent
selector is missing.

- [ ] **Step 1: Add `zh-CN` formatting tests.**

  Assert that `formatDate`, `formatNumber`, and `formatRelativeTime` accept
  `zh-CN` and produce the expected locale-specific output for fixed dates and
  values. Mock `Date.now()` for relative-time determinism.

- [ ] **Step 2: Add the Playwright language flow.**

  Use `testWithConfig`/`po.setUp()` to open Settings, select `简体中文`, assert
  a translated heading, reload the app and assert the setting persists, visit
  Apps/Home, Chat, Settings, and Preview using stable `data-testid` selectors,
  open a confirmation or error dialog, and assert its Chinese title. Capture
  browser console messages and fail if an i18next missing-key warning appears.

- [ ] **Step 3: Run focused unit and E2E checks.**

  Run:

  ```bash
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- src/i18n/localeValidation.test.ts src/i18n/sourceAudit.test.ts src/i18n/format.test.ts
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run e2e -- e2e-tests/i18n_zh-CN.spec.ts
  ```

  Expected: all focused unit tests and the packaged-app E2E pass.

## Task 6: Full Verification and Manual Review

**Files:** No new files; review the complete branch diff.

- [ ] **Step 1: Initialize hooks and run repository checks.**

  Run:

  ```bash
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run init-precommit
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run fmt
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run lint
  PATH=/home/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run ts
  ```

  Re-run the focused unit tests after formatting/lint fixes and inspect
  `git status --short` for unrelated formatter edits, especially Markdown
  under `.claude/skills/`.

- [ ] **Step 2: Perform the manual Chinese review.**

  Inspect the full diff and search for Traditional forms such as `鼠標`,
  `檔案`, `資料`, `設定`, `網路`, `連接`, and `儲存`. Check that terminology
  remains consistent across home, chat, settings, preview, database, source
  control, and plugin surfaces. Check all placeholders and technical names.

- [ ] **Step 3: Review the final source audit and test output.**

  Confirm resource parity is zero, the source audit has no unapproved English,
  the E2E uses persisted `zh-CN`, and no unrelated files are staged. Commit
  implementation changes with a direct subject such as
  `feat: add Simplified Chinese localization`.

## Task 7: Issue, Fork, Push, and PR

**Files:** No repository files; GitHub state and branch remotes.

- [ ] **Step 1: Check the upstream issue list.**

  Use `gh issue list --repo dyad-sh/dyad --search "Simplified Chinese localization"`.
  If no matching issue exists, create a short issue using the user's GitHub
  identity explaining the missing `zh-CN` coverage and the proposed renderer
  localization. Do not include internal agent/process language.

- [ ] **Step 2: Create or confirm the fork and remotes.**

  Confirm `szh1118/dyad` exists with `gh repo view`. Create it with
  `gh repo fork dyad-sh/dyad --remote=false` only when it does not exist. Keep
  `upstream` pointed at `dyad-sh/dyad` and set `origin` push URL to the user
  fork. Do not put a token in any remote URL.

- [ ] **Step 3: Push the feature branch.**

  Push `codex/i18n-zh-cn` to the fork with `git push --set-upstream origin
  codex/i18n-zh-cn`, then verify the remote branch is ahead of `upstream/main`.

- [ ] **Step 4: Create the PR in a natural maintainer voice.**

  Use a concise title such as `Add Simplified Chinese localization`. The body
  should say what was localized, mention the Mainland terminology pass and
  the parity/source checks, and link the issue if one was created. Do not add
  generic AI headings, inflated claims, or a routine checklist. Use
  `--no-maintainer-edit` if fork permissions reject the default setting.

- [ ] **Step 5: Read back the published PR.**

  Verify author, head fork, base repository, title, body, changed-file list,
  and initial checks with `gh pr view`. Report the PR URL and any checks that
  remain pending.
