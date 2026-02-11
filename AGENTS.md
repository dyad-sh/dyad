# Repository Agent Guide

Please read `CONTRIBUTING.md` which includes information for human code contributors. Much of the information is applicable to you as well.

## Rules index

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
| [rules/chat-message-indicators.md](rules/chat-message-indicators.md) | Using `<dyad-status>` tags in chat messages for system indicators                                |

## Project setup and lints

Make sure you run this once after doing `npm install` because it will make sure whenever you commit something, it will run pre-commit hooks like linting and formatting.

```sh
npm run init-precommit
```

**Note:** Running `npm install` may update `package-lock.json` with version changes or peer dependency flag removals. If rebasing or performing git operations, commit these changes first to avoid "unstaged changes" errors.

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

**Type-checks**

```sh
npm run ts
```

Note: if you do this, then you will need to re-add the changes and commit again.

## Project context

- This is an Electron application with a secure IPC boundary.
- Frontend is a React app that uses TanStack Router (not Next.js or React Router).
- Data fetching/mutations should be handled with TanStack Query when touching IPC-backed endpoints.

## General guidance

- Favor descriptive module/function names that mirror IPC channel semantics.
- Keep Electron security practices in mind (no `remote`, validate/lock by `appId` when mutating shared resources).
- Add tests in the same folder tree when touching renderer components.

Use these guidelines whenever you work within this repository.

## Testing

Our project relies on a combination of unit testing and E2E testing. Unless your change is trivial, you MUST add a test, preferably an e2e test case.

### Unit testing

Use unit testing for pure business logic and util functions.

### E2E testing

See [rules/e2e-testing.md](rules/e2e-testing.md) for full E2E testing guidance, including Playwright tips and fixture setup.

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

## Learnings

### Cross-repo PR workflows (forks)

When running GitHub Actions with `pull_request_target` on cross-repo PRs (from forks):

- The checkout action sets `origin` to the **fork** (head repo), not the base repo
- To rebase onto the base repo's main, you must add an `upstream` remote: `git remote add upstream https://github.com/<base-repo>.git`
- Remote setup for cross-repo PRs: `origin` → fork (push here), `upstream` → base repo (rebase from here)
- The `GITHUB_TOKEN` can push to the fork if the PR author enabled "Allow edits from maintainers"

### AI SDK step.usage in onStepFinish vs onFinish

In the AI SDK's `streamText`, `step.usage.totalTokens` in `onStepFinish` is **per-step** (single LLM call), not cumulative. The cumulative usage across all steps is only available in `onFinish` via `response.usage.totalTokens`. For context window comparisons (e.g., compaction thresholds), per-step usage is actually more accurate since each step's input tokens already include the full conversation context.

### AI SDK stepNumber is 0-indexed

In `prepareStep`, the AI SDK sets `stepNumber = steps.length`. The first call has `steps = []` so `stepNumber = 0`, the second call has one step so `stepNumber = 1`, etc. When writing tests that mock `prepareStep`, use 0-indexed step numbers to match real SDK behavior.

### Compaction test mock messages need createdAt

`buildChatMessageHistory` and `getMidTurnCompactionSummaryIds` call `createdAt.getTime()` on chat messages to detect mid-turn compaction summaries. Test messages created via `buildTestChat` must include `createdAt` on every message (including mock compaction summaries added by `performCompaction`). Missing `createdAt` causes a silent TypeError inside the async generator that manifests as `undefined` return values rather than an obvious error.

### Custom chat message indicators

The `<dyad-status>` tag in chat messages renders as a collapsible status indicator box. Use it for system messages like compaction notifications:

```
<dyad-status title="My Title" state="finished">
Content here
</dyad-status>
```

Valid states: `"finished"`, `"in-progress"`, `"aborted"`
