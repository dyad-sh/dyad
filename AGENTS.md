# Repository Agent Guide

Please read `CONTRIBUTING.md` which includes information for human code contributors. Much of the information is applicable to you as well.

## Rules index

> **IMPORTANT: BEFORE writing any code or making changes, you MUST read the relevant rule files from the table below.** Identify which areas your task touches and read those rule files first. Skipping this step leads to avoidable mistakes and rework.

Detailed rules and learnings are in the `rules/` directory. Read the relevant file when working in that area.

| File                                                                 | Read when...                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [rules/electron-ipc.md](rules/electron-ipc.md)                       | Adding/modifying IPC endpoints, handlers, React Query hooks, or renderer-to-main communication                                                                                 |
| [rules/dyad-errors.md](rules/dyad-errors.md)                         | Classifying IPC/main errors with `DyadError` / `DyadErrorKind` and PostHog exception filtering                                                                                 |
| [rules/local-agent-tools.md](rules/local-agent-tools.md)             | Adding/modifying local agent tools, tool flags (`modifiesState`), or read-only/plan-only guards                                                                                |
| [rules/e2e-testing.md](rules/e2e-testing.md)                         | Writing or debugging E2E tests (Playwright, Base UI radio clicks, Lexical editor, test fixtures)                                                                               |
| [rules/hybrid-testing.md](rules/hybrid-testing.md)                   | Writing or debugging Vitest integration tests, especially renderer+IPC harness tests and fake Dyad Engine/Gateway routing                                                      |
| [rules/git-workflow.md](rules/git-workflow.md)                       | Pushing branches, creating PRs, or dealing with fork/upstream remotes                                                                                                          |
| [rules/base-ui-components.md](rules/base-ui-components.md)           | Using TooltipTrigger, ToggleGroupItem, or other Base UI wrapper components                                                                                                     |
| [rules/database-drizzle.md](rules/database-drizzle.md)               | Modifying the database schema, generating migrations, or resolving migration conflicts                                                                                         |
| [rules/native-modules.md](rules/native-modules.md)                   | Adding Electron native modules or binaries that must survive Forge packaging/rebuild                                                                                           |
| [rules/typescript-strict-mode.md](rules/typescript-strict-mode.md)   | Debugging type errors from `npm run ts` (tsgo) that pass normal tsc                                                                                                            |
| [rules/openai-reasoning-models.md](rules/openai-reasoning-models.md) | Working with OpenAI reasoning model (o1/o3/o4-mini) conversation history                                                                                                       |
| [rules/prompt-guides.md](rules/prompt-guides.md)                     | Editing prompt guide Markdown under `src/prompts/guides/` or prompt assembly snapshots                                                                                         |
| [rules/adding-settings.md](rules/adding-settings.md)                 | Adding a new user-facing setting or toggle to the Settings page                                                                                                                |
| [rules/chat-mentions.md](rules/chat-mentions.md)                     | Modifying chat input mention parsing, `@app:` formatting, Lexical mention sync, or referenced app extraction                                                                   |
| [rules/chat-message-indicators.md](rules/chat-message-indicators.md) | Using `<dyad-status>` tags in chat messages for system indicators                                                                                                              |
| [rules/supabase-functions.md](rules/supabase-functions.md)           | Deploying, bundling, or queueing Supabase Edge Functions                                                                                                                       |
| [rules/product-principles.md](rules/product-principles.md)           | Planning new features, especially via `dyad:swarm-to-plan`, to guide design trade-offs                                                                                         |
| [rules/jotai-testing.md](rules/jotai-testing.md)                     | Unit-testing Jotai atoms/hooks with `renderHook`, especially across unmount/remount                                                                                            |
| [rules/jotai-state.md](rules/jotai-state.md)                         | Adding or refactoring Jotai atoms, especially deciding React Query vs Jotai ownership, entity-keyed state, derived atoms, and async runtime state                              |
| [rules/claude-github-workflows.md](rules/claude-github-workflows.md) | Editing `.github/workflows/*.yml` that invoke `anthropics/claude-code-action` — workflow shape, untrusted-input handling, and **permission/`.claude/settings.json` hardening** |
| [rules/ui-styling.md](rules/ui-styling.md)                           | Adding provider/brand icons, styling scrollable popovers, or using Tailwind v4 arbitrary values                                                                                |
| [rules/auto-update.md](rules/auto-update.md)                         | Debugging Squirrel/update-electron-app failures, update feed URLs, or updater log capture in bug reports and session debug bundles                                             |
| [rules/safe-storage.md](rules/safe-storage.md)                       | Working with Electron `safeStorage`, macOS Keychain identities, or legacy os_crypt secret recovery                                                                             |
| [rules/electron-workers.md](rules/electron-workers.md)               | Spawning `worker_threads`/`utilityProcess`, moving heavy computation off the main process, or diagnosing main-process memory usage and OOM crashes                             |
| [rules/app-naming.md](rules/app-naming.md)                           | Touching app display names, folder slugs, or flows that create/move app directories (create, copy, import, rename, blueprint approval, template apply)                         |

