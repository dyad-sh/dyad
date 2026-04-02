<p align="center">
  <a href="https://joycreate.app">
    <img src="https://github.com/user-attachments/assets/f6c83dfc-6ffd-4d32-93dd-4b9c46d17790" alt="JoyCreate Banner" />
  </a>
</p>

<h1 align="center">JoyCreate</h1>

<p align="center">
  <strong>The free, local-first, open-source AI super-app</strong><br/>
  Build apps &bull; Generate images & video &bull; Manage email with AI &bull; Orchestrate agent swarms &bull; Deploy to decentralized networks — all from your desktop, 100% private.
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
  <a href="#-features">Features</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a> &bull;
  <a href="SECURITY.md">Security</a>
</p>

---

JoyCreate is an Electron desktop super-app that combines AI app building, image/video generation, autonomous agents, an AI-powered email client, and decentralized deployment into a single local-first platform. Connect to 12+ AI providers (local and cloud), orchestrate multi-model pipelines, and keep everything private — nothing leaves your machine unless you choose.

> **v0.32.0-beta.1** &mdash; 142 IPC handlers &bull; 105 hooks &bull; 70+ pages &bull; 38 type definitions &bull; 12+ AI providers

## Table of Contents

- [Why JoyCreate](#-why-joycreate)
- [Features](#-features)
  - [AI Hub & Smart Routing](#ai-hub--smart-routing)
  - [Multi-Model Orchestration](#multi-model-orchestration)
  - [Image Studio](#image-studio)
  - [Video Studio](#video-studio)
  - [AI Email Client](#ai-email-client)
  - [Agent System](#agent-system)
  - [Code Generation](#code-generation--12-modes)
  - [Data Studio & Knowledge Base](#data-studio--knowledge-base)
  - [Decentralized Stack](#decentralized-stack)
  - [More](#more)
- [Getting Started](#-getting-started)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Services & Infrastructure](#-services--infrastructure)
- [Mobile Support](#-mobile-support)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Key NPM Scripts](#-key-npm-scripts)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)

---

## Why JoyCreate

| Capability | JoyCreate | Typical SaaS AI Builders |
| --- | --- | --- |
| **Price** | **Free** | $20–50/month |
| **Privacy** | 100% local — nothing leaves your machine | Cloud-dependent |
| **Local AI Providers** | 12+ (Ollama, LM Studio, llama.cpp, vLLM, OpenClaw …) | 0–1 |
| **Cloud AI Providers** | 9 (OpenAI, Anthropic, Google, Azure, Bedrock, xAI, OpenRouter …) | 1–3 |
| **Image Generation** | 7 providers (DALL-E 3, Imagen 3, Stable Diffusion 3, Flux, Runway …) | 1 or none |
| **Video Generation** | 7 providers (Runway Gen-3, Kling, Luma, Veo, OpenAI Sora …) | None |
| **AI Email** | Full client with auto-triage, smart replies, daily digest, autonomous rules | None |
| **Multi-Model Orchestration** | Ensemble, Pipeline, Debate, Best-of-N, MoE | None |
| **Smart Routing** | Local-first, cloud-first, cost-optimal, auto-fallback | Basic |
| **Agent Mode** | Autonomous agents with memory, tool use, swarms | Paid / None |
| **Code Generation Modes** | 12 (Create, Refactor, Fix, Optimize, Secure, Test, …) | 1–2 |
| **Decentralized Deploy** | Celestia, IPFS, OpenClaw, Self-Sovereign Identity | None |
| **Data Flywheel** | Self-reinforcing fine-tuning from your interactions | None |
| **Web Scraping** | Visual builder, anti-bot, auth, proxy, scheduling | None |
| **Mobile Export** | Android & iOS via Capacitor | None |

---

## Features

### AI Hub & Smart Routing

Connect to **12+ local and cloud inference providers** for unlimited, private AI:

**Local (free, unlimited):**
Ollama &bull; LM Studio &bull; llama.cpp &bull; vLLM &bull; LocalAI &bull; GPT4All &bull; Jan &bull; oobabooga &bull; koboldcpp &bull; MLX &bull; ExLlama &bull; OpenClaw Gateway

**Cloud:**
OpenAI (GPT-5.2, o4-mini) &bull; Anthropic (Claude Opus 4, Sonnet 4) &bull; Google (Gemini 2.5) &bull; Google Vertex AI &bull; Azure OpenAI &bull; AWS Bedrock &bull; xAI (Grok) &bull; OpenRouter (1000+ models) &bull; Any OpenAI-compatible endpoint

**Smart Routing** automatically dispatches requests to the best model for each task:

| Mode | Behavior |
| --- | --- |
| **Local First** | Prefer on-device models for privacy |
| **Cloud First** | Route to powerful cloud models |
| **Smart Mode** | Auto-select per task |
| **Cost Optimal** | Minimize API spend |
| **Auto Fallback** | Seamless failover between providers |

### Multi-Model Orchestration

Combine models for results no single model can match:

| Strategy | How it Works |
| --- | --- |
| **Ensemble** | Multiple models vote on each decision |
| **Pipeline** | One model drafts, the next refines |
| **Debate** | Models critique each other's output |
| **Best-of-N** | Generate N candidates, pick the best |
| **Parallel** | Merge perspectives from concurrent runs |
| **Mixture of Experts** | Route sub-tasks to specialist models |

### Image Studio

Generate, edit, and upscale images with **7 providers**:

| Provider | Models |
| --- | --- |
| **OpenAI** | DALL-E 3, gpt-image-1 |
| **Google** | Imagen 3 |
| **Stability AI** | Stable Diffusion 3, SD Ultra, SD Core |
| **Replicate** | Flux-Schnell |
| **Fal** | Flux/Dev |
| **Runway** | Gen-3 |
| **ComfyUI** | Any local Stable Diffusion workflow |

Features: text-to-image, inpainting/editing, upscaling, batch generation, negative prompts, style control, seed, steps, CFG scale, sampler selection. Also supports **fully local generation** via Stable Diffusion Turbo, LCM, FLUX, and SDXL — no API keys needed.

### Video Studio

Create videos from text or images with **7 providers**:

| Provider | Models |
| --- | --- |
| **Runway** | Gen-3a Turbo |
| **Fal** | Kling Video v2 |
| **Replicate** | Various video models |
| **Luma AI** | Dream Machine |
| **Stability AI** | Stable Video Diffusion |
| **Google** | Veo |
| **OpenAI** | Sora |

Features: text-to-video, image-to-video, frame extraction, duration control, FPS selection, motion amount. Local generation via Stable Video Diffusion.

### AI Email Client

A full-featured, AI-powered email client built into JoyCreate:

**3 providers:** IMAP/SMTP (any mail server) &bull; Gmail (OAuth2) &bull; Microsoft Outlook/365 (Graph API)

**7 AI features with smart model routing** — light tasks (triage, smart replies) use fast/local models, heavy tasks (compose, digest) use capable API models:

| Feature | Description |
| --- | --- |
| **Auto-Triage** | Categorize incoming mail by priority and type (urgent, action required, FYI, newsletter, promotional, etc.) |
| **Smart Replies** | Generate 3 contextual reply suggestions per message |
| **AI Compose** | Write emails from natural language instructions |
| **Summarize** | Summarize messages or entire threads with key points and action items |
| **Tone Adjustment** | Rewrite drafts in formal, casual, friendly, or urgent tone |
| **Follow-Up Detection** | Detect commitments, deadlines, and action items |
| **Daily Digest** | AI-generated summary of unread emails with top action items |

**Autonomous Orchestrator:** Background service that auto-triages new messages on sync, applies user-defined rules (auto-archive newsletters, auto-label by category, mark read, star), and generates scheduled daily digests. Respects configurable trust levels (auto/confirm/never) for all destructive actions.

**Self-signed certificate support:** Auto-detects and handles self-signed TLS certificates for enterprise/self-hosted mail servers.

### Agent System

Autonomous AI agents with formal tool-calling, persistent memory, and swarm orchestration:

| Capability | Description |
| --- | --- |
| **Autonomous Agents** | Scrape web, download models, generate/execute code, create UI, voice interactions, self-replicate, learn from feedback |
| **Coding Agent** | Autonomous coding assistant: file editing, command execution, debugging, refactoring, testing, code review |
| **Agent Swarms** | Self-replicating agent orchestration with parent-child delegation, witness system, knowledge sharing, resource management |
| **Memory System** | STM/LTM with semantic search and consolidation; persistent across sessions |
| **Multi-Agent Orchestration** | Coordinate multiple agents on complex tasks |
| **Agent Blueprints** | Generate and share agent configurations |
| **Trust Levels** | Configurable autonomy: auto, confirm, never — per-action granularity |
| **n8n Integration** | Visual workflow automation for agent pipelines |

### Code Generation — 12 Modes

Create &bull; Refactor &bull; Complete &bull; Fix &bull; Optimize &bull; Secure &bull; Document &bull; Test &bull; Review &bull; Explain &bull; Convert &bull; Architect

### Data Studio & Knowledge Base

| Feature | Description |
| --- | --- |
| **Dataset Studio** | Import, transform, annotate, and version datasets with full lineage tracking |
| **Knowledge Base** | Vector search (sqlite-vec) and full-text search over your documents |
| **Embedding Pipeline** | Chunk → embed (Ollama: nomic-embed-text, all-minilm) → store → retrieve for RAG |
| **Web Scraping Engine** | Visual builder, anti-bot bypass, authenticated scraping, proxy rotation, pagination, scheduling, monitoring |
| **Synthetic Data** | Generate training data with AI |
| **Data Flywheel** | Self-reinforcing training loop: interactions → training pairs → datasets → fine-tune → better models |
| **Multi-Armed Bandit** | Thompson Sampling ranks fine-tuned adapters against base models; best model wins |
| **Data Sovereignty** | User-controlled data ownership and access policies |

### Decentralized Stack

| Component | Technology | Purpose |
| --- | --- | --- |
| **Celestia** | Light Node (mainnet) | Data availability — blob submissions for provenance, logs, attestations |
| **IPFS** | Helia + IPLD DAG-CBOR | Content-addressed file storage with verifiable receipts |
| **OpenClaw** | Gateway + Registry + CNS | Decentralized compute, model registry, content naming |
| **libp2p** | KAD-DHT + GossipSub | P2P networking and messaging |
| **SSI** | DID + Verifiable Credentials | Self-sovereign identity with Celestia anchoring |
| **Smart Contracts** | ethers.js | Contract deployment and interaction |
| **Crypto Payments** | Payment gateway | Token-based transactions |
| **Decentralized Chat** | WebRTC (simple-peer) | Video/audio calls, group chats, meetings, calendar |
| **Trustless Inference** | P2P protocol | Verifiable AI inference across the network |

### Marketplace & NFTs

Publish AI agents, datasets, and digital assets to [JoyMarketplace.io](https://joymarketplace.io). Mint NFTs for provenance with on-chain receipts backed by Celestia and IPFS.

### More

| Feature | Description |
| --- | --- |
| **Monaco Editor** | Full VS Code editing experience in-app |
| **Rich Text Editor** | Lexical-powered document editing |
| **Visual App Builder** | Drag-and-drop interface design with Konva |
| **LibreOffice Export** | Headless document conversion to PDF, DOCX, PPTX |
| **Secrets Vault** | Encrypted local credential storage (8 files dedicated) |
| **Voice Assistant** | Push-to-talk, continuous listening, wake-word modes; speech-to-text + text-to-speech via Piper/Whisper |
| **Tailscale VPN** | Secure agent-to-agent networking |
| **Model Benchmarking** | Compare models head-to-head |
| **Local CI/CD** | Test and deploy without external services |
| **Plugin System** | Extend JoyCreate with community plugins |
| **MCP Hub** | Model Context Protocol integration |
| **Offline Docs** | Full documentation available offline |
| **Design System** | Built-in design system page for UI consistency |

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

# Generate database migrations
npm run db:generate

# Start the app
npm start
```

JoyCreate will open as a desktop window. If you have Ollama running locally, the app will detect it automatically.

### Quick Start with Local AI

```bash
# 1. Install Ollama — visit https://ollama.ai and download
# 2. Pull some great free models:
ollama pull llama3.2:3b        # Fast, general purpose
ollama pull qwen2.5-coder:7b   # Excellent for coding
ollama pull nomic-embed-text    # Embeddings for RAG / knowledge base

# 3. Open JoyCreate — it auto-detects your local models!
```

### Optional Services

| Service | Purpose | How to Start |
| --- | --- | --- |
| **n8n** | Workflow automation | `docker compose -f docker-compose.n8n.yml up -d` |
| **Celestia Light Node** | Blockchain data availability | `docker compose -f docker-compose.celestia.yml up -d` or `.\start-celestia-node.ps1` |
| **OpenClaw** | Decentralized compute gateway | `npx openclaw gateway run --port 18789` |

> All services are optional. JoyCreate works fully offline with just Ollama.

---

## Architecture

JoyCreate is an **Electron** application with a strict security boundary between the renderer (sandboxed React UI) and the main process (Node.js backend). All data access goes through **142 IPC handler modules** with a preload allowlist.

```
┌──────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│   React 19 · TanStack Router · TanStack Query · Jotai   │
│   Tailwind CSS 4 · Radix UI · Monaco · Lexical · Konva  │
│   105 hooks · 70+ pages · 38 type definitions            │
├──────────────────────────────────────────────────────────┤
│                 Preload (IPC Allowlist)                   │
│           All channels explicitly whitelisted            │
├──────────────────────────────────────────────────────────┤
│                    Main Process                          │
│   142 IPC Handlers · SQLite (Drizzle ORM, 35+ tables)   │
│   Vercel AI SDK v5 · 12+ AI Providers                   │
│   Agent Engine · Agent Swarms · Memory System            │
│   Image Studio (7 providers) · Video Studio (7 providers)│
│   Email Client (3 providers + AI + Orchestrator)         │
│   Data Flywheel · MAB Engine · Embedding Pipeline        │
│   Scraping Engine v3 · Vector Store (sqlite-vec)         │
│   Helia (IPFS) · libp2p · Celestia Blobs · OpenClaw     │
│   n8n API · Tailscale · Voice Assistant                  │
│   Git (Dugite) · Smart Router · Crypto Payments          │
└──────────────────────────────────────────────────────────┘
```

**Key principles:**
- All data access goes through IPC — the renderer never touches the database or filesystem directly.
- New IPC channels must be registered in `src/preload.ts` (allowlist), handled in `src/ipc/handlers/`, and exposed via a client in `src/ipc/`.
- Reads use `useQuery`; writes use `useMutation` (TanStack Query). See [AGENTS.md](AGENTS.md) for the full IPC integration guide.
- Handlers **throw** on error — never return `{ success: false }` payloads.
- Electron security fuses (cookie encryption, Node.js CLI flags, `asar` integrity) are locked down via `@electron-forge/plugin-fuses`.

**Architecture guides:**
- [Architecture Guide](docs/architecture.md) — request lifecycle and system design
- [Agent Architecture Guide](docs/agent_architecture.md) — agent V2 tool-calling internals
- [Dataset Studio Architecture](docs/JOYCREATE_DATASET_STUDIO_ARCHITECTURE.md) — data studio design
- [Celestia Node Setup](docs/CELESTIA_NODE_SETUP.md) — light node configuration

---

## Tech Stack

### Core

| Layer | Technology |
| --- | --- |
| **Desktop Shell** | Electron 38 (Electron Forge, Vite) |
| **Frontend** | React 19, TanStack Router, TanStack Query, Tailwind CSS 4, Radix UI |
| **State** | Jotai (atoms), TanStack Store |
| **Editors** | Monaco Editor (code), Lexical (rich text), Konva (visual builder) |
| **Database** | SQLite (better-sqlite3, 35+ tables) with Drizzle ORM |
| **Vector Store** | sqlite-vec for local embeddings and semantic search |
| **AI SDK** | Vercel AI SDK v5 (OpenAI, Anthropic, Google, Azure, Bedrock, xAI, OpenRouter) |
| **Agent Protocol** | Model Context Protocol (MCP) |
| **Git** | Dugite, isomorphic-git |
| **Build** | Vite 5 (4 configs: main, renderer, preload, worker), TypeScript 5 |
| **Lint/Format** | oxlint (lint), Prettier (format), Biome |
| **Test** | Vitest (unit, happy-dom), Playwright (E2E) |

### AI & Creative

| Component | Technology |
| --- | --- |
| **Image Generation** | DALL-E 3, Imagen 3, Stable Diffusion 3, Flux, Runway, ComfyUI, local SD |
| **Video Generation** | Runway Gen-3a, Kling, Luma Dream Machine, Veo, Sora, local SVD |
| **Email AI** | Smart routing (local/cloud per task), 7 AI functions, autonomous orchestrator |
| **Voice** | Piper (TTS), Whisper (STT), push-to-talk / wake-word modes |
| **Embeddings** | Ollama (nomic-embed-text, all-minilm), sqlite-vec backend |
| **Fine-Tuning** | Local LoRA/QLoRA via Ollama, Thompson Sampling model selection |

### Decentralized

| Component | Technology |
| --- | --- |
| **P2P Networking** | libp2p (KAD-DHT, GossipSub) |
| **Content Storage** | Helia (IPFS), IPLD DAG-CBOR |
| **Data Availability** | Celestia Light Node (mainnet) |
| **Identity** | DID, Verifiable Credentials, Celestia-anchored SSI |
| **Crypto** | ethers.js, tweetnacl |
| **Compute** | OpenClaw (decentralized inference gateway + CNS + registry) |
| **Communication** | WebRTC (simple-peer) for video/audio/chat |

### Services

| Service | Technology |
| --- | --- |
| **Workflows** | n8n (Docker, PostgreSQL backend) |
| **Auth** | Supabase OAuth |
| **Cloud DB** | Neon (serverless PostgreSQL) |
| **VPN** | Tailscale |
| **Email** | ImapFlow, nodemailer, Gmail API, Microsoft Graph |

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

Decentralized compute gateway for distributing inference jobs across a peer-to-peer network. Includes a content naming system (CNS) and model registry.

---

## Mobile Support

JoyCreate compiles to Android and iOS via Capacitor:

```bash
# Android
npm run mobile:android

# iOS
npm run mobile:ios
```

**App ID:** `com.joycreate.app` &bull; **Web Directory:** `dist` &bull; **Scheme:** HTTPS over `joycreate.local`

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
npm run ts               # check main app + workers
npm run ts:main          # check main app only
npm run ts:workers       # check workers only
```

---

## Project Structure

```
JoyCreate/
├── src/
│   ├── main.ts                  # Electron main process entry
│   ├── preload.ts               # IPC channel allowlist
│   ├── renderer.tsx             # React entry point
│   ├── components/              # React components (Radix + Tailwind)
│   │   ├── ui/                  #   Design system primitives
│   │   ├── chat/                #   Chat interface
│   │   ├── agent/               #   Agent builder UI
│   │   ├── settings/            #   Settings panels
│   │   └── ...
│   ├── pages/                   # 70+ page-level components
│   │   ├── email/               #   Email hub sub-pages (7 files)
│   │   ├── scraping/            #   Scraping engine UI (10 files)
│   │   ├── local-vault/         #   Secrets vault UI (8 files)
│   │   ├── ImageStudioPage.tsx  #   Image generation
│   │   ├── VideoStudioPage.tsx  #   Video generation
│   │   ├── EmailHubPage.tsx     #   AI email client
│   │   ├── AgentOrchestratorPage.tsx
│   │   ├── AgentSwarmPage.tsx
│   │   ├── CodingAgentPage.tsx
│   │   └── ...
│   ├── hooks/                   # 105 React hooks (TanStack Query wrappers)
│   ├── ipc/
│   │   ├── handlers/            #   142 IPC handler modules
│   │   │   ├── scraping/        #     12 scraping sub-handlers
│   │   │   ├── email_handlers.ts
│   │   │   ├── image_studio_handlers.ts
│   │   │   ├── video_studio_handlers.ts
│   │   │   └── ...
│   │   ├── ipc_host.ts          #   Handler registration
│   │   ├── ipc_client.ts        #   Primary renderer-side IPC client
│   │   ├── email_client.ts      #   Email-specific IPC client
│   │   └── shared/              #   Shared utilities (model constants, etc.)
│   ├── lib/                     # Core engines (~80+ modules)
│   │   ├── email/               #   Email system (8 files)
│   │   ├── scraping/            #   Scraping engine v3 (12+ files)
│   │   ├── ssi/                 #   Self-Sovereign Identity (3 files)
│   │   ├── autonomous_agent.ts
│   │   ├── agent_swarm.ts
│   │   ├── smart_router.ts
│   │   ├── data_flywheel.ts
│   │   ├── mab_engine.ts
│   │   ├── embedding_pipeline.ts
│   │   ├── vector_store_service.ts
│   │   ├── media_generation.ts
│   │   ├── voice_assistant.ts
│   │   └── ...
│   ├── db/                      # Drizzle ORM schemas (35+ tables)
│   │   ├── schema.ts            #   Main schema re-exports
│   │   └── email_schema.ts      #   Email tables (7 tables)
│   ├── types/                   # TypeScript type definitions (38 files)
│   ├── routes/                  # TanStack Router route tree
│   ├── prompts/                 # AI system prompts
│   └── styles/                  # Global CSS
├── drizzle/                     # SQL migrations (auto-generated, 35+)
├── workers/                     # Web Workers (TypeScript compiler)
├── worker/                      # Injected client scripts
├── shared/                      # Code shared between processes
├── packages/                    # Local NPM packages
├── docs/                        # Architecture & setup guides
├── e2e-tests/                   # Playwright E2E tests
├── scripts/                     # Build & utility scripts
├── assets/                      # Icons, logos, branding
├── android/                     # Capacitor Android project
├── ios/                         # Capacitor iOS project
├── docker-compose.n8n.yml       # n8n + PostgreSQL
├── docker-compose.celestia.yml  # Celestia Light Node
├── forge.config.ts              # Electron Forge build config
├── vite.main.config.mts         # Vite config — main process
├── vite.renderer.config.mts     # Vite config — React renderer
├── vite.preload.config.mts      # Vite config — preload script
└── vite.worker.config.mts       # Vite config — web workers
```

---

## Key NPM Scripts

| Script | Description |
| --- | --- |
| `npm start` | Launch JoyCreate in development mode |
| `npm test` | Run unit tests (Vitest) |
| `npm run e2e` | Run E2E tests (Playwright) |
| `npm run make` | Build distributable installers |
| `npm run package` | Build packaged app (no installer) |
| `npm run db:generate` | Generate SQL migrations from schema changes |
| `npm run db:push` | Apply migrations to the local database |
| `npm run db:studio` | Open Drizzle Studio (database UI) |
| `npm run lint` | Lint with oxlint |
| `npm run lint:fix` | Lint + auto-fix suggestions |
| `npm run prettier` | Format with Prettier |
| `npm run presubmit` | Lint + format check (run before PRs) |
| `npm run ts` | Type-check main app + workers |
| `npm run build` | Build for Capacitor (mobile/web) |
| `npm run mobile:android` | Build and open on Android |
| `npm run mobile:ios` | Build and open on iOS |

---

## Contributing

JoyCreate is early-stage and the codebase changes rapidly. Before opening a PR:

1. **Open an issue first** to discuss your proposed change.
2. **Read the architecture guides** — [Architecture](docs/architecture.md), [Agent Architecture](docs/agent_architecture.md), and [AGENTS.md](AGENTS.md).
3. **Set up pre-commit hooks** — `npm run init-precommit` (runs formatter + linter on each commit).
4. **Run `npm run presubmit`** before pushing.
5. **Follow the IPC checklist** when adding new channels: handler + ipc_host registration + preload allowlist + ipc_client method.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full details.

---

## Security

We take security seriously. **Do not report vulnerabilities as public issues.** Instead, use [GitHub Security Advisories](https://github.com/DisciplesofLove/JoyCreate/security/advisories/new).

Key security practices:
- No `remote` module — strict Electron process isolation
- All IPC channels explicitly allowlisted in preload
- Electron Fuses locked down (cookie encryption, CLI flags, asar integrity)
- Secrets vault with encrypted local storage
- Validate/lock by `appId` when mutating shared resources

See [SECURITY.md](SECURITY.md) for our full security policy.

---

## License

- All code outside of `src/pro` is open-source and licensed under **[Apache License 2.0](LICENSE)**.
- All code within `src/pro` is fair-source and licensed under **[Functional Source License 1.1 — Apache 2.0](https://fsl.software/)** — see [src/pro/LICENSE](./src/pro/LICENSE).

```
Copyright 2024-2026 JoyCreate Contributors
Licensed under the Apache License, Version 2.0
```

---

<p align="center">
  <strong>JoyCreate — More powerful than paid alternatives, 100% free.</strong><br/>
  <a href="https://joycreate.app/#download">Download</a> &bull;
  <a href="https://docs.joycreate.app">Docs</a> &bull;
  <a href="https://github.com/DisciplesofLove/JoyCreate">GitHub</a>
</p>
