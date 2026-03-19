<p align="center">
  <a href="https://joycreate.app">
    <img src="https://github.com/user-attachments/assets/f6c83dfc-6ffd-4d32-93dd-4b9c46d17790" alt="JoyCreate Banner" />
  </a>
</p>

<h1 align="center">JoyCreate</h1>

<p align="center">
  <strong>Free, local, open-source AI app builder</strong>
</p>

<p align="center">
  <a href="https://github.com/DisciplesofLove/JoyCreate/releases"><img src="https://img.shields.io/github/v/release/DisciplesofLove/JoyCreate?label=latest&style=flat-square" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/DisciplesofLove/JoyCreate/stargazers"><img src="https://img.shields.io/github/stars/DisciplesofLove/JoyCreate?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/DisciplesofLove/JoyCreate/issues"><img src="https://img.shields.io/github/issues/DisciplesofLove/JoyCreate?style=flat-square" alt="Issues" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <a href="https://joycreate.app/#download">Download</a> &bull;
  <a href="https://docs.joycreate.app">Docs</a> &bull;
  <a href="#-getting-started">Getting Started</a> &bull;
  <a href="#-architecture">Architecture</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a> &bull;
  <a href="SECURITY.md">Security</a>
</p>

---

JoyCreate is a desktop AI app builder that runs entirely on your machine. Build full-stack applications with natural language, fine-tune local models with your own data, orchestrate multi-model pipelines, and deploy to decentralized networks — all without sending your code to the cloud.

## Table of Contents