## Project setup and lints

Make sure you run this once after doing `npm install` because it will make sure whenever you commit something, it will run pre-commit hooks like linting and formatting.

```sh
npm run init-precommit
```

**Note:** Running `npm install` may update `package-lock.json` with version changes or peer dependency flag removals. If rebasing or performing git operations, commit these changes first to avoid "unstaged changes" errors.

## Git worktrees

When you create a new git worktree for this repository, run `npm install` inside the new worktree before starting development. Each worktree has its own working directory and needs its dependencies installed there.

## Pre-commit checks

RUN THE FOLLOWING CHECKS before you do a commit.

If you have access to the `/dyad:lint` skill, use it to run all pre-commit checks automatically:

```
/dyad:lint
```

Otherwise, run the following commands directly:

**Formatting**

```sh
npm run fmt
```

**Linting**

```sh
npm run lint
```

If you get any lint errors, you can usually fix it by doing:

```sh
npm run lint:fix
```

> **WARNING: Do NOT run `npx eslint` directly.** The project uses **oxlint** (not eslint) via `npm run lint`. Running `npx eslint <file>` produces spurious `import/no-unresolved` errors for `@/...` path aliases and other false positives — ignore those and rely on `npm run lint` / `npm run lint:fix`.

> **WARNING: Never run `npx oxlint --fix` or `npx oxfmt` before `node_modules` is installed.** Without the pinned local binary, `npx` downloads the _latest_ version, which can rewrite files repo-wide differently from the pinned version (observed: de-indented code blocks inside `e2e-tests/fixtures/*.md` and reflowed unrelated `src/` files). Use the lockfile-pinned `./node_modules/.bin/oxlint` / `./node_modules/.bin/oxfmt`, and check `git status` for collateral edits after any repo-wide `--fix` run.

**Type-checks**

```sh
npm run ts
```

Note: if you do this, then you will need to re-add the changes and commit again.

## Running TypeScript

> **WARNING: Do NOT run `npx tsc` or `tsc` directly.** The project is not set up for direct `tsc` invocation and will produce incorrect or misleading results.

**Always use:**

```sh
npm run ts
```

This is the only supported way to type-check the project. It uses the correct configuration and compiler (`tsgo`). Any other method of running TypeScript checks is unsupported and will likely give wrong results.

## Project context

- This is an Electron application with a secure IPC boundary.
- Frontend is a React app that uses TanStack Router (not Next.js or React Router).
- Data fetching/mutations should be handled with TanStack Query when touching IPC-backed endpoints.
- Main-process IPC errors that are **not bugs** (validation, missing entities, auth, user refusal, etc.) should be thrown as **`DyadError`** with a **`DyadErrorKind`** so they can be excluded from PostHog exception telemetry. See [rules/dyad-errors.md](rules/dyad-errors.md).

## Verifying your changes

You should test your changes before committing or pushing. Run relevant unit tests and E2E tests to verify expected behavior. If it's truly impossible to test a change locally (e.g. CI-only behavior, third-party service integration), note this in the PR description explaining why and what manual verification is needed.

## General guidance

