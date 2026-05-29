# 02 — Setup and Baseline: dyad-sh/dyad

## Prerequisites

### Node.js Version (CRITICAL)

```
engines.node: ">=24 <26"
```

Dyad requires **Node 24.x** specifically. The repo will not install cleanly on Node 18 or 22. Current container environment had Node 22 and needed an upgrade to Node 24 via `n`.

**Check your version:**

```sh
node --version  # Must be >= 24.0.0 and < 26.0.0
```

If using `n` (node version manager):

```sh
n 24
```

### pnpm

The project uses **pnpm v11+** as a workspace manager for dev dependencies. npm is used only for the published package.

```sh
npm install -g pnpm@11
```

### OS-Level Requirements

- **Unix/Linux**: Standard build tools, `make`, `gcc`
- **macOS**: Xcode Command Line Tools
- **Windows**: Visual Studio Build Tools (for native modules like `node-pty`, `better-sqlite3`)
- Git must be available on `PATH` (uses `isomorphic-git` and `dugite`)

## Installation Steps

### 1. Clone the repository

```sh
# Fork (if contributing):
git clone https://github.com/<your-fork>/dyad.git
cd dyad

# Or if already cloned:
cd /root/hard-pr-1/repos/dyad
```

### 2. Add upstream remote (for PRs)

```sh
git remote add upstream https://github.com/dyad-sh/dyad.git
git fetch upstream
```

### 3. Install dependencies

```sh
npm install
```

> ⚠️ **Note**: `npm install` may update `package-lock.json` with peer dependency flag removals. Commit these changes before rebasing or doing git operations to avoid "unstaged changes" errors.

### 4. Create userData directory (required for database)

```sh
# Unix/macOS/Linux:
mkdir -p userData

# Windows PowerShell:
mkdir userData
```

The SQLite database is stored at `userData/sqlite.db` (gitignored).

### 5. Initialize pre-commit hooks (recommended)

```sh
npm run init-precommit
```

This sets up husky to run `npm run presubmit` (fmt:check + lint) before each commit.

## Running the App

### Development mode

```sh
npm run dev
```

This sets `NODE_ENV=development` and runs `electron-forge start`.

### With custom engine URL

```sh
npm run dev:engine   # Uses http://localhost:8080/v1
```

### Production-like mode

```sh
npm start            # electron-forge start (no NODE_ENV=development)
```

## Database Setup

Dyad uses SQLite via Drizzle ORM + better-sqlite3. After changing the schema (`src/db/schema.ts`):

```sh
npm run db:generate   # Generate migration files
npm run db:push        # Push schema changes to userData/sqlite.db
```

To reset the database (discard migrations):

```sh
rm userData/sqlite.db
```

## Type Checking

> ⚠️ **Do NOT run `npx tsc` or `tsc` directly.** Use the wrappers below.

```sh
npm run ts            # Full type check (main + workers)
npm run ts:main       # tsgo -p tsconfig.app.json --noEmit
npm run ts:workers    # tsc -p workers/tsc/tsconfig.json --noEmit
```

## Linting and Formatting

```sh
npm run fmt           # Format with oxfmt
npm run lint          # Lint with oxlint
npm run lint:fix      # Auto-fix
npm run presubmit     # fmt:check + lint
```

> ⚠️ **Do NOT run `npx eslint`** — oxlint is used instead and `npx eslint` produces false positives for `@/` path aliases.

## Baseline Status

| Check                   | Status                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Node version (v24.16.0) | ✅ OK                                                             |
| npm install             | ✅ Completed (1587 packages, 72 vulnerabilities)                  |
| userData dir            | ✅ Created                                                        |
| pnpm version            | ✅ 11.2.2                                                         |
| Pre-commit hooks        | ⚠️ Not initialized (optional)                                     |
| Unit tests              | ⚠️ Skipped — Electron binary not pre-installed in container       |
| E2E tests               | ⚠️ Skipped — requires `npm run build` (full Electron Forge chain) |
| Build artifacts         | ⚠️ Not built                                                      |

## Known Setup Issues

1. **Node < 24**: `npm install` may succeed but `npm start` will fail with obscure errors. Always use Node 24–25.
2. **Electron binary missing**: The container doesn't have Electron pre-cached. Unit tests (`npm test`) and E2E tests fail unless Electron is downloaded. Use `--ignore-engines` doesn't fully work around this.
3. **Native modules**: `node-pty`, `better-sqlite3`, `dugite` require platform-specific native compilation. Windows users need Visual Studio Build Tools.
4. **Git worktrees**: Each worktree needs its own `npm install`.
