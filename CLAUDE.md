# CLAUDE.md — Project instructions for Claude Code

## Project Overview

JoyCreate is an Electron desktop app built with:
- **React 19** + **TypeScript** (renderer)
- **TanStack Router** (routing) + **TanStack Query** (data fetching)
- **Jotai** (state management)
- **SQLite** via **Drizzle ORM** (database)
- **Vite** (bundler — separate configs for main, renderer, preload, worker)

## Architecture

### IPC Boundary (most important pattern)

```
Component → Hook (useQuery/useMutation) → IpcClient method → preload channel → Main handler
```

- **Renderer**: `src/ipc/ipc_client.ts` — `IpcClient.getInstance()`, one method per channel
- **Preload allowlist**: `src/preload.ts` — new channels MUST be added here
- **Main handlers**: `src/ipc/handlers/*.ts` — registered in `src/ipc/ipc_host.ts`
- Handlers **throw** on error — never return `{ success: false }`

### Key Directories

| Path | Purpose |
|------|---------|
| `src/ipc/handlers/` | 70+ IPC handler files (main process) |
| `src/ipc/ipc_client.ts` | Renderer-side IPC client |
| `src/preload.ts` | Channel allowlist |
| `src/hooks/` | 100+ React hooks |
| `src/components/` | React components (Tailwind CSS) |
| `src/pages/` | Page-level components |
| `src/routes/` | TanStack Router route definitions |
| `src/db/` | Drizzle ORM schemas |
| `src/lib/` | Business logic / services |
| `src/types/` | TypeScript type definitions |
| `src/prompts/` | AI system prompts |

### Database

- Schemas defined in `src/db/schema.ts` + domain files in `src/db/`
- **NEVER write migration SQL by hand** — always run: `npm run db:generate`

### Vite Configs

| Config | Target |
|--------|--------|
| `vite.main.config.mts` | Electron main process |
| `vite.renderer.config.mts` | React renderer |
| `vite.preload.config.mts` | Preload script |
| `vite.worker.config.mts` | Web workers |

## Commands

```sh
npm start          # Start app in dev mode
npm run lint       # Lint
npm run test       # Unit tests (Vitest)
npm run e2e        # E2E tests (Playwright)
npm run db:generate # Generate Drizzle migrations
npm run package    # Build/package
npm run make       # Build installable
```

## Rules

- No `// @ts-ignore`, `as any`, or type suppressions
- No `remote` module — maintain Electron security
- New IPC channels require: handler + ipc_host registration + preload allowlist + ipc_client method
- Validate/lock by `appId` when mutating shared resources
- Keep changes minimal — fix the bug, don't refactor the neighborhood
- Reads → `useQuery`; Writes → `useMutation` with query invalidation
