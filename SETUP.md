# Dyad Development Setup Guide

This comprehensive guide will help you set up your Dyad development environment from scratch.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Automated Setup)](#quick-start-automated-setup)
- [Manual Setup](#manual-setup)
- [Environment Configuration](#environment-configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Platform-Specific Notes](#platform-specific-notes)

## Prerequisites

Before you begin, ensure you have the following installed:

### Required

- **Node.js 20.x or higher** - [Download](https://nodejs.org/)
- **npm 10.x or higher** (comes with Node.js)
- **Git** - [Download](https://git-scm.com/)

### Optional (but recommended)

- **pnpm** - Required for E2E tests
  ```bash
  npm install -g pnpm
  ```
- **Visual Studio Code** - Recommended IDE with the following extensions:
  - ESLint
  - Prettier
  - TypeScript and JavaScript Language Features

### Platform-Specific Requirements

#### macOS
- **Xcode Command Line Tools**
  ```bash
  xcode-select --install
  ```

#### Windows
- **Python 3.x** - Required for node-gyp
- **Visual Studio Build Tools** - Required for native modules
  - Install via [Visual Studio](https://visualstudio.microsoft.com/downloads/)
  - Or via `npm install --global windows-build-tools`

#### Linux
- **build-essential** package (Debian/Ubuntu)
  ```bash
  sudo apt-get install build-essential
  ```
- **Development libraries**
  ```bash
  sudo apt-get install libgtk-3-dev libnotify-dev libgconf-2-4 libnss3 libxss1 libasound2
  ```

## Quick Start (Automated Setup)

We provide automated bootstrap scripts that will set up everything you need.

### Unix/macOS/Linux

```bash
# Clone the repository
git clone https://github.com/dyad-sh/dyad.git
cd dyad

# Run the bootstrap script
./scripts/bootstrap.sh
```

### Windows (PowerShell)

```powershell
# Clone the repository
git clone https://github.com/dyad-sh/dyad.git
cd dyad

# Run the bootstrap script
.\scripts\bootstrap.ps1
```

### Bootstrap Script Options

Both bootstrap scripts support the following options:

- `--skip-deps` - Skip dependency installation
- `--skip-db` - Skip database setup
- `--skip-hooks` - Skip git hooks setup

Example:
```bash
./scripts/bootstrap.sh --skip-deps --skip-db
```

## Manual Setup

If you prefer to set up manually or need more control:

### 1. Clone the Repository

```bash
git clone https://github.com/dyad-sh/dyad.git
cd dyad
```

### 2. Install Dependencies

```bash
npm ci
```

This will install all required dependencies. The `ci` command ensures a clean install based on the lock file.

### 3. Create Required Directories

```bash
# Unix/macOS/Linux
mkdir -p userData drizzle

# Windows PowerShell
New-Item -ItemType Directory -Force -Path userData
New-Item -ItemType Directory -Force -Path drizzle
```

### 4. Set Up Environment Variables

Copy the example environment file:

```bash
# Unix/macOS/Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Edit `.env` and configure your settings (see [Environment Configuration](#environment-configuration)).

### 5. Initialize Database

Generate and apply database migrations:

```bash
npm run db:generate
npm run db:push
```

This creates the SQLite database at `userData/sqlite.db`.

### 6. Set Up Git Hooks (Recommended)

```bash
npm run init-precommit
```

This configures Husky to run linting and formatting before each commit.

### 7. Verify Setup

Run the validation script:

```bash
node scripts/validate-environment.js
```

Or run the health check:

```bash
node scripts/health-check.js
```

## Environment Configuration

The `.env` file contains configuration for various features. Here's what each section does:

### AI Provider API Keys (Optional)

These are optional for basic development but required for full functionality:

```bash
# OpenAI (GPT models)
OPENAI_API_KEY=sk-...

# Anthropic (Claude models)
ANTHROPIC_API_KEY=sk-ant-...

# Google (Gemini models)
GOOGLE_API_KEY=...
```

### Local AI Models (Optional)

If you're using Ollama or LM Studio:

```bash
# Default for Ollama is http://127.0.0.1:11434
OLLAMA_HOST=http://127.0.0.1:11434
```

### GitHub Integration (Optional)

Required for GitHub-related features:

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_TOKEN=ghp_...
```

**Note:** For development, you can create a GitHub OAuth App at:
https://github.com/settings/developers

### macOS Build (Optional)

Only needed when building signed releases for macOS:

```bash
APPLE_ID=your.email@example.com
APPLE_PASSWORD=app-specific-password
APPLE_TEAM_ID=XXXXXXXXXX
```

### Development Variables (Advanced)

```bash
NODE_ENV=development
DYAD_ENGINE_URL=http://localhost:8080/v1
```

## Verification

### 1. Run the Development Server

```bash
npm start
```

The Dyad application should launch. You can create a test app and verify functionality.

### 2. Run Tests

#### Unit Tests
```bash
npm test
```

#### E2E Tests
First, build the app:
```bash
npm run pre:e2e
```

Then run the tests:
```bash
npm run e2e
```

Run a specific test:
```bash
npm run e2e e2e-tests/new_chat.spec.ts
```

### 3. Run Code Quality Checks

```bash
# TypeScript type checking
npm run ts

# Linting
npm run lint

# Format checking
npm run prettier:check

# Or run all presubmit checks
npm run presubmit
```

### 4. Use the Health Check Script

For a comprehensive check of your environment:

```bash
# Full health check
node scripts/health-check.js

# Quick check (skips tests)
node scripts/health-check.js --quick

# Specific checks
node scripts/health-check.js --ts --lint
```

## Troubleshooting

### Common Issues

#### `npm ci` fails with permission errors

**macOS/Linux:**
```bash
sudo chown -R $(whoami) ~/.npm
```

**Windows:** Run PowerShell as Administrator.

#### Database migration errors

Reset the database:
```bash
rm -f userData/sqlite.db
npm run db:generate
npm run db:push
```

#### TypeScript compilation errors after updating dependencies

Clear the TypeScript cache:
```bash
rm -rf node_modules/.cache
npm run ts
```

#### Electron fails to start

Check Node.js version:
```bash
node --version  # Should be 20.x or higher
```

Rebuild native modules:
```bash
npm rebuild
```

#### E2E tests fail with browser errors

Install Playwright browsers:
```bash
npx playwright install chromium --with-deps
```

#### Port already in use

Kill processes using the port:
```bash
# Find the process
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill it
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### Getting Help

If you encounter issues not covered here:

1. Check existing [GitHub Issues](https://github.com/dyad-sh/dyad/issues)
2. Review the [Architecture Guide](./docs/architecture.md)
3. Ask on [r/dyadbuilders](https://www.reddit.com/r/dyadbuilders/)
4. Create a new issue with:
   - Your OS and version
   - Node.js version (`node --version`)
   - Output of `node scripts/validate-environment.js`
   - Error messages and stack traces

## Platform-Specific Notes

### macOS

#### Code Signing
For local development, you don't need code signing. However, if you want to distribute builds, you'll need an Apple Developer account.

#### Notarization
Notarization is only required for distribution. Set the required environment variables in `.env`.

### Windows

#### Long Path Support
Enable long path support in Windows 10/11:
```powershell
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1
```

#### Antivirus
Some antivirus software may interfere with npm installations. Consider adding exclusions for:
- `node_modules/`
- `%APPDATA%\npm`

### Linux

#### Experimental Support
Linux support is experimental. Some features may not work as expected.

#### Display Server
Electron works best with X11. If using Wayland, you may need:
```bash
export ELECTRON_OZONE_PLATFORM_HINT=wayland
```

## Next Steps

Once your environment is set up:

1. **Read the [Contributing Guide](./CONTRIBUTING.md)** to understand the development workflow
2. **Review the [Architecture Guide](./docs/architecture.md)** to understand how Dyad works
3. **Explore the codebase** - Start with `src/main.ts` and `src/renderer.tsx`
4. **Make your first change** - Fix a bug or add a small feature
5. **Run tests** - Ensure your changes don't break existing functionality
6. **Submit a PR** - Share your improvements with the community

## Useful Commands Reference

| Command | Description |
|---------|-------------|
| `npm start` | Start development server |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:ui` | Open Vitest UI |
| `npm run lint` | Run linter (auto-fix) |
| `npm run prettier` | Format all files |
| `npm run presubmit` | Run all pre-commit checks |
| `npm run ts` | Type-check TypeScript |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npm run db:generate` | Generate database migrations |
| `npm run db:push` | Apply database migrations |
| `npm run pre:e2e` | Build app for E2E tests |
| `npm run e2e` | Run E2E tests |
| `npm run package` | Package the app |
| `npm run make` | Create distributable |
| `node scripts/health-check.js` | Run health checks |
| `node scripts/validate-environment.js` | Validate environment |

## VS Code Configuration

Create `.vscode/settings.json` for optimal development experience:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "files.exclude": {
    "**/.git": true,
    "**/.DS_Store": true,
    "**/node_modules": true,
    "out": true,
    ".vite": true
  }
}
```

Create `.vscode/extensions.json` for recommended extensions:

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-playwright.playwright",
    "bradlc.vscode-tailwindcss"
  ]
}
```

## Additional Resources

- [Dyad Website](https://dyad.sh/)
- [GitHub Repository](https://github.com/dyad-sh/dyad)
- [Reddit Community](https://www.reddit.com/r/dyadbuilders/)
- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
