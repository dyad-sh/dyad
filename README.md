<p align="center">
  <a href="https://joycreate.app">
    <img src="https://github.com/user-attachments/assets/f6c83dfc-6ffd-4d32-93dd-4b9c46d17790" alt="JoyCreate — The Sovereign AI Operating System" width="100%" />
  </a>
</p>

<h1 align="center">JoyCreate</h1>

<h3 align="center">
  The World's First <strong>Sovereign AI Operating System</strong><br/>
  <em>Local-first · Private · Open Source · Unstoppable</em>
</h3>

<p align="center">
  <a href="https://github.com/DisciplesofLove/JoyCreate/releases"><img src="https://img.shields.io/github/v/release/DisciplesofLove/JoyCreate?label=latest&style=flat-square&color=8B5CF6" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache 2.0 License" /></a>
  <a href="https://github.com/DisciplesofLove/JoyCreate/stargazers"><img src="https://img.shields.io/github/stars/DisciplesofLove/JoyCreate?style=flat-square&color=FFD700" alt="GitHub Stars" /></a>
  <a href="https://github.com/DisciplesofLove/JoyCreate/graphs/contributors"><img src="https://img.shields.io/github/contributors/DisciplesofLove/JoyCreate?style=flat-square" alt="Contributors" /></a>
  <a href="https://github.com/DisciplesofLove/JoyCreate/issues"><img src="https://img.shields.io/github/issues/DisciplesofLove/JoyCreate?style=flat-square" alt="Issues" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" /></a>
  <a href="https://discord.gg/joycreate"><img src="https://img.shields.io/discord/1234567890?label=discord&logo=discord&style=flat-square&color=5865F2" alt="Discord" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/AI%20Providers-12%2B%20local%20%7C%209%20cloud-purple?style=flat-square" alt="AI Providers" />
  <img src="https://img.shields.io/badge/IPC%20Handlers-150%2B-orange?style=flat-square" alt="IPC Handlers" />
</p>

<br/>

<p align="center">
  <strong>
    <a href="https://joycreate.app/#download">⬇️ Download</a>
    &nbsp;&bull;&nbsp;
    <a href="https://docs.joycreate.app">📖 Docs</a>
    &nbsp;&bull;&nbsp;
    <a href="#-quick-start">🚀 Quick Start</a>
    &nbsp;&bull;&nbsp;
    <a href="#-architecture">🏗️ Architecture</a>
    &nbsp;&bull;&nbsp;
    <a href="#-features">✨ Features</a>
    &nbsp;&bull;&nbsp;
    <a href="CONTRIBUTING.md">🤝 Contribute</a>
    &nbsp;&bull;&nbsp;
    <a href="https://discord.gg/joycreate">💬 Discord</a>
  </strong>
</p>

---

<br/>

> **JoyCreate is what happens when you take everything Salesforce, Microsoft, AWS, and Zapier do — and make it free, private, local-first, and open source.**

JoyCreate is a **desktop AI super-app** that replaces a $500/month software stack with a single free download. Build AI agents, generate images and videos, automate workflows, manage email with AI, deploy to decentralized networks — everything runs on *your machine*, under *your control*, with *zero subscriptions*.

**v0.32.0-beta** · 150+ IPC handlers · 80+ pages · 105 React hooks · 38 type definitions · 12+ AI providers

<br/>

---

## 🎯 Why JoyCreate Exists

The AI revolution is being gatekept.

You pay $29/month for a chatbot. $99/month for a workflow tool. $199/month for an agent platform. And every query you make trains someone else's model with your data.

**We built JoyCreate because intelligence should be sovereign.**

Your AI runs on your hardware. Your data never leaves unless you choose. Your workflows aren't locked in someone else's cloud. And it's free — forever.

<br/>

---

## 🏆 JoyCreate vs. The World

