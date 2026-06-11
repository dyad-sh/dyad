# React Component Refactoring

Use these guidelines when simplifying large React components, especially
components that mix form state, IPC calls, async loading/error state, and large
JSX branches.

## State Ownership

- React Query owns IPC-backed reads. Use `useQuery` with keys from
  `src/lib/queryKeys.ts` for list/detail reads such as provider projects,
  repositories, branches, deployments, settings-backed data, and app-backed
  data.
- `useMutation` owns IPC-backed writes. Use it for create/connect/disconnect,
  save, deploy, sync, and other imperative IPC actions. Derive pending, error,
  and success UI from the mutation instead of duplicating that lifecycle in
  local reducer state.
- Reducers own client-only workflow state when transitions matter: form mode,
  selected input mode, local text input, device-flow status, derived defaults,
  and other UI state that is not server data.
- Keep Jotai for state that must survive unmounts or be shared beyond the
  component subtree. Do not move IPC data into Jotai just to avoid prop passing.

## Extraction Shape

- Split large components into provider/domain-specific subviews before creating
  shared abstractions. Prefer `GitHubDeviceConnection`,
  `GitHubRepoSetupForm`, `VercelTokenForm`, etc. over a generic connector
  framework unless multiple domains truly share behavior.
- Keep subviews presentational where practical: pass `state`, `actions`, and
  derived booleans such as `canSubmit` rather than exposing raw reducer
  dispatchers in JSX.
- Put workflow orchestration in narrow hooks such as `useGitHubRepoSetup` or
  `useVercelProjectSetup`. Hooks may combine reducer state, React Query reads,
  mutations, debounce timers, and IPC calls for one workflow.
- Keep pure transition logic in `*.state.ts` files when it is worth testing
  independently. Keep hook orchestration in `*.hooks.ts`.

## Query and Mutation Details

- Add every query key to `src/lib/queryKeys.ts`; do not inline ad hoc query key
  arrays in components or hooks.
- Use `enabled` for reads that require credentials, app ids, selected repos, or
  selected projects.
- Let query data provide list values directly, e.g. `projectsQuery.data ?? []`.
  Avoid copying query results into reducer state unless the user edits a local
  draft of that data.
- Use mutation `onSuccess` for follow-up actions like `refreshApp()`,
  `refreshSettings()`, cache invalidation, or clearing local form input.
- If a submit action displays mutation errors through hook state, catch
  `mutateAsync()` inside the hook action so form submits do not create
  unhandled promise rejections.
- Keep custom domain recovery flows outside generic mutation state when needed.
  For example, GitHub sync still needs explicit conflict/rebase recovery state
  even though the push IPC call can run through `useMutation`.

## Testing

- Unit-test pure reducers for state transitions only. Do not keep reducer tests
  for async lifecycle states after those states move to React Query or
  mutations.
- Unit-test workflow hooks with `renderHook`. Wrap them in a fresh
  `QueryClientProvider` when they use `useQuery` or `useMutation`.
- Prefer hook/reducer tests over mounting a full connector when the behavior can
  be verified without rendering the full UI.
- Keep focused component/E2E coverage for user-visible flows that require real
  interaction between subviews, IPC fakes, and routing.

## Refactoring Checklist

1. Inventory state and classify each field as query data, mutation lifecycle,
   reducer-owned UI workflow state, Jotai/shared runtime state, or local
   presentation state.
2. Add missing query keys before adding `useQuery`.
3. Move IPC reads to `useQuery`, then remove duplicated loading/list reducer
   fields.
4. Move IPC writes to `useMutation`, then remove duplicated pending/error/success
   reducer fields.
5. Extract large JSX branches into subviews with named props.
6. Extract workflow hooks only after state ownership is clear.
7. Update tests to match the new ownership boundaries.
