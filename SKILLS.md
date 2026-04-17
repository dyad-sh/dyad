# Skills System

> Reusable AI capabilities for bots, agents, orchestrators, and swarms.

## What Are Skills?

Skills are atomic, reusable AI capabilities that any part of the JoyCreate system can invoke. Rather than every bot or agent needing its own logic for common tasks like summarization or translation, skills provide a shared registry of capabilities that can be:

- **Used** by Telegram bots, Discord bots, autonomous agents, orchestrators, and swarms
- **Created** manually via the UI, generated via NLP (`/teach`, `!teach`), or self-learned by the system
- **Purchased** from the JoyMarketplace skill store
- **Sold** by publishing your custom skills to the marketplace

## Architecture

```
User message → Skill Engine (matchSkill) → Execute if confidence ≥ 0.6
                                         ↓ otherwise
                                   Intent Detection → Gateway → LLM
```

### Core Files

| File | Purpose |
|------|---------|
| `src/lib/skill_engine.ts` | Core engine: CRUD, matching, execution, NLP generation, self-learning, bootstrap, export |
| `src/ipc/handlers/skill_handlers.ts` | IPC handlers (21 channels) |
| `src/types/skill_types.ts` | TypeScript type definitions |
| `src/db/schema.ts` | Database tables (`skills`, `agentSkillLinks`) |
| `src/pages/skills.tsx` | Skills management UI (My Skills / Skill Store / Generate) |

### Database Schema

**`skills` table** — 23 columns including:
- `id`, `name`, `description`, `category`, `type`
- `implementationType` (prompt/function/tool/workflow)
- `implementationCode` (the actual prompt text or JS function body)
- `triggerPatterns` (JSON array of trigger patterns)
- `tags`, `examples`, `inputSchema`, `outputSchema`
- Marketplace fields: `publishStatus`, `marketplaceId`, `price`, `currency`, `downloads`, `rating`

**`agentSkillLinks` table** — junction table linking agents to skills with enable/disable toggle.

## Skill Types

| Type | Description |
|------|-------------|
| `builtin` | Ships with JoyCreate — 8 core skills bootstrapped on first run |
| `custom` | Manually created by the user via UI or API |
| `generated` | Auto-created by NLP skill generator or self-learning system |
| `trained` | Improved through usage and feedback |

## Implementation Types

| Type | How It Works |
|------|-------------|
| `prompt` | System prompt sent to an LLM (Ollama local, cloud fallback) |
| `function` | JavaScript async function body executed in sandboxed scope |
| `tool` | Delegates to an agent tool (MCP, API, etc.) |
| `workflow` | Triggers an n8n workflow |

## Trigger Matching

Each skill defines trigger patterns that are tested against incoming messages:

| Trigger Type | Matching Logic | Confidence |
|-------------|----------------|------------|
| `command` | Exact prefix match (`/summarize`, `/translate`) | 1.0 |
| `keyword` | Comma-separated keywords — proportion matched | 0.0–1.0 |
| `regex` | Regular expression test | 0.9 |
| `event` | External event-based (matched outside engine) | 0.0 |

A skill executes when its best trigger match has confidence ≥ 0.6.

## Bootstrap Skills

On first run, the system creates 8 foundational prompt-based skills:

1. **summarize_text** — `/summarize` or keywords: summarize, summary, tldr
2. **translate_text** — `/translate` or keywords: translate, in spanish, in french
3. **generate_code** — `/code` or keywords: write code, generate code, function that
4. **explain_concept** — `/explain` or keywords: explain, what is, how does
5. **analyze_data** — `/analyze` or keywords: analyze, insights, patterns, trends
6. **creative_writing** — `/write` or keywords: write me, compose, draft, blog post
7. **review_code** — `/review` or keywords: review code, find bugs, security review
8. **extract_structured_data** — `/extract` or keywords: extract, parse, json from

## Self-Learning

The system autonomously creates skills when:

1. **Chat fallback** — After every chat message (Telegram/Discord), the engine checks if the message describes a repeatable task with no existing skill match. If so, it generates and saves a new skill. Rate-limited to one attempt per 30 seconds.
2. **Conversation gap analysis** — `analyzeAndCreateMissingSkills()` examines a conversation history with an LLM to identify missing capabilities, then generates up to 3 new skills.
3. **Manual teaching** — `/teach <description>` (Telegram) or `!teach <description>` (Discord) lets users teach the bot new skills via natural language.

## Bot Commands

| Platform | Command | Description |
|----------|---------|-------------|
| Telegram | `/skills` | List all available skills |
| Telegram | `/teach <description>` | Teach the bot a new skill via NLP |
| Discord  | `!skills` | List all available skills |
| Discord  | `!teach <description>` | Teach the bot a new skill via NLP |
| Voice    | "Create a skill that..." | Generate a skill by voice command |

## Orchestrator Integration

The agent orchestrator (`agent_orchestrator_engine.ts`) is skill-aware:

1. **Task decomposition** — When the LLM decomposes a user request into sub-tasks, it sees all available skills alongside agent templates. It can assign a `skillId` to a task instead of a `templateId`.
2. **Task execution** — Tasks with a `skillId` are executed directly via `executeSkill()`, bypassing agent creation and OpenClaw CNS routing. This is faster and more efficient.
3. **Capability resolution** — `resolveSkillsForCapability()` finds matching skills for a capability string, auto-generating one if none exist.

## Marketplace

Skills can be published to the JoyMarketplace:

1. Navigate to the Skills page → select a skill → click "Publish"
2. Set price, description, and metadata
3. Other users can browse and purchase skills from the Skill Store tab
4. Purchased skills are installed via the `skill:import` IPC channel

## Export

The `skill:export-md` IPC channel generates a dynamic `skills.md` file containing all registered skills with their triggers, implementation details, and marketplace status. This file is written to the app's userData directory.

## IPC Channels

| Channel | Description |
|---------|-------------|
| `skill:create` | Create a new skill |
| `skill:get` | Get a skill by ID |
| `skill:list` | List/filter skills |
| `skill:update` | Update a skill |
| `skill:delete` | Delete a skill |
| `skill:search` | Search skills |
| `skill:match` | Find best matching skill for text |
| `skill:execute` | Execute a skill with input |
| `skill:generate` | Generate a skill from NLP description |
| `skill:auto-generate` | Analyze conversation gaps and auto-create skills |
| `skill:attach-to-agent` | Link a skill to an agent |
| `skill:detach-from-agent` | Unlink a skill from an agent |
| `skill:list-for-agent` | List skills linked to an agent |
| `skill:publish` | Publish a skill to marketplace |
| `skill:unpublish` | Remove from marketplace |
| `skill:export` | Export skill as JSON |
| `skill:import` | Import skill from JSON |
| `skill:export-md` | Export all skills as markdown |
| `skill:bootstrap` | Create bootstrap skills if missing |
| `skill:learn` | Self-learn a skill from a message |