| Feature | JoyCreate | Salesforce Einstein | Microsoft Copilot | AWS Bedrock | Zapier AI | Make.com |
|---------|:---------:|:-------------------:|:-----------------:|:-----------:|:---------:|:--------:|
| **Cost** | **Free** | $75/user/mo | $30/user/mo | Pay-per-use | $49+/mo | $29+/mo |
| **Local AI (no cloud)** | ✅ 12+ providers | ❌ | ❌ | ❌ | ❌ | ❌ |
| **100% Private** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Image Generation** | ✅ 7 providers | ❌ | Limited | Limited | ❌ | ❌ |
| **Video Generation** | ✅ 7 providers | ❌ | ❌ | ❌ | ❌ | ❌ |
| **AI Email Client** | ✅ Full client | Limited | Limited | ❌ | ❌ | ❌ |
| **Multi-Agent Swarms** | ✅ | Enterprise only | Enterprise only | ❌ | ❌ | ❌ |
| **Multi-Model Orchestration** | ✅ 6 strategies | ❌ | ❌ | Basic | ❌ | ❌ |
| **Decentralized Deploy** | ✅ Celestia/IPFS | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Self-Sovereign Identity** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Data Flywheel (self-improving)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mobile (iOS + Android)** | ✅ Capacitor | Partial | Partial | ❌ | ❌ | ❌ |
| **Open Source** | ✅ Apache 2.0 | ❌ | ❌ | ❌ | ❌ | ❌ |

<br/>

---

## 🚀 Quick Start

**Download and run in under 2 minutes:**

```bash
# Option 1: Download the installer (recommended)
# Go to https://joycreate.app/#download — one click, done.

# Option 2: Build from source
git clone https://github.com/DisciplesofLove/JoyCreate.git
cd JoyCreate
pnpm install
pnpm run dev
```

**Requirements:**
- Node.js 18+ (or use the bundled binary)
- 4GB RAM minimum (8GB recommended for local AI)
- Windows 10+, macOS 12+, or Ubuntu 20.04+

