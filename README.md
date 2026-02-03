<div align="center">

# Dyad

### The open-source AI app builder that runs on your machine.

Fast, private, and fully under your control — like Lovable, v0, or Bolt, but local-first.

[![Image](https://github.com/user-attachments/assets/f6c83dfc-6ffd-4d32-93dd-4b9c46d17790)](https://dyad.sh/)

[Download](https://www.dyad.sh/#download) | [Website](https://dyad.sh/) | [Community](https://www.reddit.com/r/dyadbuilders/) | [Contributing](./CONTRIBUTING.md)

</div>

---

## Why Dyad?

Most AI app builders lock you into their cloud, their pricing, and their ecosystem. Dyad flips the script — it runs entirely on your machine, uses your own API keys, and never sends data anywhere you don't want it to go.

No sign-up. No subscription. No lock-in.

## Features

- **Local-first** — Your data stays on your machine. Nothing is collected or sent without your explicit choice of AI provider.
- **Bring your own keys** — Use API keys from OpenAI, Anthropic, Google, xAI, OpenRouter, Azure, AWS Bedrock, or run models locally with Ollama.
- **Cross-platform** — Native builds for macOS (Intel & Apple Silicon), Windows, and Linux.
- **Smart context** — Send your full codebase, pick files manually, or let Dyad intelligently filter the most relevant files.
- **Multi-file operations** — AI can read, write, and delete files, and manage packages in a single pass.
- **Built-in preview** — See your app come to life as the AI generates code.
- **Git integration** — Version control built right in.

## Download

No sign-up required. Just download and start building.

### [Download for your platform](https://www.dyad.sh/#download)

Available for macOS, Windows, and Linux.

## Supported AI Providers

| Provider    | Examples                                 |
| ----------- | ---------------------------------------- |
| OpenAI      | GPT-5, GPT-5-mini                        |
| Anthropic   | Claude Opus 4.5, Claude Sonnet 4         |
| Google      | Gemini 2.5 Pro, Gemini 2.5 Flash         |
| OpenRouter  | Qwen3 Coder, DeepSeek, Kimi K2, and more |
| Azure       | Azure OpenAI                             |
| AWS Bedrock | Bedrock models                           |
| xAI         | Grok                                     |
| Ollama      | Run models 100% locally                  |

## Community

Join the community of builders on **Reddit**: [r/dyadbuilders](https://www.reddit.com/r/dyadbuilders/) — share what you're building, get help, and connect with other users.

## Contributing

Dyad is open-source and contributions are welcome. Please read our [Contributing Guide](./CONTRIBUTING.md) before opening a PR.

For architecture details, see:

- [Architecture Guide](./docs/architecture.md)
- [Agent Architecture Guide](./docs/agent_architecture.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dyad-sh/dyad)

## License

- Code outside of `src/pro` is open-source under [Apache 2.0](./LICENSE).
- Code within `src/pro` is fair-source under [FSL 1.1 — Apache 2.0](https://fsl.software/) ([LICENSE](./src/pro/LICENSE)).
