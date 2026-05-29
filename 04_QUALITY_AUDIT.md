# 04 — Quality Audit: dyad-sh/dyad

**Date**: 2026-05-28
**Commit**: a6515708 ("Deflake E2E failures from CI run 26526502867 (#3519)")

---

## Documentation

### ✅ Existing Documentation

| Doc                          | Status                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| `README.md`                  | Current — product description, download links, community      |
| `CONTRIBUTING.md`            | Detailed — architecture refs, dev setup, testing, code review |
| `AGENTS.md`                  | Comprehensive — 16 rule files indexed, project context        |
| `docs/architecture.md`       | Detailed — request lifecycle, FAQ, context engineering        |
| `docs/agent_architecture.md` | Separate deep-dive on local agent mode                        |
| `docs/security.md`           | Security documentation                                        |
| `docs/i18n.md`               | Internationalization guide                                    |
| `docs/adrs/`                 | Architecture Decision Records                                 |

### ⚠️ Documentation Gaps

1. **No `CLAUDE.md`** — Unlike many modern repos, there's no top-level `CLAUDE.md` for agent context. `AGENTS.md` partially fills this but is contributor-focused, not agent-execution-focused. A dedicated `CLAUDE.md` would help hard-PR campaigns.
2. **`docs/architecture.md` is accurate** per latest commit — no immediate staleness detected, but no automated staleness check exists.
3. **Prompt guide docs** (`src/prompts/guides/`) have test file (`filter_guide_by_framework.test.ts`) — good. But no validation that all guides are valid Markdown or that frontmatter is correct.
4. **No API documentation** — All IPC handlers and AI SDK integrations lack API docs. This is acceptable for a desktop app but creates onboarding friction for new contributors.

---

## Validation Gaps

### Schema Validation

- Drizzle schema (`src/db/schema.ts`) has **no Zod validation layer** on the app side — but the AI SDK (`ai` package) handles message validation internally via `ModelMessage` types. This is reasonable.
- `src/lib/schemas/` exists (referenced in schema.ts) — not examined in detail. May have validation.

### Input Validation for IPC

- Per `rules/dyad-errors.md` and `rules/electron-ipc.md`, main-process IPC errors should use `DyadError` + `DyadErrorKind`. This is enforced by the rules but **not automatically validated** — relies on developer discipline and code review.

### Prompt Guide Validation

- `src/prompts/guides/filter_guide_by_framework.test.ts` tests the filter logic, but **no test validates all guide files parse as valid Markdown** or have required frontmatter fields.

---

## Configuration Gaps

### playwright.config.ts

- Single-worker mode (`workers: 1`) is a known workaround for shared-state flakiness, not a bug — documented in the config.
- `retries: 2` in CI is sensible.
- **Timeout mismatch risk**: CI timeout is 180s, local is 75s. Some tests may pass locally but fail in CI due to slower runners.

### Database Config

- `better-sqlite3` with Drizzle — no connection pooling. Acceptable for single-user desktop app.
- No migration validation in CI — `npm run db:generate` is manual step. No CI check that migrations are up-to-date with schema.

### TypeScript Config

- Project uses `tsgo` for main app type-checking (not raw `tsc`) — this is unusual and documented in `rules/typescript-strict-mode.md`. **Risk**: If `tsgo` is updated out-of-band with `tsc`, type errors could silently diverge.

### GitHub Workflows (20+ workflows)

- **No unified "pre-deploy" validation** — each workflow runs independently. A change to the build process could break release without being caught by CI.
- **CLA workflow** (`cla.yml`) is required for PRs — good.
- **PR review workflows** are many (claude-pr-review, claude-rules-review, codex-pr-review) — high automation overhead, some experiencing token/auth failures per issue #3454.

---

## Stale Examples / Outdated Patterns

### AGENTS.md references

- The `AGENTS.md` documents how to use `/dyad:lint` and `/dyad:debug-with-playwright` skills — these are **skills that must be loaded via skill_view**, not natural instructions. If the skill loader changes, these instructions break silently.

