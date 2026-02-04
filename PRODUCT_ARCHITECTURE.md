# Product Architecture

This document describes how Dyad is structured as a product — its user-facing features, how they compose together, and the principles that guide design decisions. For code-level architecture, see [docs/architecture.md](./docs/architecture.md) and [docs/agent_architecture.md](./docs/agent_architecture.md).

## What Dyad is

Dyad is a local, open-source AI app builder. Users describe what they want in natural language, and Dyad generates and modifies working web applications in real-time. It runs entirely on the user's machine — no cloud backend required.

The core loop is: **prompt → AI edits code → live preview updates**.

## Design principles

These principles guide product and engineering decisions. When in doubt, refer back to these.

### 1. Local-first, always

Everything runs on the user's machine. There is no Dyad cloud service that processes code or stores projects. Users own their data, their code, and their API keys. Any feature that requires a network call (AI inference, GitHub sync, Supabase, deployment) must be opt-in and use the user's own credentials.

**Implication:** Never introduce a feature that requires a Dyad-hosted backend for core functionality. Third-party integrations are fine as long as they use the user's own accounts.

### 2. Cost-conscious by default

AI API calls cost real money, and users are paying with their own keys. Every agentic loop, retry, and background inference is a cost the user bears. Dyad should always prefer the approach that solves the problem with fewer LLM round-trips, even if a more agentic approach would be marginally better.

**Implication:** Don't add speculative or "just in case" LLM calls. Make expensive workflows (agent mode, smart context) opt-in. A single well-constructed request is preferred over a multi-step chain when the quality difference is small.

### 3. Show the work in real-time

Users should never stare at a spinner wondering what's happening. Every AI response is streamed token-by-token. File writes, tool calls, and errors are surfaced as they happen, not batched at the end.

**Implication:** Any new AI-powered feature must stream its output. If an operation takes more than a second, it needs visual feedback. The UI should reflect intermediate state, not just final results.

### 4. Git is the undo button

Every AI-generated change is committed to a local Git repository. This makes version history, rollback, and branching natural. The user can always get back to a known-good state.

**Implication:** All file mutations from AI must go through the commit pipeline. Never modify project files without creating a recoverable checkpoint. Features that interact with user code should respect the Git-based versioning model.

### 5. Progressive complexity

The default experience should be simple — type a prompt, get working code. Advanced capabilities (agent mode, smart context, manual context selection, MCP tools) are available but never required. A new user should be productive within minutes without understanding any advanced concepts.

**Implication:** Don't gate basic functionality behind configuration. Advanced features should be discoverable but not in the way. The default mode should "just work" for small-to-medium projects.

### 6. Strict process boundary

The Electron renderer (UI) has no direct access to the filesystem, database, or system resources. All privileged operations go through IPC handlers in the main process. This isn't just a code organization choice — it's a security boundary.

**Implication:** Never bypass the IPC layer. New capabilities that touch the filesystem, spawn processes, or access secrets must be implemented as IPC handlers in the main process, exposed through the preload allowlist, and called from the renderer via `IpcClient`.

### 7. Provider-agnostic AI

Dyad supports OpenAI, Anthropic, Google, Azure, xAI, Bedrock, and custom OpenAI-compatible endpoints. No single AI provider is privileged. Features should work across providers, and provider-specific capabilities should degrade gracefully rather than break.

**Implication:** Don't build features that only work with one model or provider. If a capability requires a specific model feature (e.g., tool calling, vision), handle the fallback case. Test with at least two providers.

### 8. Open core with a clear boundary

Core functionality is Apache 2.0 open source (`src/`). Pro features live under `src/pro/` and are licensed under FSL. This boundary must remain clean — core features should never import from `src/pro/`, and pro features extend core through well-defined integration points.

**Implication:** When adding a feature, decide upfront whether it's core or pro. Core must never depend on pro code. Pro features should enhance, not replace, core functionality.

## Product structure

### The app model

The central concept in Dyad is an **app** — a self-contained web project that lives in its own directory with its own Git repository. Each app has:

- A local filesystem path (`~/Documents/dyad-apps/<name>`)
- A SQLite record tracking metadata, integrations, and settings
- A set of chats (conversations with the AI about this app)
- A set of versions (Git commits representing meaningful checkpoints)
- Optional integrations (GitHub, Supabase, Neon, Vercel)

Apps are created from templates (React/Vite by default, Next.js, or custom GitHub repos) or imported from existing projects.

### Chat modes

There are two ways users interact with the AI:

**Build mode (classic)** — The AI receives the full codebase (or a filtered subset) and responds in a single pass using XML-like `<dyad-*>` tags that map to file operations. This is simple, fast, and cost-efficient. It works well for small-to-medium apps.

**Agent mode** — The AI uses formal tool calling in a loop: reading files, searching code, writing edits, running type checks, and executing SQL. The loop continues until the AI decides it's done or hits a step limit. This is more capable but more expensive. It requires explicit user consent for potentially destructive operations.

Both modes produce the same end result: file changes committed to Git and reflected in the live preview.

### Context strategy

Getting the right code context to the AI is critical. Dyad supports several strategies, ordered from simplest to most sophisticated:

1. **Full codebase** (default) — Send everything. Simple and effective for small projects.
2. **Manual context** — User explicitly selects files or components to include.
3. **Smart context** (pro) — A smaller model pre-filters the codebase to find relevant files.
4. **Agent navigation** (agent mode) — The AI searches and reads files on demand via tool calls.

### Live preview

Each running app gets a local dev server (typically Vite) on a dedicated port. The preview panel embeds this in a sandboxed iframe with hot module reloading. Users see changes reflected in real-time as the AI writes code.

The preview panel also includes a file tree, a Monaco code editor for manual edits, and a console for runtime logs and errors.

### Integrations

Dyad connects to external services through OAuth flows. Each integration adds specific capabilities:

- **GitHub** — Push/pull code, create repos, manage branches and collaborators.
- **Supabase** — Managed Postgres database, edge functions, schema introspection for AI context.
- **Neon** — Serverless Postgres with branch-based development and point-in-time restore.
- **Vercel** — One-click deployment with preview and production URLs.
- **MCP servers** — Extend the AI's tool set with external capabilities via the Model Context Protocol.

### Settings and secrets

User settings (model preferences, feature flags, UI state) are stored in a JSON file in the Electron `userData` directory. Sensitive values (API keys, OAuth tokens) are encrypted using Electron's `safeStorage` API.

Per-app settings (custom commands, context paths, theme, integrations) are stored in the SQLite database.

## Feature development checklist

When adding a new feature, consider:

1. **Does it respect the IPC boundary?** Filesystem, process, and secret access must stay in the main process.
2. **Is it cost-conscious?** If it involves LLM calls, is it opt-in? Can the same result be achieved with fewer round-trips?
3. **Does it stream?** If the user waits for it, they should see incremental progress.
4. **Does it create Git checkpoints?** If it modifies user code, changes must be committable and reversible.
5. **Does it work across AI providers?** Test with at least two. Handle missing capabilities gracefully.
6. **Is the complexity justified?** Start with the simplest approach. Add sophistication only when the simple approach measurably falls short.
7. **Core or pro?** Make the decision early. Ensure the dependency direction is correct.