- Favor descriptive module/function names that mirror IPC channel semantics.
- Keep Electron security practices in mind (no `remote`, validate/lock by `appId` when mutating shared resources).
- **Never embed GitHub tokens in git remote URLs** (e.g., `https://<token>@github.com/...`) — they persist in plaintext in users' `.git/config` and leak via git error output. Native git network operations (clone/fetch/pull/push) in `src/ipc/utils/git_utils.ts` inject auth per-invocation via `getGitNetworkEnv(accessToken)` (`GIT_CONFIG_*` env vars); any new network-touching git command must pass this env or auth will silently be missing for private repos.
- Add tests in the same folder tree when touching renderer components.
- **Sandbox hook restrictions:** inline `python3 -c "..."` is blocked, and Python scripts only run when the file lives inside the repo's `.claude/` directory — write helper scripts to `.claude/tmp/` (and clean them up before committing).
- **Always use Base UI (`@base-ui/react`) for UI primitives, never Radix UI.** This includes menus, tooltips, accordions, context menus, and other headless UI components. See [rules/base-ui-components.md](rules/base-ui-components.md) for component-specific guidance.

Use these guidelines whenever you work within this repository.

## Testing

Our project relies on a combination of unit tests, Vitest integration tests, and Playwright E2E tests. Unless your change is trivial, you MUST add a test; prefer the narrowest test type that proves the behavior.

### Unit testing

Use unit testing for pure business logic and util functions.

Target a Vitest file with `npm test -- path/to/file.test.ts`. Do not pass Jest-only flags such as `--runInBand`; Vitest will fail with `Unknown option '--runInBand'`.

Package-local Vitest suites may use their own config and not match the root `npm test -- path` include globs. For example, run `npm --prefix packages/ts-pg-schema-diff test` and `npm --prefix packages/ts-pg-schema-diff run typecheck` for `packages/ts-pg-schema-diff`.

### Vitest integration testing

Use Vitest integration tests (`*.integration.test.ts` / `*.integration.test.tsx`) when the behavior spans real app modules such as IPC handlers, sqlite, git, fake LLM/Engine routes, or renderer+IPC wiring, but does not require a packaged Electron app or browser-only behavior. Prefer this over Playwright when you can assert the behavior through the chat-flow or renderer+IPC harness with deterministic fake services.

Use Playwright E2E instead when the test needs the packaged Electron runtime, real browser/Electron behavior, native dialogs, screenshots, Monaco/Lexical browser interactions, full navigation flows, or confidence that only the real app shell provides. See [rules/hybrid-testing.md](rules/hybrid-testing.md) for integration-test guidance and [rules/e2e-testing.md](rules/e2e-testing.md) for Playwright guidance.

If `npm test` fails in files unrelated to your change, verify the failure is pre-existing before debugging: `git worktree add /tmp/main-check main`, symlink the repo's `node_modules` into it, and run the failing test file there. If it also fails on clean main, note it in the PR summary and move on. (Known example: `src/ipc/handlers/app_collection_handlers.test.ts` failed on main as of 2026-07-01.)

### E2E testing

> **IMPORTANT: You MUST run `npm run build` before running E2E tests.** E2E tests run against the built application, not the dev server. If you have changed any application code (i.e. anything outside of test files), you MUST re-run `npm run build` before running the tests, otherwise the tests will run against stale code and results will be misleading. Only changes to test code itself (e.g. files in `e2e-tests/`) do not require a rebuild.

See [rules/e2e-testing.md](rules/e2e-testing.md) for full E2E testing guidance, including Playwright tips and fixture setup.

**Debugging E2E test failures with screenshots:** When an E2E test fails and you can't determine the cause from the error message alone, use the `/dyad:debug-with-playwright` skill to add screenshots at key points in the test. Playwright's built-in `screenshot: "on"` does NOT work with Electron — you must use manual `page.screenshot()` calls. The skill walks you through adding debug screenshots, running the test, viewing the captured PNGs, and cleaning up afterward.

## Git workflow

When pushing changes and creating PRs:

1. If the branch already has an associated PR, push to whichever remote the branch is tracking.
2. If the branch hasn't been pushed before, default to pushing to `origin` (the fork `wwwillchen/dyad`), then create a PR from the fork to the upstream repo (`dyad-sh/dyad`).
3. If you cannot push to the fork due to permissions, push directly to `upstream` (`dyad-sh/dyad`) as a last resort.

### Skipping automated review

Add `#skip-bugbot` to the PR description for trivial PRs that won't affect end-users, such as:

- Claude settings, commands, or agent configuration
- Linting or test setup changes
- Documentation-only changes
- CI/build configuration updates
