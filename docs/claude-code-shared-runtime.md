# Claude Code architecture

Claude Code owns reasoning and conversation; Dyad owns tools, permissions, presentation, and app workflows. The backend is opt-in through the top-level `enableClaudeCodeSubscription` experiment.

## Execution path

```text
Dyad chat admission → handleLocalAgentStream → ClaudeCodeModel → Claude Code CLI
                              ↑                                     ↓
                   guarded Dyad ToolSet ← host-owned MCP bridge ← tool call
```

`ClaudeCodeModel` implements the AI SDK model interface. It exposes the regular Dyad registry and dynamic third-party MCP integration through `createDyadToolBridge`, preserving normal mode/provider/feature availability. Both backends invoke the same guarded callbacks for validation, consent, execution, mutation tracking, and cards. Provider-executed SDK events prevent duplicate execution.

The CLI starts with an empty native tool set (`--tools ""`) and restricted settings, hooks, and plugins. Startup validates the exact Dyad MCP inventory and server; optional `EndConversation` is only a protocol control. Typed media results retain Dyad’s safety bounds; remote media remains links rather than being fetched implicitly.

## Turn ownership

Root MCP calls execute FIFO, so consent and questionnaires form a decision barrier without holding a workspace lock. Individual tools acquire their normal operation claims. The regular Dyad runtime owns child agents, cancellation, mutation draining, provider bookkeeping, deferred operations, Git checkpoints, and preview updates. Workflow stops use a CLI protocol interrupt to flush usage; CLI failure aborts pending tool work before cleanup and finalization. Historical native-tool cards remain readable, but only shared Dyad cards are produced now.

Referenced-app reads bind to app IDs and refresh paths under per-operation read claims after consent. Git metadata is excluded from file reads. Claude cancellation publishes completion only after owned operations drain.

## Sessions and human decisions

- **Sessions:** fingerprints bind sessions to app path, instructions, and tool schemas. Capability changes or interruption start a fresh session from bounded Dyad history, never replaying historical tool calls.
- **Questionnaires:** requests persist before parking and answers before returning; failed answer saves remain retryable. Renderer reload reconnects to the main-process invocation. Full restart marks pending requests interrupted and carries recorded answers into fresh-session context. Receipts are indexed by chat, retain the latest 50 completed outcomes, and are removed with chat history.
- **Plans:** drafts publish only after persistence. Human acceptance identifies the exact displayed version; model confirmation alone is insufficient. Handoff settles the planning turn, verifies the version, and submits an immutable snapshot. Same/new-chat handoffs preserve backend identity. Durable admission prevents duplicate implementation; interrupted, unadmitted handoffs require renewed acceptance.

## Billing

Claude shares Codex’s external-model billing policy: Agent + Pro is eligible for Dyad charges; other modes or Pro off are unbilled by Dyad. Usage reporting is best-effort, with engine-owned settlement. Child agents use their configured provider and billing—not the Claude subscription. Production charging remains unverified.
