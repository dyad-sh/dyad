# Simplified Chinese i18n Design

## Problem

Dyad already ships a `zh-CN` locale, but it is behind the English resources and
the renderer still contains user-visible English strings. The current English
resources contain 1,362 leaf values; the Chinese resources are missing 60 of
those values. A source audit also found translation calls that are not present
in the English resources and hard-coded copy in pages, dialogs, settings,
preview panels, tooltips, accessibility attributes, and error fallbacks.

The goal is a complete, maintainable Simplified Chinese experience for the
renderer, with terminology written for Mainland Chinese users rather than a
mechanical Traditional-to-Simplified conversion.

## Goals

- Bring `zh-CN` to exact key parity with `en` across all five existing
  namespaces: `common`, `settings`, `chat`, `home`, and `errors`.
- Move user-visible renderer copy into the existing `react-i18next` system,
  including JSX text, accessible labels, titles, placeholders, tooltips,
  toasts, dialogs, and static error fallbacks.
- Preserve runtime interpolation, plural forms, rich-text markers, product
  names, model names, protocol names, code, branch names, URLs, and environment
  variables.
- Use Mainland Chinese product terminology and consistent punctuation and
  sentence style.
- Add automated checks that fail when resources drift or new user-visible
  English is added without an explicit exception.
- Verify language switching, persistence, formatting, and representative UI
  flows before publishing the change.

## Scope

The renderer scope includes all UI code under `src/app`, `src/pages`,
`src/components` (including `src/components/ui`), `src/pro/ui`, and any other
renderer module imported by the application entry point. The audit covers
`JSXText`, text in JSX expressions, `aria-label`, `title`, `placeholder`, `alt`,
tooltips, toast messages, dialog copy, error boundaries, and static fallback
messages.

The change does not translate prompts, tests, fixtures, snapshots, developer
logs, backend-only messages, example code, or text that is intentionally part
of a code editor, tool payload, protocol, command, URL, model identifier, or
environment variable. Dynamic errors returned by IPC or third-party services
remain visible as diagnostic details; their static explanatory prefix and
fallback are localized.

## Design

### Resource structure

The implementation keeps the current five namespaces and resource loading in
`src/i18n/index.ts`. New keys are added to both the English source and
`zh-CN`; other locales continue to fall back to English until they are updated
independently. Existing keys are reused where the meaning and context match.

The English resource remains the type source in `src/i18n/types.ts`. No new
language code or alternate runtime is introduced.

### Component migration

Each migrated component uses the namespace that owns its feature. Shared
labels and actions use `common`; settings use `settings`; chat and agent
surfaces use `chat`; home, app management, preview, integrations, library,
and media surfaces use `home`; reusable error messages use `errors`.

Text that contains formatting or nested JSX uses `Trans` with explicit rich
text markers, or is split into localized fragments when that keeps the
translation natural. Static fallback errors become localized keys with an
`{{error}}` interpolation. Unknown error text is passed through only as the
diagnostic value, never used as the localization key.

The migration also covers accessibility copy. An icon-only button keeps its
localized accessible name, and technical values such as `GitHub`, `MCP`,
`HTTP`, `URL`, `Node.js`, `Docker`, and provider/model names remain unchanged
when they are product or protocol identifiers.

### Translation quality rules

Translations are written manually and reviewed in context. The glossary uses
the following Mainland Chinese choices unless a feature-specific context
requires a more precise term:

| English concept       | Simplified Chinese choice             |
| --------------------- | ------------------------------------- |
| mouse                 | 鼠标                                  |
| file / folder         | 文件 / 文件夹                         |
| repository            | 仓库                                  |
| project / app         | 项目 / 应用                           |
| deploy / publish      | 部署 / 发布                           |
| commit / stage / push | 提交 / 暂存 / 推送                    |
| rollback / restore    | 回滚 / 恢复                           |
| provider              | 提供商                                |
| token                 | 令牌                                  |
| troubleshooting       | 故障排查                              |
| review                | 检查 or 审查, chosen by the operation |

Chinese punctuation and spacing are adjusted per sentence rather than copied
from English. Product names, code identifiers, branch names, file names,
commands, URLs, and environment variables are not translated. The review
also checks for Traditional Chinese forms and for awkward literal phrasing.

### Static i18n audit

An i18n test helper uses `@babel/parser` with TypeScript and JSX plugins to
inspect renderer source files. It must cover:

- nested resource keys in `en` and `zh-CN`;
- interpolation variables, plural `_one`/`_other` pairs, and `Trans` rich-text
  markers;
- literal `t()` calls, `i18n.t`, `getFixedT`, `<Trans>`, explicit namespaces,
  and `defaultValue` values;
- hard-coded JSX text and visible string attributes;
- static toast, dialog, error, and fallback messages.

Translation calls whose key is not statically resolvable are listed in a
central dynamic-key registry. The audit fails in both directions: every
non-static call site must have a registry entry, and every registry key must
exist in both `en` and `zh-CN`. The registry includes the conditional branches
used by the current UI, so a new dynamic call cannot bypass the check.

The audit has a small explicit allowlist for legitimate English technical
identifiers and product/model/protocol names. The allowlist is reviewed with
the diff and is not a general exemption for UI sentences.

### Formatting and fallback checks

Tests cover `formatDate`, `formatNumber`, and `formatRelativeTime` with
`zh-CN`, plus changing the i18next instance to `zh-CN` and verifying the
localized resources resolve without missing-key events. An English fallback is
allowed only for the explicit technical-name allowlist and for languages whose
locale is not being changed by this work.

### End-to-end acceptance

Add a focused Playwright flow that:

1. selects `zh-CN` in settings;
2. reloads or restarts the app and verifies the choice persists;
3. visits the home, chat, settings, and preview surfaces;
4. opens an error or confirmation dialog and verifies its Chinese copy;
5. confirms no missing-key warning is emitted during the flow.

Because the application tests run against the packaged build, the build is
regenerated before running this E2E test.

## Verification

The implementation is complete only when all of the following pass:

- resource parity, interpolation, plural, rich-text, dynamic-key, and source
  hard-code audits;
- focused Vitest suites for i18n and formatting;
- `npm run fmt`, `npm run lint`, and `npm run ts`;
- `npm run build` followed by the focused i18n E2E flow;
- a manual diff review for terminology, Traditional Chinese remnants, English
  fallback, technical-name preservation, and unrelated file changes.

## Publication

Before opening the PR, check for an existing upstream issue and create a
short issue if the repository still requires one for this contribution. Use
the current GitHub identity and its fork, create a feature branch, and ensure
the commit author matches that identity. The PR title and body will be short,
specific, and written as a maintainer contribution: explain that this adds
Simplified Chinese coverage, mention the main UI areas covered, and call out
the terminology and automated checks without generic AI-style sections or
claims.

## Acceptance criteria

- Every English resource leaf has a corresponding `zh-CN` translation.
- No unapproved user-visible English remains in the renderer scope.
- Chinese copy uses Mainland terminology and preserves technical identifiers.
- Language switching and persistence work across the representative flows.
- The complete verification set passes and the published PR contains only the
  intended localization, test, and necessary documentation changes.
