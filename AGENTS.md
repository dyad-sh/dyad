# Repository Agent Guide

Please read `CONTRIBUTING.md` which includes information for human code contributors. Much of the information is applicable to you as well.

## Project setup and lints

Make sure you run this once after doing `npm install` because it will make sure whenever you commit something, it will run pre-commit hooks like linting and formatting.

```sh
npm run init-precommit
```

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

## IPC architecture expectations

1. `src/ipc/ipc_client.ts` runs in the renderer. Access it via `IpcClient.getInstance()` and expose dedicated methods per IPC channel.
2. `src/preload.ts` defines the renderer allowlist. New IPC APIs must be added here.
3. `src/ipc/ipc_host.ts` registers handlers that live in files under `src/ipc/handlers/` (e.g., `app_handlers.ts`, `chat_stream_handlers.ts`, `settings_handlers.ts`).
4. IPC handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.

## Architecture

### React Query key factory

All React Query keys must be defined in `src/lib/queryKeys.ts` using the centralized factory pattern. This provides:

- Type-safe query keys with full autocomplete
- Hierarchical structure for easy invalidation (invalidate parent to invalidate children)
- Consistent naming across the codebase
- Single source of truth for all query keys

**Usage:**

```ts
import { queryKeys } from "@/lib/queryKeys";

// In useQuery:
useQuery({
  queryKey: queryKeys.apps.detail({ appId }),
  queryFn: () => IpcClient.getInstance().getApp(appId),
});

// Invalidating queries:
queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
```

**Adding new keys:** Add entries to the appropriate domain in `queryKeys.ts`. Follow the existing pattern with `all` for the base key and factory functions using object parameters for parameterized keys.

## React + IPC integration pattern

When creating hooks/components that call IPC handlers:

- Wrap reads in `useQuery`, using keys from `queryKeys` factory (see above), async `queryFn` that calls the relevant `IpcClient` method, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the IPC client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
- Synchronize TanStack Query data with any global state (like Jotai atoms) via `useEffect` only if required.

## Database

This app uses SQLite and drizzle ORM.

Generate SQL migrations by running this:

```sh
npm run db:generate
```

IMPORTANT: Do NOT generate SQL migration files by hand! This is wrong.

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

Use E2E testing when you need to test a complete user flow for a feature.

If you would need to mock a lot of things to unit test a feature, prefer to write an E2E test instead.

Do NOT write lots of e2e test cases for one feature. Each e2e test case adds a significant amount of overhead, so instead prefer just one or two E2E test cases that each have broad coverage of the feature in question.

**IMPORTANT: You MUST run `npm run build` before running E2E tests.** E2E tests run against the built application binary, not the source code. If you make any changes to application code (anything outside of `e2e-tests/`), you MUST re-run `npm run build` before running E2E tests, otherwise you'll be testing the old version of the application.

```sh
npm run build
```

To run e2e tests without opening the HTML report (which blocks the terminal), use:

```sh
PLAYWRIGHT_HTML_OPEN=never npm run e2e
```

To get additional debug logs when a test is failing, use:

```sh
DEBUG=pw:browser PLAYWRIGHT_HTML_OPEN=never npm run e2e
```

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