- [Why JoyCreate](#-why-joycreate)
- [Features](#-features)
- [Getting Started](#-getting-started)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Services & Infrastructure](#-services--infrastructure)
- [Mobile Support](#-mobile-support)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)

---

## Why JoyCreate

| Capability | JoyCreate | Typical SaaS AI Builders |
| --- | --- | --- |
| Price | **Free** | $20–50/month |
| Privacy | 100% local — nothing leaves your machine | Cloud-dependent |
| Local AI Providers | 11+ (Ollama, LM Studio, llama.cpp, vLLM, …) | 0–1 |
| Multi-Model Orchestration | Ensemble, Pipeline, Debate, Best-of-N, MoE | None |
| Smart Routing | Local-first, cloud-first, cost-optimal, auto-fallback | Basic |
| Agent Mode | Autonomous AI coding with memory & tool use | Paid / None |
| Code Generation Modes | 12 (Create, Refactor, Fix, Optimize, Secure, Test, …) | 1–2 |
| Decentralized Deploy | Celestia, IPFS, OpenClaw | None |
| Data Flywheel | Self-reinforcing fine-tuning from your interactions | None |
| Mobile Export | Android & iOS via Capacitor | None |

---

## Features

### Local AI Hub

Connect to **11+ local inference providers** for unlimited, private AI:

Ollama · LM Studio · llama.cpp · vLLM · LocalAI · GPT4All · Jan · oobabooga · koboldcpp · MLX · ExLlama

Cloud providers are also fully supported: OpenAI, Anthropic, Google, Azure, AWS Bedrock, xAI, OpenRouter, and any OpenAI-compatible endpoint.

### Smart Routing

Requests are automatically dispatched to the best model for the task:

- **Local First** — prefer on-device models for privacy
- **Cloud First** — send to powerful cloud models
- **Smart Mode** — auto-select per task
- **Cost Optimal** — minimize API spend
- **Auto Fallback** — if the preferred provider is unavailable, another picks up instantly

### Multi-Model Orchestration

Combine models for results no single model can match:

| Strategy | How it Works |
| --- | --- |
| Ensemble | Multiple models vote on each decision |
| Pipeline | One model drafts, the next refines |
| Debate | Models critique each other's output |
| Best-of-N | Generate N candidates, pick the best |
| Parallel | Merge perspectives from concurrent runs |
| Mixture of Experts | Route sub-tasks to specialist models |

### Agent System (V2)

Autonomous AI agents with formal tool-calling, persistent memory (STM/LTM with semantic search and consolidation), per-agent configuration, and swarm orchestration. Agents can read/write files, run commands, browse the web, and collaborate in multi-agent workflows via n8n.

### Code Generation — 12 Modes

Create · Refactor · Complete · Fix · Optimize · Secure · Document · Test · Review · Explain · Convert · Architect

### Data Flywheel

A self-reinforcing training loop: interactions become training pairs → training pairs build datasets → datasets fine-tune local models → models get smarter. Three capture modes per agent:

1. **Auto-capture** — every Q&A pair saved automatically
2. **Thumbs feedback** — rate responses with thumbs up/down
3. **Corrections** — provide corrected outputs that become gold training data

Scheduled training via internal scheduler or n8n cron. Multi-Armed Bandit (Thompson Sampling) ranks fine-tuned adapters against base models so the best model wins over time.

### Unlimited Context

- **Unlimited Mode** — no token limits with local models
- **Smart Compression** — fit more into cloud context windows
- **Conversation Memory** — remember important context across sessions
- **Rolling Context** — intelligent window management

### Decentralized Stack

- **Celestia** — blob submissions for data availability (mainnet)
- **IPFS / Helia** — content-addressed file storage with IPLD receipts
- **OpenClaw** — decentralized compute network for inference jobs
- **libp2p** — peer-to-peer networking and GossipSub messaging
- **Decentralized Chat** — WebRTC video/audio calls, group chats, meetings, calendar

### Marketplace & NFTs

Publish AI agents, datasets, and digital assets to [JoyMarketplace.io](https://joymarketplace.io). Mint NFTs for provenance, with on-chain receipts backed by Celestia and IPFS.

### Workflow Automation

Built-in n8n integration for visual workflow automation. Design workflows in n8n's node editor, trigger them from agents, or schedule recurring tasks.

### Data Studio & Knowledge Base

Import, transform, annotate, and version datasets. Build knowledge bases with vector search (sqlite-vec) and full-text search. Scrape the web, generate synthetic data, and track data lineage.

### More

- **Monaco Editor** — full VS Code editing experience in-app
- **Rich Text Editor** — Lexical-powered document editing
- **Visual App Builder** — drag-and-drop interface design with Konva
- **LibreOffice Export** — headless document conversion to PDF, DOCX, PPTX
- **Secrets Vault** — encrypted local credential storage
- **Tailscale VPN** — secure agent-to-agent networking
- **Model Benchmarking** — compare models head-to-head
- **Local CI/CD** — test and deploy without external services
- **Plugin System** — extend JoyCreate with community plugins
- **Voice Assistant** — speech-driven interactions

---

## Getting Started

### Prerequisites

| Requirement | Version |
| --- | --- |
| **Node.js** | >= 20 |
| **npm** or **pnpm** | latest |
| **Git** | any recent |

For local AI inference, install **[Ollama](https://ollama.com)** (recommended) or any supported provider.

### Quick Start

```bash
# Clone the repository
git clone https://github.com/DisciplesofLove/JoyCreate.git
cd JoyCreate

# Install dependencies
npm install

# Create the userData directory (required for the local database)
mkdir userData          # Windows Command Prompt
# mkdir -p userData     # macOS / Linux

# Generate and apply database migrations
npm run db:generate
npm run db:push

# Start the app
npm start
```

JoyCreate will open as a desktop window. If you have Ollama running locally, the app will detect it automatically.

### Optional Services

| Service | Purpose | How to Start |
| --- | --- | --- |
| **n8n** | Workflow automation | `docker compose -f docker-compose.n8n.yml up -d` |
| **Celestia Light Node** | Blockchain data availability | `docker compose -f docker-compose.celestia.yml up -d` or `.\start-celestia-node.ps1` |
| **OpenClaw** | Decentralized compute gateway | `npx openclaw gateway run --port 18789` |

> All services are optional. JoyCreate works fully offline with just Ollama.

---

## Architecture

JoyCreate is an **Electron** application with a strict security boundary between the renderer (sandboxed React UI) and the main process (Node.js backend).

```
┌──────────────────────────────────────────────────┐
│                  Renderer Process                │
│   React 19 · TanStack Router · TanStack Query    │
│   Tailwind CSS · Radix UI · Monaco Editor        │
│   Jotai (state) · Framer Motion (animations)     │
├──────────────────────────────────────────────────┤
│              Preload (IPC Allowlist)             │
├──────────────────────────────────────────────────┤
│                  Main Process                    │
│   IPC Handlers · SQLite (Drizzle ORM)            │
│   Vercel AI SDK · Git (Dugite)                   │
│   Agent Engine · Data Flywheel · MAB Engine      │
│   Helia (IPFS) · libp2p · Celestia Blobs         │
│   n8n API · OpenClaw Gateway · Tailscale         │
└──────────────────────────────────────────────────┘
```

**Key principles:**
- All data access goes through IPC — the renderer never touches the database or filesystem directly.
- New IPC channels must be registered in `src/preload.ts` (allowlist), handled in `src/ipc/handlers/`, and exposed via a client in `src/ipc/`.
- Reads use `useQuery`; writes use `useMutation` (TanStack Query). See [AGENTS.md](AGENTS.md) for the full IPC integration guide.
- The Electron security fuses (cookie encryption, Node.js CLI flags, `asar` integrity) are locked down via `@electron-forge/plugin-fuses`.

For a deeper dive, see:
- [Architecture Guide](docs/architecture.md) — request lifecycle and system design
- [Agent Architecture Guide](docs/agent_architecture.md) — agent V2 tool-calling internals
- [Dataset Studio Architecture](docs/JOYCREATE_DATASET_STUDIO_ARCHITECTURE.md) — data studio design

---

## Tech Stack

### Core

| Layer | Technology |
| --- | --- |
| **Desktop Shell** | Electron 38 (electron-forge, Vite) |
| **Frontend** | React 19, TanStack Router, TanStack Query, Tailwind CSS 4, Radix UI |
| **State** | Jotai (atoms), TanStack Store |
| **Editor** | Monaco Editor, Lexical |
| **Database** | SQLite (better-sqlite3) with Drizzle ORM |
| **AI SDK** | Vercel AI SDK v5 (OpenAI, Anthropic, Google, Azure, Bedrock, xAI, OpenRouter) |
| **Agent Protocol** | Model Context Protocol (MCP) |
| **Git** | Dugite, isomorphic-git |
| **Build** | Vite 5, TypeScript 5, Biome (lint), Prettier (format) |

### Decentralized

| Component | Technology |
| --- | --- |
| **P2P Networking** | libp2p (KAD-DHT, GossipSub) |
| **Content Storage** | Helia (IPFS), IPLD DAG-CBOR |
| **Data Availability** | Celestia Light Node |
| **Crypto** | ethers.js, tweetnacl |
| **Compute** | OpenClaw (decentralized inference gateway) |

### Services

| Service | Technology |
| --- | --- |
| **Workflows** | n8n (Docker, PostgreSQL backend) |
| **Auth** | Supabase OAuth |
| **Cloud DB** | Neon (serverless PostgreSQL) |
| **VPN** | Tailscale |
| **WebRTC** | simple-peer |

---

## Services & Infrastructure

### n8n (Workflow Automation)

```bash
docker compose -f docker-compose.n8n.yml up -d
```

Starts PostgreSQL 16 and n8n on `http://localhost:5678`. JoyCreate communicates with n8n via its REST API for workflow CRUD, execution, and scheduled flywheel training.

### Celestia Light Node

```bash
# Docker (recommended)
docker compose -f docker-compose.celestia.yml up -d

# Or via WSL (Windows)
.\start-celestia-node.ps1
```

Runs a Celestia mainnet light node on `http://localhost:26658`. Used for blob submissions (dataset provenance, agent logs, marketplace attestations). See [CELESTIA_NODE_SETUP.md](docs/CELESTIA_NODE_SETUP.md) for detailed setup.

### OpenClaw

```bash
npx openclaw gateway run --port 18789
```

Decentralized compute gateway for distributing inference jobs across a peer-to-peer network.

---

## Mobile Support

JoyCreate compiles to Android and iOS via Capacitor:

```bash
# Android
npm run mobile:android

# iOS
npm run mobile:ios
```

**App ID:** `com.joycreate.app` · **Web Directory:** `dist` · **Scheme:** HTTPS over `joycreate.local`

Capacitor plugins: App, Browser, Clipboard, Device, Filesystem, Keyboard, Local Notifications, Network, Push Notifications, Share, Splash Screen, Status Bar.

---

## Testing

### Unit Tests

```bash
npm test                 # run once
npm run test:watch       # watch mode
npm run test:ui          # Vitest UI
```

Uses **Vitest** with `happy-dom` for DOM emulation. Test files live alongside source code (`src/**/*.{test,spec}.{ts,tsx}`).

### End-to-End Tests

```bash
npm run pre:e2e          # build the app for E2E (only needed when app code changes)
npm run e2e              # run full Playwright suite
npm run e2e e2e-tests/some.spec.ts   # run a specific test
```

Uses **Playwright** with a fake LLM server for deterministic AI responses. Retries: 2 in CI, 0 locally.

### Linting & Formatting

```bash
npm run lint             # oxlint --fix
npm run prettier:check   # check formatting
npm run prettier         # auto-format
npm run presubmit        # both checks (run before PRs)
```

### Type Checking

```bash
npx tsc --noEmit         # full project type check
npm run ts               # check main + workers
```

---

## Project Structure

```
JoyCreate/
├── src/
│   ├── main.ts                  # Electron main process entry
│   ├── preload.ts               # IPC channel allowlist
│   ├── renderer.tsx             # React entry point
│   ├── components/              # React components
│   │   ├── ui/                  #   Radix-based design system
│   │   ├── chat/                #   Chat interface
│   │   ├── agent/               #   Agent builder UI
│   │   ├── settings/            #   Settings panels
│   │   └── ...
│   ├── pages/                   # TanStack Router pages (~40 routes)
│   ├── hooks/                   # React hooks (TanStack Query wrappers)
│   ├── ipc/
│   │   ├── handlers/            #   130+ IPC handler modules
│   │   ├── ipc_host.ts          #   Handler registration
│   │   ├── ipc_client.ts        #   Renderer-side client
│   │   └── *_client.ts          #   Per-domain IPC clients
│   ├── lib/                     # Core engines (~70 modules)
│   │   ├── data_flywheel.ts     #   Self-reinforcing training loop
│   │   ├── mab_engine.ts        #   Multi-Armed Bandit (Thompson Sampling)
│   │   ├── agent_orchestrator_engine.ts
│   │   ├── smart_router.ts      #   Model routing
│   │   ├── local_fine_tuning.ts #   Local model fine-tuning
│   │   └── ...
│   ├── db/                      # Drizzle ORM schemas
│   ├── types/                   # TypeScript type definitions (~34 files)
│   └── styles/                  # Global CSS
├── drizzle/                     # SQL migrations (auto-generated)
├── workers/                     # Web Workers (TypeScript compiler)
├── worker/                      # Injected client scripts
├── shared/                      # Code shared between processes
├── docs/                        # Architecture & setup guides
├── e2e-tests/                   # Playwright E2E tests
├── scripts/                     # Build & utility scripts
├── assets/                      # Icons, logos, branding
├── android/                     # Capacitor Android project
├── ios/                         # Capacitor iOS project
├── docker-compose.n8n.yml       # n8n + PostgreSQL
├── docker-compose.celestia.yml  # Celestia Light Node
└── forge.config.ts              # Electron Forge build config
```

---

## Key NPM Scripts

| Script | Description |
| --- | --- |
| `npm start` | Launch JoyCreate in development mode |
| `npm test` | Run unit tests (Vitest) |
| `npm run e2e` | Run E2E tests (Playwright) |
| `npm run make` | Build distributable installers |
| `npm run db:generate` | Generate SQL migrations from schema changes |
| `npm run db:push` | Apply migrations to the local database |
| `npm run db:studio` | Open Drizzle Studio (database UI) |
| `npm run lint` | Lint with oxlint |
| `npm run prettier` | Format with Prettier |
| `npm run ts` | Type-check main app + workers |
| `npm run build` | Build for Capacitor (mobile/web) |
| `npm run mobile:android` | Build and open on Android |
| `npm run mobile:ios` | Build and open on iOS |

---

## Contributing

JoyCreate is early-stage and the codebase changes rapidly. Before opening a PR:

1. **Open an issue first** to discuss your proposed change.
2. **Read the architecture guides** — [Architecture](docs/architecture.md) and [Agent Architecture](docs/agent_architecture.md).
3. **Set up pre-commit hooks** — `npm run init-precommit` (runs formatter + linter on each commit).
4. **Run `npm run presubmit`** before pushing.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full details.

---

## Security

We take security seriously. **Do not report vulnerabilities as public issues.** Instead, use [GitHub Security Advisories](https://github.com/DisciplesofLove/JoyCreate/security/advisories/new).

See [SECURITY.md](SECURITY.md) for our full security policy.

---

## License

JoyCreate is released under the [Apache License 2.0](LICENSE).

```
Copyright 2024-2026 JoyCreate Contributors
Licensed under the Apache License, Version 2.0
```

## 🏁 Quick Start with Local AI

1. **Install Ollama**: Visit [ollama.ai](https://ollama.ai) and download
2. **Pull a model**: `ollama pull llama3.2:3b` (or any model)
3. **Open JoyCreate**: It auto-detects your local models!
4. **Start building**: Create amazing apps with FREE, unlimited AI!

```bash
# Pull some great free models
ollama pull llama3.2:3b      # Fast, general purpose
ollama pull qwen2.5-coder:7b # Excellent for coding
ollama pull deepseek-coder:6.7b # Great code model
```

## 🤝 Community

Join our growing community of AI app builders!

## 🛠️ Contributing

**JoyCreate** is open-source (see License info below).

If you're interested in contributing to JoyCreate, please read our [contributing](./CONTRIBUTING.md) doc.

## 🙌 Why We Made Everything Free

We believe powerful AI tools should be accessible to everyone, not locked behind paywalls. JoyCreate proves that open-source can be better than paid alternatives.

**Share JoyCreate** and help others discover the most powerful free AI app builder! ⭐

## License

- All the code in this repo outside of `src/pro` is open-source and licensed under Apache 2.0 - see [LICENSE](./LICENSE).
- All the code in this repo within `src/pro` is fair-source and licensed under [Functional Source License 1.1 Apache 2.0](https://fsl.software/) - see [LICENSE](./src/pro/LICENSE).

---

**🎉 JoyCreate - More Powerful Than Paid Alternatives, 100% FREE!**
