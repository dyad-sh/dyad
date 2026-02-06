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

This project uses a **contract-driven IPC architecture**. Contracts in `src/ipc/types/*.ts` are the single source of truth for channel names, input/output schemas (Zod), and auto-generated clients.

### Three IPC patterns

1. **Invoke/response** (`defineContract` + `createClient`) — Standard request-response calls.
2. **Events** (`defineEvent` + `createEventClient`) — Main-to-renderer pub/sub push events.
3. **Streams** (`defineStream` + `createStreamClient`) — Invoke that returns chunked data over multiple events (e.g., chat streaming).

### Key files

| Layer                      | File                                                            | Role                                                               |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Contract core              | `src/ipc/contracts/core.ts`                                     | `defineContract`, `defineEvent`, `defineStream`, client generators |
| Domain contracts + clients | `src/ipc/types/*.ts` (e.g., `settings.ts`, `app.ts`, `chat.ts`) | Per-domain contracts and auto-generated clients                    |
| Unified client             | `src/ipc/types/index.ts`                                        | Re-exports all clients; also exports `ipc` namespace object        |
| Preload allowlist          | `src/preload.ts` + `src/ipc/preload/channels.ts`                | Channel whitelist auto-derived from contracts                      |
| Handler registration       | `src/ipc/ipc_host.ts`                                           | Calls `register*Handlers()` from `src/ipc/handlers/`               |
| Handler base               | `src/ipc/handlers/base.ts`                                      | `createTypedHandler` with runtime Zod validation                   |

### Adding a new IPC endpoint

1. Define contracts in the relevant `src/ipc/types/<domain>.ts` file using `defineContract()`.
2. Export the client via `createClient(contracts)` from the same file.
3. Re-export the contract, client, and types from `src/ipc/types/index.ts`.
4. The preload allowlist is auto-derived from contracts — no manual channel registration needed.
5. Register the handler in `src/ipc/handlers/<domain>_handlers.ts` using `createTypedHandler(contract, handler)`.
6. Import and call the registration function in `src/ipc/ipc_host.ts`.

### Renderer usage

```ts
// Individual domain client
import { appClient } from "@/ipc/types";
const app = await appClient.getApp({ appId });

// Or use the unified ipc namespace
import { ipc } from "@/ipc/types";
const settings = await ipc.settings.getUserSettings();

// Event subscriptions (main -> renderer)
const unsub = ipc.events.agent.onTodosUpdate((payload) => { ... });

// Streaming
ipc.chatStream.start(params, { onChunk, onEnd, onError });
```

### Handler expectations

- Handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.
- Use `createTypedHandler(contract, handler)` which validates inputs at runtime via Zod.

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
import { appClient } from "@/ipc/types";

// In useQuery:
useQuery({
  queryKey: queryKeys.apps.detail({ appId }),
  queryFn: () => appClient.getApp({ appId }),
});

// Invalidating queries:
queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
```

**Adding new keys:** Add entries to the appropriate domain in `queryKeys.ts`. Follow the existing pattern with `all` for the base key and factory functions using object parameters for parameterized keys.

## React + IPC integration pattern

When creating hooks/components that call IPC handlers:

- Wrap reads in `useQuery`, using keys from `queryKeys` factory (see above), async `queryFn` that calls the relevant domain client (e.g., `appClient.getApp(...)`) or unified `ipc` namespace, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the domain client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
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

## Learnings

### Cross-repo PR workflows (forks)

When running GitHub Actions with `pull_request_target` on cross-repo PRs (from forks):

- The checkout action sets `origin` to the **fork** (head repo), not the base repo
- To rebase onto the base repo's main, you must add an `upstream` remote: `git remote add upstream https://github.com/<base-repo>.git`
- Remote setup for cross-repo PRs: `origin` → fork (push here), `upstream` → base repo (rebase from here)
- The `GITHUB_TOKEN` can push to the fork if the PR author enabled "Allow edits from maintainers"

### TooltipTrigger render prop (Base UI)

- `TooltipTrigger` from `@base-ui/react/tooltip` (wrapped in `src/components/ui/tooltip.tsx`) renders a `<button>` by default. Wrapping another button-like element (`<button>`, `<Button>`, `<DropdownMenuTrigger>`, `<PopoverTrigger>`, `<MiniSelectTrigger>`, `<ToggleGroupItem>`) inside it creates invalid nested `<button>` HTML. Use the `render` prop instead:

  ```tsx
  // Wrong: nested buttons
  <TooltipTrigger><Button onClick={fn}>Click</Button></TooltipTrigger>

  // Correct: render prop merges into a single element
  <TooltipTrigger render={<Button onClick={fn} />}>Click</TooltipTrigger>
  ```

