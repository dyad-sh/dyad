# 01 — Repository Map: dyad-sh/dyad

## What is Dyad?

**Dyad** is a local, open-source AI app builder (like Lovable, v0, or Bolt) that runs entirely on the user's machine. It lets developers build web apps via a chat interface powered by AI, with full control over API keys, data, and infrastructure.

- **Website**: https://dyad.sh/
- **License**: Apache 2.0 (src/ outside `src/pro`) + FSL 1.1 Apache 2.0 (`src/pro`)
- **Stars**: ~20,448 | **Forks**: ~2,412 | **Open issues**: 255

## Tech Stack

| Layer             | Technology                                          |
| ----------------- | --------------------------------------------------- |
| Desktop framework | Electron 40                                         |
| UI framework      | React 19                                            |
| Language          | TypeScript                                          |
| Routing           | TanStack Router                                     |
| Data fetching     | TanStack Query                                      |
| State management  | Jotai                                               |
| Styling           | Tailwind CSS v4 + Base UI                           |
| Editor            | Lexical (rich text) + Monaco Editor                 |
| Database          | SQLite via Drizzle ORM (better-sqlite3)             |
| AI SDK            | Vercel AI SDK (`ai` package) + @ai-sdk/\* providers |
| Build             | Electron Forge + Vite                               |
| Package manager   | pnpm v11 (workspace), npm (published pkg)           |
| Node constraint   | `>=24 <26`                                          |

## Directory Structure

```
dyad/
├── src/                      # Main source code
│   ├── main.ts               # Electron main process entry
│   ├── preload.ts            # Preload script (IPC bridge)
│   ├── renderer.tsx          # React app entry
│   ├── router.ts             # TanStack Router config
│   ├── app/                  # App-level components
│   ├── atoms/                # Jotai state atoms
│   ├── components/           # Shared UI components
│   ├── contexts/             # React contexts
│   ├── data/                 # Data-fetching / API layer
│   ├── db/                   # Drizzle schema + migrations
│   ├── hooks/                # Custom React hooks
│   ├── ipc/                  # IPC handlers (main process)
│   ├── lib/                  # Utilities / helpers
│   ├── main/                 # Main-process modules
│   ├── pages/                # Page components
│   ├── pro/                  # Pro-tier code (FSL license)
│   │   └── main/ipc/handlers/local_agent/tools/  # Agent tools
│   ├── prompts/              # System prompts + prompt guides
│   │   └── guides/           # Markdown prompt guides
│   ├── routes/               # Route definitions
│   ├── store/                # State stores
│   └── utils/                # General utilities
├── workers/
│   └── tsc/                  # TypeScript worker for type-checking
├── e2e-tests/                # Playwright E2E tests (144 spec files)
│   ├── snapshots/             # ARIA snapshot fixtures
│   └── helpers/              # Test utilities + fake LLM server
├── testing/
│   └── fake-llm-server/      # Isolated LLM server for E2E
├── rules/                    # Agent rules (16 rule files)
├── docs/                     # Architecture + ADR docs
│   ├── architecture.md
│   ├── agent_architecture.md
│   ├── security.md
│   └── adrs/                 # Architecture Decision Records
├── .github/workflows/        # 20+ CI/automation workflows
├── package.json
├── playwright.config.ts
└── tsconfig.app.json
```

## Key Commands

```sh
# Install
npm install              # Use pnpm internally (workspace)

# Development
npm run dev              # Run in dev mode (NODE_ENV=development)
npm start                # electron-forge start (production-like)

# Build
npm run build            # Build for E2E testing (npm run package)
npm run package          # electron-forge package (no code signing)
npm run make             # electron-forge make ( installers)

# Linting / Formatting
npm run fmt              # Format with oxfmt
npm run lint             # Lint with oxlint
npm run lint:fix          # Auto-fix lint errors
npm run presubmit         # fmt:check + lint

# Type checking
npm run ts               # Full type check (ts:main + ts:workers)
npm run ts:main           # tsgo -p tsconfig.app.json --noEmit
npm run ts:workers        # tsc -p workers/tsc/tsconfig.json --noEmit

# Database
npm run db:generate       # Generate Drizzle migrations
npm run db:push           # Push schema to SQLite
npm run db:studio         # Drizzle Studio

# Testing
npm test                 # Vitest unit tests
npm run test:watch        # Vitest watch mode
npm run e2e                # Playwright E2E (requires build first)
npm run e2e <file>         # Run specific E2E file
npm run eval               # Evaluation harness (vitest)

# Pre-commit
npm run init-precommit    # Set up husky hooks
```

## Test Framework

- **Unit tests**: Vitest — `npm test`, `src/**/*.spec.ts`
- **E2E tests**: Playwright — `npm run e2e`, `e2e-tests/*.spec.ts`
  - 144 E2E spec files covering: chat, editing, templates, GitHub, Supabase, local agent, themes, etc.
  - ARIA snapshot-based (not screenshots)
  - Single-worker mode to avoid shared-state flakiness
  - Fake LLM server (`testing/fake-llm-server/`) for isolation
  - Sharded across multiple runners in CI (ubuntu/macos/windows matrix)
  - Snapshot path: `e2e-tests/snapshots/{testFileName}_{arg}.aria.yml`

## Contributing / Agent Rules

The project has 16 rule files in `rules/` covering:

- `electron-ipc.md` — IPC handlers, React Query hooks
- `dyad-errors.md` — DyadError/DyadErrorKind for PostHog exclusion
- `local-agent-tools.md` — Agent tools, modifiesState flags
- `e2e-testing.md` — Playwright fixtures, Base UI patterns
- `git-workflow.md` — Branch/PR workflow (fork vs upstream)
- `database-drizzle.md` — Schema/migration guidance
- `native-modules.md` — Electron native modules + Forge rebuild
- `typescript-strict-mode.md` — tsgo instead of raw tsc
- `prompt-guides.md` — Markdown guide editing
- `adding-settings.md` — Settings page toggles
- `supabase-functions.md` — Edge function deployment
- `product-principles.md` — Feature planning
- `jotai-testing.md` — Jotai atom unit testing
- `claude-github-workflows.md` — Claude Code action workflow
- `ui-styling.md` — Tailwind v4, Base UI components
- `openai-reasoning-models.md` — o1/o3/o4-mini conversation history

## CI/CD

- **Main CI**: `.github/workflows/ci.yml` — matrix (ubuntu/macos/windows) × E2E shards
- **Skips tests** when only `.claude/` or `rules/` files change
- **20+ workflows** for PR review, cla, flakiness tracking, release, stale management
