# Simplify Complex React Components

## Goal

Repeat the connector refactoring pattern used for `GitHubConnector` and
`VercelConnector` across other complex React components where it will improve
readability, state ownership, and testability without introducing generic
abstractions.

## Reference Pattern

The target shape is:

- `Component.tsx`: high-level orchestration and presentational subviews.
- `Component.hooks.ts`: provider/domain-specific workflow hooks that coordinate
  reducer state, React Query reads, mutations, debounce timers, and IPC calls.
- `Component.state.ts`: pure reducer state for local workflow/form transitions.
- `Component.*.test.ts(x)`: focused reducer and hook tests.

Use `rules/react-component-refactoring.md` as the operating guide.

## Candidate Selection

Prioritize components that have at least two of these signals:

- More than roughly 300 lines of mixed JSX, state, and async handlers.
- Three or more independent async operations with manual loading/error/success
  state.
- IPC-backed list/detail reads stored in local `useState`.
- IPC-backed writes implemented with hand-rolled `try/catch/finally` loading
  state.
- Multiple large conditional render branches inside one component.
- Behavior that is difficult to unit-test without rendering the whole UI.
- Repeated setter groups where one user action updates several related state
  fields.

Likely initial areas to inspect:

- `src/components/NeonConnector.tsx`
- `src/components/GithubBranchManager.tsx`
- `src/components/GithubCollaboratorManager.tsx`
- integration/settings components that combine auth, provider lists, and
  project setup
- large preview-panel components that mix IPC reads/writes with render branches

Do not refactor components just because they are long. Leave components alone
when the length is mostly straightforward static JSX or when extraction would
only create prop churn.

## Refactoring Sequence

### 1. Inventory State

For each candidate, classify every state field:

- Query data: server/IPC-backed list/detail data.
- Mutation lifecycle: pending/error/success for a write.
- Reducer workflow state: local mode, selected option, draft input, device-flow
  status, custom input mode, debounced availability result.
- Shared runtime state: data that must survive unmounts or cross component
  boundaries, usually Jotai.
- Presentation-only state: copied flag, expanded/collapsed UI, open dialog.

Write this inventory in the PR description or a short implementation note if the
component is especially tangled.

### 2. Add Query Keys

Before adding `useQuery`, add missing keys to `src/lib/queryKeys.ts`.

Use domain sections that already exist. Prefer hierarchical keys that can be
invalidated at the domain or entity level:

```ts
provider: {
  all: ["provider"] as const,
  projects: ["provider", "projects"] as const,
  branches: ({ projectId }: { projectId: string }) =>
    ["provider", "branches", projectId] as const,
}
```

### 3. Move Reads to React Query

Replace manual read state like:

```ts
const [projects, setProjects] = useState<Project[]>([]);
const [isLoadingProjects, setIsLoadingProjects] = useState(false);
```

with:

```ts
const projectsQuery = useQuery({
  queryKey: queryKeys.provider.projects,
  queryFn: () => ipc.provider.listProjects(),
  enabled: hasCredentials,
});
```

Expose `projectsQuery.data ?? []`, `projectsQuery.isLoading`, and
`projectsQuery.error?.message` from the workflow hook.

### 4. Move Writes to Mutations

Replace hand-rolled submit lifecycle state with `useMutation`.

Use `onSuccess` for follow-up effects:

- `refreshApp()`
- `refreshSettings()`
- `queryClient.invalidateQueries(...)`
- clearing local form state
- showing success/warning toasts

If the form should render mutation errors itself, expose
`mutation.error?.message` from the hook and catch `mutateAsync()` in the hook
action.

Keep domain-specific recovery logic explicit. For example, a Git operation that
can produce conflicts may still need custom reducer/Jotai state even if the
underlying IPC write uses a mutation.

### 5. Extract Workflow Hooks

Create narrow hooks around one workflow at a time:

- `useProviderTokenSetup`
- `useProviderProjectSetup`
- `useProviderDeviceFlow`
- `useProviderSync`

Each hook should expose:

```ts
return {
  state,
  actions,
  canSubmit,
};
```

Avoid exporting raw reducer dispatchers to JSX. Use named actions such as
`setMode`, `setProjectName`, `selectBranch`, and `submit`.

### 6. Extract Subviews

Split large render branches into named subviews:

- token/auth form
- project/repo setup form
- connected summary/actions
- conflict/recovery panel
- warning/confirmation dialog

Subview props should be boring and explicit. Passing `state`, `actions`, and a
small number of derived booleans is acceptable when it prevents long prop lists.

Do not create provider-agnostic connector components unless at least two
domains truly share behavior after the first extraction.

### 7. Update Tests

Use the new ownership boundaries:

- Reducer tests cover pure transitions only.
- Hook tests cover IPC orchestration, query/mutation behavior, debounce behavior,
  and success/error callbacks.
- Component tests cover render branching only when hook/reducer tests are not
  enough.
- E2E tests cover user flows that require Electron, routing, provider fakes, or
  multiple subviews working together.

Hooks that use React Query must be tested with a fresh `QueryClientProvider` per
test.

## Verification

For each component refactor:

1. Run focused unit tests for changed reducers/hooks.
2. Run `npm run ts`.
3. Run `npm run lint`.
4. Run E2E only when the refactor changes user-visible flow behavior or when
   unit tests require too much mocking to be meaningful.

## Success Criteria

A completed refactor should make at least two of these true:

- The main component reads as orchestration plus JSX, not a mix of unrelated
  workflows.
- IPC reads are owned by React Query.
- IPC writes are owned by mutations.
- Reducer state contains only client workflow/form state.
- Large conditional render branches have names.
- Behavior can be tested through reducer/hook tests without rendering the whole
  component.
- The diff removes duplicated loading/error/success bookkeeping.

## Anti-Goals

- Do not introduce a shared connector framework.
- Do not add Immer or a state-machine library unless a specific reducer becomes
  deeply nested or transition-heavy enough to justify it.
- Do not move server/IPC data into Jotai as a cache.
- Do not split components into many tiny files if all complexity remains in prop
  plumbing.
- Do not change visual design while doing structural refactors unless the
  refactor exposes a clear bug.