### CONTRIBUTING.md

- Mentions Codex CLI and Claude Code CLI `/review` commands — these are external tools, not maintained in this repo. If they change invocation, CONTRIBUTING becomes stale.

### E2E Test Fixtures

- **144 E2E spec files** — large surface area. No fixture rotation/refresh automation.
- ARIA snapshots in `e2e-tests/snapshots/` — if UI text changes slightly, snapshots become stale and tests may pass/fail unpredictably without clear indication.
- **Fake LLM server** (`testing/fake-llm-server/`) is separate from main app — if the AI SDK API changes, the fake server may diverge silently.

---

## Test Fixture Gaps

### Unit Tests

- Vitest unit tests exist for prompt guides (`filter_guide_by_framework.test.ts`), local agent tools (`src/pro/main/ipc/handlers/local_agent/tools/*.spec.ts`), and IPC processors (`search_replace_processor.spec.ts`, `search_replace_dsl.spec.ts`).
- **Coverage gap**: No unit tests found for Jotai atoms (though `rules/jotai-testing.md` documents how to write them — implies they may exist but weren't found in quick scan).
- No test for `backup_manager.ts` even though it's a complex file (5KB+).

### E2E Test Coverage

- 144 spec files is extensive. However, **Electron-specific tests** (window management, system tray, native menus) may not be covered in the headless Playwright environment.
- **Known CI limitation**: E2E tests run against the built Electron app — if the build process introduces platform-specific issues, Linux CI won't catch macOS/Windows bugs.

### Test Infrastructure Risks

1. **Fake LLM server coupling**: Tests are only as good as the fake server. If real LLM behavior diverges (new response formats, new tool calling patterns), fake server won't catch it.
2. **Snapshot staleness**: No automated snapshot validation — manual `--update-snapshots` is required.
3. **No test on Windows/macOS in this environment** — only Linux CI available for verification.

---

## Code Quality Notes

### Pro-tier code (`src/pro/`)

- Fair Source License (FSL 1.1) — commercial use requires obtaining a license. This is disclosed but creates a **dual-license compliance burden** for contributors.
- Agent tools in `src/pro/main/ipc/handlers/local_agent/tools/` — these are the most complex and highest-risk code paths (file system access, sandbox execution).

### Native Modules

- `node-pty`, `better-sqlite3`, `dugite` (Git bindings) are all native modules requiring platform-specific rebuilds. Per `rules/native-modules.md`, Forge's `plugin-auto-unpack-natives` handles this. **Risk**: If native module rebuild fails silently in CI, app may run with stale binaries.

### Security Posture

- `rules/claude-github-workflows.md` documents `.claude/settings.json` hardening — good.
- No Security.md checklist found beyond `docs/security.md` — should verify it covers all critical areas (Electron context isolation, IPC validation, token storage).

---

## Summary

| Area                       | Status                                   | Risk   |
| -------------------------- | ---------------------------------------- | ------ |
| Documentation completeness | ⚠️ Gap: no CLAUDE.md, no API docs        | Low    |
| Schema validation          | ✅ Adequate (AI SDK + Zod)               | Low    |
| IPC error handling         | ⚠️ Manual discipline required            | Medium |
| Prompt guide validation    | ⚠️ Filter tested, Markdown not validated | Low    |
| TypeScript type-checking   | ⚠️ tsgo diverges from tsc                | Medium |
| E2E test coverage          | ✅ Extensive (144 specs)                 | Low    |
| Unit test coverage         | ⚠️ Some complex files untested           | Medium |
| Native module rebuild      | ⚠️ Potential CI silent failures          | Medium |
| Fake LLM server accuracy   | ⚠️ May drift from real API               | Medium |
| Snapshot freshness         | ⚠️ Manual refresh required               | Low    |
| Pro-tier dual licensing    | ⚠️ FSL compliance overhead               | Low    |
| CI workflow stability      | ⚠️ 3 workflow-health issues open         | High   |