**Optional (unlock local AI — 100% free):**
```bash
# Install Ollama for unlimited local AI
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

> 💡 **Tip:** JoyCreate auto-detects Ollama, LM Studio, and other local AI providers — no config needed.

<br/>

---

## ✨ Features

### 🤖 AI Agent System

Build, deploy, and orchestrate AI agents that work for you 24/7.

- **Visual Agent Builder** — drag-and-drop agent creation with no-code tools
- **14 Agent Templates** — customer service, marketing, coding, research, and more
- **Multi-Agent Swarms** — orchestrate multiple agents on complex tasks
- **Agent Memory** — long-term knowledge retention via vector store
- **Tool Calling** — connect agents to APIs, databases, and file systems
- **Autonomous Mode** — set objectives and let agents self-direct
- **Marketplace** — publish and monetize your agents

```typescript
// Example: Create an agent via API
const agent = await joycreate.agents.create({
  name: "CustomerCare Pro",
  systemPrompt: "You are an expert customer support agent...",
  tools: ["email", "database", "calendar"],
  model: "claude-sonnet-4"
});
```

---

### 🧠 Multi-Model Orchestration

The first desktop app with **production-grade multi-model strategies**:

| Strategy | Use Case |
|----------|----------|
| 🗳️ **Ensemble Voting** | Critical decisions — multiple models vote |
| 🔗 **Pipeline** | Draft → Review → Polish with different specialists |
| ⚔️ **Debate** | Models critique each other for max accuracy |
| 🎯 **Best-of-N** | Generate N candidates, auto-pick the best |
| ⚡ **Parallel** | Same task, multiple models, merged perspective |
| 🔀 **Mixture of Experts** | Route sub-tasks to specialist models |

---

### 🎨 Image Studio

Generate, edit, and upscale with **7 providers**:

| Provider | Models |
|----------|--------|
| OpenAI | DALL-E 3, GPT-Image-1 |
| Google | Imagen 3 |
| Stability AI | Stable Diffusion 3, Flux |
| Runway | Gen-3 Alpha |
| Replicate | 100+ community models |
| ComfyUI | Full local pipeline |
| Ollama | LLaVA, BakLLaVA |

---

### 🎬 Video Studio

Create videos with AI using **7 providers**:

Runway Gen-3 · Kling · Luma Dream Machine · Google Veo · OpenAI Sora · Pika Labs · Stability Video Diffusion

---

### 📧 AI Email Client

The email client your inbox deserves:

- **Auto-Triage** — AI categorizes and prioritizes every email
- **Smart Replies** — context-aware draft replies in your voice
- **Daily Digest** — morning summary of what matters
- **Autonomous Rules** — "always archive newsletters" and it learns
- **Thread Summarization** — collapse 50-email threads into 3 bullets

---

### 🔄 Workflow Automation

Replace Zapier and n8n with something you actually own:

- **Visual Workflow Builder** — connect anything to anything
- **150+ IPC triggers** — react to any JoyCreate event
- **n8n Integration** — full n8n compatibility + JoyCreate custom node
- **AI-Powered Steps** — drop AI into any workflow step
- **Webhook Support** — expose any workflow as an HTTP endpoint

---

### 📄 Document Studio (LibreOffice Integration)

Create professional documents programmatically:

- Generate Word docs, Excel sheets, PowerPoint decks via AI
- Export to PDF with one click
- Agent-to-document pipeline (agent output → formatted document)
- Template system with 20+ professional templates

---

### 🔐 Data Sovereignty & Privacy

Your data, your rules:

- **Local Vault** — AES-256 encrypted local storage
- **Self-Sovereign Identity (SSI)** — DID-based credentials
- **Zero-Knowledge Proofs** — prove facts without revealing data
- **Data Lineage** — full audit trail of every AI operation
- **Privacy Inference Engine** — auto-detects and masks PII

---

### ⛓️ Decentralized Infrastructure

Move beyond the cloud:

- **Celestia DA Layer** — publish data to a decentralized data availability network
- **IPFS** — content-addressed permanent storage
- **Blockchain Deploy** — deploy agents as on-chain programs
- **JoyCreate Network (JCN)** — peer-to-peer AI network
- **Compute Marketplace** — monetize idle GPU/CPU

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        JoyCreate Desktop                        │
│                    (Electron + React + TypeScript)               │
├─────────────────┬───────────────────────┬───────────────────────┤
│   UI Layer      │   IPC Bridge Layer    │   Main Process        │
│                 │                       │                       │
│  80+ Pages      │   150+ IPC Handlers   │   Agent Orchestrator  │
│  105+ Hooks     │   Type-safe channels  │   Document Engine     │
│  shadcn/ui      │   Bi-directional      │   AI Router           │
│  TailwindCSS    │   Streaming support   │   n8n Integration     │
│  TanStack Query │                       │   Email Engine        │
├─────────────────┴───────────────────────┴───────────────────────┤
│                         Data Layer                               │
│     Drizzle ORM + better-sqlite3 · Vector Store · Local Vault   │
├──────────────────────────────────────────────────────────────────┤
│                     AI Provider Layer                            │
│  LOCAL: Ollama · LM Studio · llama.cpp · vLLM · OpenClaw ···    │
│  CLOUD: OpenAI · Anthropic · Google · Azure · Bedrock · xAI ··· │
├──────────────────────────────────────────────────────────────────┤
│                  Decentralized Layer (Optional)                   │
│         Celestia · IPFS · Smart Contracts · JCN · SSI           │
└──────────────────────────────────────────────────────────────────┘
```

**Key architectural decisions:**

| Decision | Rationale |
|----------|-----------|
| **Electron + React** | Native performance + web ecosystem |
| **IPC-first architecture** | Clean separation, testable, extensible |
| **SQLite + Drizzle** | Zero-config, portable, fast |
| **Local-first data** | Privacy by design, works offline |
| **Provider abstraction** | Swap AI providers without code changes |

<br/>

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 33 |
| UI Framework | React 18 + TypeScript |
| State Management | TanStack Query + Zustand |
| UI Components | shadcn/ui + Radix UI |
| Styling | Tailwind CSS v4 |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| AI SDK | Vercel AI SDK 4.x |
| Build | Vite + Electron Forge |
| Mobile | Capacitor (iOS + Android) |
| Testing | Vitest + Playwright |
| Package Manager | pnpm |

<br/>

---

## 🗺️ Roadmap

### ✅ Shipped (v0.32)
- [x] 150+ IPC handlers across all subsystems
- [x] 80+ pages and full navigation
- [x] Multi-model orchestration (6 strategies)
- [x] Image Studio (7 providers)
- [x] Video Studio (7 providers)
- [x] AI Email Client
- [x] Agent Builder + Marketplace
- [x] n8n Integration
- [x] Celestia / IPFS decentralized deploy
- [x] LibreOffice document generation
- [x] Self-Sovereign Identity
- [x] OpenClaw Gateway integration

