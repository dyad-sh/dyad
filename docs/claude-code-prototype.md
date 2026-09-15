# Claude Code subscription prototype

Updated 2026-09-15: rebased onto current Dyad and aligned charging with #4483. **Live Claude charging and commercial release approval remain unverified.**

## Implemented

- Official local CLI agent backend, explicit per-chat sessions, streamed text/tool cards, persisted actual-model attribution (`Claude Code (model unavailable)` fallback), in-chat approvals, cancellation and process cleanup.
- Claude Code selection and setup status coexist with the existing ChatGPT/Pro/API picker. Switching execution backends explicitly starts a new chat in the same app without transferring context; compatible model changes remain in-chat. Recents and empty-chat defaults are preserved.
- Restricted Read/Glob/Edit/Write inventory; raw Grep and dotenv file access are disabled to prevent bypassing Dyad redaction; shell, subagents and external MCP configuration disabled. Ask/Plan remove mutations. App-bound operational MCP supports diagnostics, checks, package-manager-aware tests, dependency installation and preview restart. Approved project operations execute code; **not an OS sandbox**.
- Attachments use actual local Read paths (including images); sticky referenced apps are permitted only for read tools. Selected-element context and app instructions remain in the prompt.
- App resource coordination, checkpoints, preview refresh, review and undo. Interrupted sessions require new chats, independently of billing. Restore-created forks start fresh CLI sessions using copied visible history as context, never replaying old tool calls. Chat title/search indexing and final updates are preserved; streaming persistence is throttled.
- Shared external-model charging: flat $0.02/M for -luna/-mini/-nano model IDs, $0.10/M otherwise when Pro is enabled. Pro off is unbilled by Dyad. Single-attempt reporting, no outbox or retries, engine-owned actual spend. See [contract](claude-code-track-usage-contract.md).

## Run and verify

Install dependencies with the repository-supported Node version. Authenticate the official native CLI through `claude auth login` outside Dyad; never paste credentials into Dyad. The current version guard accepts 2.1.259+ within 2.1; other series fail closed. Historical tested CLI versions: 2.1.260/261.

```sh
npm run build
DYAD_REAL_CLAUDE_SMOKE=1 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- claude_code_subscription.spec.ts
```

The opt-in Electron suite uses a real Claude subscription and a local test engine for Dyad accounting. It must not be mistaken for a live credit debit. Existing external Dyad services retain their own availability/billing.

## Historical evidence (2026-09-04, before this rebase)

The original CLI/Dyad smoke covered editing, approvals, MCP, preview, restart/resumption, cancellation, read-only mode, backend transitions, attribution, review and undo. These artifacts document that revision, **not current billing behavior**:

- [CLI evidence](claude-code-prototype-cli-evidence.json)
- [Old reservation-contract usage evidence](claude-code-prototype-usage-evidence.json)
- [Change-review screenshot](claude-code-prototype-review.png)

## Release dependencies

Current verification results are recorded in the PR. Production engine charging with eligible credits is still unverified. Commercial terms for the separate fee need confirmation. Real platform coverage was macOS arm64 only; Windows/Linux, authentication expiry, managed policies and quota exhaustion require qualification. Filename search uses Glob followed by individual Read calls; raw content-wide Grep is intentionally unavailable. Application path guards are not an OS sandbox and cannot eliminate filesystem races. Arbitrary external MCP/subagents and specialized cloud/container integrations are not supported by this adapter.
