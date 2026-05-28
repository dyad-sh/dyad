# CLAUDE.md — Dyad Contribution Agent Guide

## Project Overview

**Dyad** is a desktop application for building local AI apps. Electron + React + TypeScript monorepo using pnpm workspaces.

- **Repository:** https://github.com/dyad-sh/dyad
- **Primary language:** TypeScript
- **Node requirement:** `>=24 <26` (strict)
- **Package manager:** pnpm
- **Frontend:** React 19, TanStack, Base UI, Tailwind v4
- **Backend:** Electron main process, TypeScript workers
- **Database:** better-sqlite3 with Drizzle ORM
- **E2E tests:** Playwright (single-worker mode)

## Quick Commands

```bash
pnpm install         # Install dependencies
pnpm dev            # Start dev server with hot reload
pnpm build          # Production build
pnpm lint           # Lint (oxlint, not eslint)
pnpm lint:fix       # Fix lint errors
pnpm fmt            # Format code
pnpm ts             # Type-check (tsgo — stricter than tsc)
pnpm test           # Run all tests
pnpm test:e2e       # Run E2E tests (Playwright)
pnpm db:generate    # Generate Drizzle migrations
```

## Key Rules (Read Before Changes)

| Rule file | When to read |
|-----------|-------------|
| `rules/electron-ipc.md` | IPC endpoints, handlers, main/renderer communication |
| `rules/dyad-errors.md` | Error handling with `DyadError` / `DyadErrorKind` |
| `rules/local-agent-tools.md` | Local agent tools, tool flags |
| `rules/e2e-testing.md` | E2E tests, Playwright, Base UI components |
| `rules/git-workflow.md` | Branch, PR, and remote conventions |
| `rules/database-drizzle.md` | Schema changes, migrations |
| `rules/typescript-strict-mode.md` | `tsgo` vs `tsc` type differences |
| `rules/prompt-guides.md` | Prompt guide Markdown files |

## Common Issues

**Node version:** Verify `node --version` is `>=24 <26`. Use `nvm` or `n` to manage Node versions.

**pnpm not found:** On Windows, ensure pnpm is in your PATH. Install with `npm install -g pnpm`.

**Database migrations:** After schema changes, run `pnpm db:generate` and commit the migration file.

## Git / PR Conventions

- Branch naming: feature/..., fix/..., contrib/<campaign>/...
- PR title follows conventional commit format: `type(scope): description`
- Upstream: `dyad-sh/dyad` | Origin: your fork

## Testing Strategy

- **Unit tests:** Jest for atoms/hooks
- **Integration tests:** Test IPC handlers with mock Electron APIs
- **E2E tests:** Playwright, single-worker mode, 75s local timeout, 180s CI timeout