### 🚧 In Progress (v0.33)
- [ ] Agent-to-document pipeline (DONE ✅ in this PR)
- [ ] Automation Orchestrator UI (DONE ✅ in this PR)
- [ ] Full end-to-end test coverage
- [ ] One-line installer script
- [ ] JoyCreate Marketplace (hosted)

### 🔮 Coming (v1.0)
- [ ] Mobile app (iOS + Android) — full feature parity
- [ ] JoyCreate Cloud (opt-in sync, no lock-in)
- [ ] Plugin marketplace for community extensions
- [ ] Enterprise SSO + team management
- [ ] Fine-tuning studio (train custom models on your data)
- [ ] JoyCreate Network — distributed AI compute marketplace

<br/>

---

## 📁 Project Structure

```
JoyCreate/
├── src/
│   ├── pages/           # 80+ React pages
│   ├── ipc/
│   │   ├── handlers/    # 150+ main-process IPC handlers
│   │   └── *_client.ts  # Renderer-side IPC clients
│   ├── components/      # Shared UI components
│   ├── db/              # Drizzle schema + migrations
│   ├── types/           # 38 TypeScript type definitions
│   ├── lib/             # Shared utilities
│   └── main/            # Electron main process entry
├── scripts/             # Build + maintenance scripts
├── n8n-config/          # n8n integration + custom node
├── docs/                # Documentation
├── e2e-tests/           # Playwright E2E tests
└── packages/            # Workspace packages
```

<br/>

---

## 🧑‍💻 Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Type check
pnpm run typecheck

# Lint
pnpm run lint

# Run tests
pnpm run test

# Build for production
pnpm run build

# Package installer
pnpm run make
```

<br/>

---

## 🤝 Contributing

We welcome contributions of every kind — bug reports, features, docs, tests, or just spreading the word.

**Quick start for contributors:**

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run `pnpm run typecheck && pnpm run lint`
5. Commit: `git commit -m "feat: your feature"`
6. Push and open a PR

Read [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines, code style, and architecture decisions.

**High-impact areas:**
- 🧪 Test coverage (E2E + unit)
- 📱 Mobile feature parity
- 🌐 Translations / i18n
- 📖 Documentation
- 🐛 Bug reports with reproduction steps
- 💡 New AI provider integrations

<br/>

---

## 🔒 Security

JoyCreate takes security seriously. All data is stored locally by default. Cloud connections are opt-in and clearly indicated in the UI.

- Found a vulnerability? See [SECURITY.md](SECURITY.md) for responsible disclosure
- API keys are stored in your system keychain, never in plain text
- All IPC channels are type-checked and validated

<br/>

---

## 📣 Community

| Platform | Link |
|----------|------|
| 💬 Discord | [discord.gg/joycreate](https://discord.gg/joycreate) |
| 🐦 Twitter / X | [@JoyCreateApp](https://x.com/JoyCreateApp) |
| 📺 YouTube | [JoyCreate Channel](https://youtube.com/@JoyCreate) |
| 🌐 Website | [joycreate.app](https://joycreate.app) |
| 📖 Docs | [docs.joycreate.app](https://docs.joycreate.app) |

<br/>

---

## 📜 License

JoyCreate is licensed under the **Apache License 2.0** — free to use, modify, and distribute.

See [LICENSE](LICENSE) for full text.

---

<p align="center">
  <strong>Built with ❤️ by the Disciples of Love community</strong><br/>
  <em>Intelligence should be sovereign. Technology should serve humanity.</em>
</p>

<p align="center">
  <a href="https://github.com/DisciplesofLove/JoyCreate">
    <img src="https://img.shields.io/github/stars/DisciplesofLove/JoyCreate?style=social" alt="Star JoyCreate" />
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/DisciplesofLove/JoyCreate/fork">
    <img src="https://img.shields.io/github/forks/DisciplesofLove/JoyCreate?style=social" alt="Fork JoyCreate" />
  </a>
</p>
