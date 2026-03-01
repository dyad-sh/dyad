# Repository Agent Guide

Please read `CONTRIBUTING.md` which includes information for human code contributors. Much of the information is applicable to you as well.

## Rules index

> **IMPORTANT: BEFORE writing any code or making changes, you MUST read the relevant rule files from the table below.** Identify which areas your task touches and read those rule files first. Skipping this step leads to avoidable mistakes and rework.

Detailed rules and learnings are in the `rules/` directory. Read the relevant file when working in that area.

| File                                                                 | Read when...                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [rules/electron-ipc.md](rules/electron-ipc.md)                       | Adding/modifying IPC endpoints, handlers, React Query hooks, or renderer-to-main communication   |
| [rules/e2e-testing.md](rules/e2e-testing.md)                         | Writing or debugging E2E tests (Playwright, Base UI radio clicks, Lexical editor, test fixtures) |
| [rules/git-workflow.md](rules/git-workflow.md)                       | Pushing branches, creating PRs, or dealing with fork/upstream remotes                            |
| [rules/base-ui-components.md](rules/base-ui-components.md)           | Using TooltipTrigger, ToggleGroupItem, or other Base UI wrapper components                       |
| [rules/database-drizzle.md](rules/database-drizzle.md)               | Modifying the database schema, generating migrations, or resolving migration conflicts           |
| [rules/typescript-strict-mode.md](rules/typescript-strict-mode.md)   | Debugging type errors from `npm run ts` (tsgo) that pass normal tsc                              |
| [rules/openai-reasoning-models.md](rules/openai-reasoning-models.md) | Working with OpenAI reasoning model (o1/o3/o4-mini) conversation history                         |
| [rules/adding-settings.md](rules/adding-settings.md)                 | Adding a new user-facing setting or toggle to the Settings page                                  |
| [rules/chat-message-indicators.md](rules/chat-message-indicators.md) | Using `<coney-status>` tags in chat messages for system indicators                                |
| [rules/product-principles.md](rules/product-principles.md)           | Planning new features, especially via `coney:swarm-to-plan`, to guide design trade-offs           |

## Project setup and lints

Make sure you run this once after doing `npm install` because it will make sure whenever you commit something, it will run pre-commit hooks like linting and formatting.

```sh
npm run init-precommit
```

**Note:** Running `npm install` may update `package-lock.json` with version changes or peer dependency flag removals. If rebasing or performing git operations, commit these changes first to avoid "unstaged changes" errors.

## Pre-commit checks

RUN THE FOLLOWING CHECKS before you do a commit.

If you have access to the `/coney:lint` skill, use it to run all pre-commit checks automatically:

```
/coney:lint
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

## Verifying your changes

You should test your changes before committing or pushing. Run relevant unit tests and E2E tests to verify expected behavior. If it's truly impossible to test a change locally (e.g. CI-only behavior, third-party service integration), note this in the PR description explaining why and what manual verification is needed.

## General guidance

- Favor descriptive module/function names that mirror IPC channel semantics.
- Keep Electron security practices in mind (no `remote`, validate/lock by `appId` when mutating shared resources).
- Add tests in the same folder tree when touching renderer components.
- **Always use Base UI (`@base-ui/react`) for UI primitives, never Radix UI.** This includes menus, tooltips, accordions, context menus, and other headless UI components. See [rules/base-ui-components.md](rules/base-ui-components.md) for component-specific guidance.

Use these guidelines whenever you work within this repository.

## Testing

Our project relies on a combination of unit testing and E2E testing. Unless your change is trivial, you MUST add a test, preferably an e2e test case.

### Unit testing

Use unit testing for pure business logic and util functions.

### E2E testing

> **IMPORTANT: You MUST run `npm run build` before running E2E tests.** E2E tests run against the built application, not the dev server. If you have changed any application code (i.e. anything outside of test files), you MUST re-run `npm run build` before running the tests, otherwise the tests will run against stale code and results will be misleading. Only changes to test code itself (e.g. files in `e2e-tests/`) do not require a rebuild.

See [rules/e2e-testing.md](rules/e2e-testing.md) for full E2E testing guidance, including Playwright tips and fixture setup.

**Debugging E2E test failures with screenshots:** When an E2E test fails and you can't determine the cause from the error message alone, use the `/coney:debug-with-playwright` skill to add screenshots at key points in the test. Playwright's built-in `screenshot: "on"` does NOT work with Electron — you must use manual `page.screenshot()` calls. The skill walks you through adding debug screenshots, running the test, viewing the captured PNGs, and cleaning up afterward.

## Git workflow

When pushing changes and creating PRs:

1. If the branch already has an associated PR, push to whichever remote the branch is tracking.
2. If the branch hasn't been pushed before, default to pushing to `origin` (the fork `wwwillchen/coney`), then create a PR from the fork to the upstream repo (`coney-sh/coney`).
3. If you cannot push to the fork due to permissions, push directly to `upstream` (`coney-sh/coney`) as a last resort.

### Skipping automated review

Add `#skip-bugbot` to the PR description for trivial PRs that won't affect end-users, such as:

- Claude settings, commands, or agent configuration
- Linting or test setup changes
- Documentation-only changes
- CI/build configuration updates
