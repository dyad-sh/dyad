# Repository Agent Guide

Please read `CONTRIBUTING.md` which includes information for human code contributors. Much of the information is applicable to you as well.

## Project context

- Dyad is an Electron app (v0.33.0) — a local, open-source AI app builder
- Frontend: React 19 with TanStack Router (not Next.js or React Router)
- State: Jotai atoms for global UI state, TanStack Query for server state
- Database: SQLite with Drizzle ORM
- UI: Radix UI primitives + Tailwind CSS + shadcn/ui components
- Build: Vite + Electron Forge
- Node: Requires Node >=20

For architecture details, see:
- `docs/architecture.md` — High-level Electron architecture and request lifecycle
- `docs/agent_architecture.md` — Local agent tool-calling design

## IPC architecture

Dyad uses a secure IPC boundary between renderer (React) and main (Node.js) processes.

**Three-tier structure:**

1. **`src/ipc/ipc_client.ts`** — Renderer-side singleton. Access via `IpcClient.getInstance()`. Exposes typed methods per IPC channel.
2. **`src/preload.ts`** — Security allowlist. New IPC APIs must be added here.
3. **`src/ipc/handlers/`** — Main process handlers (e.g., `app_handlers.ts`, `chat_stream_handlers.ts`). Registered in `src/ipc/ipc_host.ts`.

**Error handling:** IPC handlers should `throw new Error("...")` on failure — NOT `{ success: false }` style payloads. Use `createLoggedHandler` wrapper from `src/ipc/handlers/safe_handle.ts` for consistent error logging.

## React + IPC integration

When creating hooks/components that call IPC handlers:

```typescript
// Reads: wrap in useQuery
const { data } = useQuery({
  queryKey: ["apps"],
  queryFn: () => IpcClient.getInstance().getApps(),
});

// Writes: wrap in useMutation, invalidate on success
const mutation = useMutation({
  mutationFn: (params) => IpcClient.getInstance().createApp(params),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apps"] }),
  onError: (error) => toast.error(error.message),
});
```

- Use `enabled`/`initialData`/`meta` on `useQuery` as needed
- Synchronize TanStack Query data with Jotai atoms via `useEffect` only if required
- Custom hooks go in `src/hooks/`

## State management

- **Jotai atoms** (`src/atoms/`): Global UI state (selected chat, streaming status, etc.)
- **TanStack Query**: Server/async state (API calls, IPC data fetching)
- **Local state**: Component-specific state with `useState`

```typescript
// Atoms example
import { atom, useAtom } from "jotai";
export const selectedChatIdAtom = atom<number | null>(null);
```

## Database

SQLite + Drizzle ORM. Schema defined in `src/db/schema.ts`.

**Generate migrations after schema changes:**
```sh
npm run db:generate
```

**IMPORTANT:** Do NOT generate SQL migration files by hand!

**Other commands:**
- `npm run db:push` — Apply migrations
- `npm run db:studio` — Interactive database explorer
- To reset: delete `userData/sqlite.db`

## Testing

**Unit tests** (Vitest): For pure business logic and utilities
- Co-locate tests with source files: `*.test.ts`, `*.spec.ts`
- Run: `npm test` | `npm run test:watch` | `npm run test:ui`

**E2E tests** (Playwright): For complete user flows
- Located in `e2e-tests/`
- Build app first: `npm run pre:e2e`
- Run: `npm run e2e` | `npm run e2e e2e-tests/file.spec.ts`
- Update snapshots: `npm run e2e -- --update-snapshots`

**Mocking patterns:**
```typescript
// node:fs (requires default export)
vi.mock("node:fs", async () => ({
  default: { mkdirSync: vi.fn(), writeFileSync: vi.fn() },
}));

// isomorphic-git
vi.mock("isomorphic-git", () => ({
  default: { add: vi.fn().mockResolvedValue(undefined) },
}));

// Electron
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
```

**Guideline:** If you need heavy mocking, prefer E2E tests instead.

## Code style & linting

**Pre-commit hooks:** Set up with `npm run init-precommit`

Runs automatically:
- `npm run ts` — TypeScript type check
- `oxlint` — Fast linting
- `prettier` — Code formatting

**Manual commands:**
```sh
npm run presubmit     # prettier:check + lint (run before committing)
npm run lint          # oxlint with auto-fix
npm run prettier      # format all files
npm run ts            # type check (main + workers)
```

**Linting rules (oxlint + biome):**
- `noUnusedImports`: error
- `noUnusedVars`: error
- `noExplicitAny`: allowed (but avoid when possible)
- `noNonNullAssertion`: allowed

## Common commands

```sh
npm start              # Run dev app
npm run package        # Build app
npm run make           # Build installers
npm test               # Unit tests
npm run e2e            # E2E tests (after pre:e2e)
npm run db:generate    # Generate DB migrations
npm run presubmit      # Pre-commit checks
```

## Adding new features

### Adding an IPC endpoint

1. Add handler in `src/ipc/handlers/` (or extend existing)
2. Register in `src/ipc/ipc_host.ts` if new file
3. Add to preload allowlist in `src/preload.ts`
4. Add typed method in `src/ipc/ipc_client.ts`
5. Create hook in `src/hooks/` using `useQuery`/`useMutation`

### Adding a local agent tool (Pro feature)

1. Create tool in `src/pro/main/ipc/handlers/local_agent/tools/`
2. Register in `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts`
3. Add UI renderer in `src/components/chat/DyadMarkdownParser.tsx`
4. Add E2E test fixture in `e2e-tests/fixtures/engine/`

### Adding a UI component

1. Use Radix UI primitives + Tailwind CSS
2. Place reusable components in `src/components/ui/`
3. Follow functional component + hooks pattern
4. Add tests for complex logic

## Security practices

- Never use Electron `remote` module
- Validate/lock by `appId` when mutating shared resources
- All renderer-to-main communication goes through IPC allowlist
- Use Zod schemas for runtime validation of IPC payloads

## File organization

```
src/
├── atoms/           # Jotai global state
├── components/      # React components (organized by feature)
│   ├── chat/        # Chat-related components
│   ├── settings/    # Settings components
│   └── ui/          # Reusable UI primitives
├── contexts/        # React contexts
├── db/              # Database schema and types
├── hooks/           # Custom React hooks
├── ipc/             # IPC architecture
│   ├── handlers/    # Main process handlers
│   ├── processors/  # Response processing logic
│   └── ipc_client.ts, ipc_host.ts, ipc_types.ts
├── lib/             # Shared utilities and Zod schemas
├── pages/           # Route page components
├── pro/             # Fair-source Pro features (FSL 1.1 licensed)
└── utils/           # General utilities
```

## Naming conventions

- IPC handlers: `<domain>_handlers.ts` (e.g., `app_handlers.ts`)
- Hooks: `use<Feature>.ts` (e.g., `useStreamChat.ts`)
- Atoms: `<domain>Atoms.ts` (e.g., `chatAtoms.ts`)
- Components: PascalCase (e.g., `ChatMessage.tsx`)
- Use descriptive names that mirror IPC channel semantics

Use these guidelines whenever you work within this repository.
