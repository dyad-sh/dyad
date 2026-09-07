# Claude Code integration validation

Date: 2026-09-04. **Historical, pre-prototype validation report.** The user
subsequently authorized a full prototype and PR despite the unresolved
commercial question. See [current prototype delivery](claude-code-prototype.md)
for implementation, newer smoke evidence and remaining release dependencies.
Statements below describe the original validation-only checkpoint, not the
current branch.

## Commercial dependency

Anthropic's [Claude Code legal guidance](https://code.claude.com/docs/en/legal-and-compliance)
permits hosting the unmodified binary with end-user authentication, subject to
commercial terms, while prohibiting resale or intermediation of Claude usage.
Authentication must remain Anthropic-owned. The proposed usage-indexed Dyad fee
is not explicitly approved by this guidance. Whether it constitutes a separate
interface service fee or prohibited intermediation requires clarification from
Anthropic; this report does not assert that it is prohibited or approved.

The [commercial terms](https://www.anthropic.com/legal/commercial-terms) and
[consumer terms](https://www.anthropic.com/legal/consumer-terms) were inspected.
No commercial agreement was accepted and no third party was contacted.
Before commercial release, obtain confirmation covering the exact 25%
list-price formula and unknown-model token fee. Do not substitute API billing.

## Real CLI evidence

Official local executable: `/Users/mini/.local/bin/claude`, version **2.1.260**.
Auth status reported logged in, `claude.ai`, first-party, Max subscription.
No credentials were extracted or copied. No API fallback was requested.
This verifies authentication status, not the account's final Anthropic invoice.

Disposable directory: `/tmp/dyad-claude-validation.d2dWCt`.
Two CLI processes exited successfully. These were CLI-only probes, **not runs
through Dyad**. Sanitized observed events are in
`claude-code-validation-evidence.json`.

Launch options for both probes:

```text
-p <prompt> --safe-mode --restricted --strict-mcp-config
--tools Read,Glob,Grep --permission-prompts none
--output-format stream-json --verbose --include-partial-messages
```

1. Prompt: remember and repeat `violet lighthouse`.
   Observed seven streaming events and the expected response. Init advertised
   exactly Glob, Grep, Read, no MCP servers, and no plugins.
2. A new process used `--resume a80501fb-24b6-4b66-a948-2cf79244bcee`.
   It recalled the phrase and retained the exact session ID. Asked to create
   files through Bash and Write, it reported both tools unavailable. Neither
   requested file existed afterward. This establishes tool removal and this
   scenario's lack of mutations, not comprehensive sandbox security.

## Usage findings

The first result's top-level usage describes Opus only, but `modelUsage` also
contains a Haiku call with 904 input and 10 output tokens. Subagent count was
zero. Therefore, top-level usage alone undercounts, while adding it to
`modelUsage` double-counts the main model.

Main first call: 2 uncached input, 2,407 cache-write, 2,800 cache-read, 9 output
tokens. The cache-write breakdown reports all 2,407 as one-hour writes.
Including the auxiliary call gives 6,132 tokens across disjoint categories.
For an entirely unknown-model synthetic case this would cost $0.0006132 under
the requested flat rule; this is arithmetic, not a claim these models are unknown.

CLI model keys changed from `claude-opus-5[1m]` to `claude-opus-5` on resume.
Preserve raw IDs and catalog-owned canonical mapping, not ad hoc suffix removal.
The first result's CLI estimate was $0.026659. Multiplying it by 25% gives
$0.00666475, but **this is not an authoritative Dyad quote**: the engine must
independently apply versioned category rates. The per-model summary contains
cache-write totals without TTL splits; the top-level object does have TTL
splits. Mixed-model cache-write attribution remains unproven.

Output thinking tokens are a subset, not an additional billable category.
Do not add iterations, top-level usage, assistant events and per-model totals
together. Establish one reconciled accounting source and deduplicate snapshots.

## Interface and containment findings

The official [CLI reference](https://code.claude.com/docs/en/cli-reference)
documents tool allowlists, explicit session IDs, restricted mode and MCP
permission handlers. The installed help confirms the options used above.
`--allowedTools` is approval configuration; `--tools` restricts built-ins and
does not restrict MCP tools. Managed policy still needs separate evaluation.

The [programmatic guide](https://code.claude.com/docs/en/headless) documents
streaming. Its bare mode does not read subscription credentials, so it is not
the intended subscription execution path. Safe mode disables customizations
including MCP and cannot be assumed to provide the final bridge configuration.
The production combination of explicit MCP, inherited-customization isolation,
and in-chat approvals is **not verified** by these safe-mode probes.

SIGTERM may leave an unfinished turn that resumes later. Cancellation must
interrupt before termination, drain owned operations and record recovery state;
do not blindly resume a cancelled editing turn. This behavior has not been
experimentally verified here.

## Repository integration map

Read CONTRIBUTING.md, architecture and agent architecture guidance; inspected
the app coordination, local-tool and chat-mode rules and these source seams:

| Area            | Existing seam and required work                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model selection | `src/components/ModelPicker.tsx`: existing chat selection and settings fallback; preserve both existing billing paths                                     |
| Persistence     | `src/db/schema.ts`: chat modelSelection and message.model exist; add explicit backend/session and resolved attribution via migrations                     |
| Message footer  | `src/components/chat/ChatMessage.tsx`: renders persisted message.model; extend without consulting current selection                                       |
| Turn execution  | `src/ipc/handlers/chat_stream_handlers.ts`: admission, model routing and local-agent dispatch; introduce backend boundary outside agent loop              |
| Permissions     | shared `src/user_input/` consent state; local tool invocation guards must remain effective through MCP                                                    |
| Coordination    | appOperationCoordinator resource claims and turn-owned mutation draining; don't nest same-app claims                                                      |
| Versions        | existing sourceCommitHash/commitHash and local-agent finalization; reuse for review/undo and refresh                                                      |
| Billing         | `src/ipc/utils/llm_engine_provider.ts` routes existing engine model traffic; new external-CLI usage endpoint is a separate contract                       |
| Catalog         | `src/ipc/shared/language_model_constants.ts`, remote catalog and findLanguageModel are candidate resolution seams; category-rate coverage not established |

## Release checklist and limitations

Passed: installed/authenticated CLI detection, streaming, explicit resumption
across CLI processes, restricted read-only tool inventory, requested shell/write
non-execution, actual mixed-model usage inspection.

Not verified: MCP invocation, interactive permission response protocol,
cancellation/cleanup, session isolation across apps, settings/hook adversarial
tests, file edits, Dyad restart, preview, attachments, checkpoints/undo,
picker/new-chat confirmation, footer, authentication expiry, usage limits,
mixed-model TTL normalization, persistent reporting, balance enforcement,
contract-compatible endpoint or live charging.

No application code changed. No formatting/lint/type/unit/Electron checks ran;
the local formatter was absent. No dependencies installed, commit made, push or
publication performed. This document and the endpoint proposal are validation
deliverables, not completion of the requested feature or its mandatory Dyad
smoke test.