- Wrapping `ToggleGroupItem` in `TooltipTrigger` without `render` also breaks `:first-child`/`:last-child` CSS selectors for rounded corners on the group.
- For drag handles and resize rails, prefer the native `title` attribute over `Tooltip` — tooltips appear immediately on hover and interfere with drag interactions, while `title` has a built-in delay.

### Base UI Radio component selection in Playwright

Base UI Radio components render a hidden native `<input type="radio">` with `aria-hidden="true"`. Both `getByRole('radio', { name: '...' })` and `getByLabel('...')` find this hidden input but can't click it (element is outside viewport). Use `getByText` to click the visible label text instead.

```ts
// Correct: click the visible label text
await page.getByText("Vue", { exact: true }).click();

// Won't work: finds hidden input, can't click
await page.getByRole("radio", { name: "Vue" }).click();
await page.getByLabel("Vue").click();
```

### Lexical editor in Playwright E2E tests

The chat input uses a Lexical editor (contenteditable). Standard Playwright methods don't always work:

- **Clearing input**: `fill("")` doesn't reliably clear Lexical. Use keyboard shortcuts instead: `Meta+a` then `Backspace`.
- **Timing issues**: Lexical may need time to update its internal state. Use `toPass()` with retries for resilient tests.
- **Helper methods**: Use `po.clearChatInput()` and `po.openChatHistoryMenu()` from test_helper.ts for reliable Lexical interactions.

```ts
// Wrong: may not clear Lexical editor
await chatInput.fill("");

// Correct: use helper with retry logic
await po.clearChatInput();

// For history menu (needs clear + ArrowUp with retries)
await po.openChatHistoryMenu();
```

### Drizzle migration conflicts during rebase

When rebasing a branch that has drizzle migrations conflicting with upstream (e.g., both have `0023_*.sql`):

1. Keep upstream's migration files (they're already deployed to production)
2. Rename the PR's conflicting migration to the next available index (e.g., `0023_romantic_mantis.sql` → `0025_romantic_mantis.sql`)
3. Update `drizzle/meta/_journal.json` to include all migrations with correct indices
4. Create/update the snapshot file (`drizzle/meta/00XX_snapshot.json`) with the new index, updating `prevId` to reference the previous snapshot's `id`
5. If the PR had subsequent commits that deleted/modified its migration files, those changes become no-ops after renaming — just accept the deletion conflicts by staging the renamed files

### tsgo is stricter than tsc for type checking

The pre-commit hook runs `tsgo` (via `npm run ts`), which is stricter than `tsc --noEmit`. For example, passing a `number` to a function typed `(str: string | null | undefined)` may pass `tsc` but fail `tsgo` with `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`. Always wrap with `String()` when converting numbers to string parameters.

### OpenAI reasoning model errors with conversation history

When using OpenAI reasoning models (o1, o3, o4-mini) via LiteLLM/Azure, you may see:

```
Item 'rs_...' of type 'reasoning' was provided without its required following item.
```

OpenAI's Responses API requires reasoning items to always be followed by an output item (text, tool-call). This error occurs when:

- The model produces reasoning then immediately makes tool calls (no text between)
- The stream is interrupted after reasoning but before output
- Only reasoning was generated in a turn

The fix in `src/ipc/utils/ai_messages_utils.ts` filters orphaned reasoning parts via `filterOrphanedReasoningParts()` before sending conversation history back to OpenAI.

### Adding a new user setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`

### Custom chat message indicators

The `<dyad-status>` tag in chat messages renders as a collapsible status indicator box. Use it for system messages like compaction notifications:

```
<dyad-status title="My Title" state="finished">
Content here
</dyad-status>
```

Valid states: `"finished"`, `"in-progress"`, `"aborted"`

### E2E test fixtures with .dyad directories

When adding E2E test fixtures that need a `.dyad` directory for testing:

- The `.dyad` directory is git-ignored by default in test fixtures
- Use `git add -f path/to/.dyad/file` to force-add files inside `.dyad` directories
- If `mkdir` is blocked on `.dyad` paths due to security restrictions, use the Write tool to create files directly (which auto-creates parent directories)
