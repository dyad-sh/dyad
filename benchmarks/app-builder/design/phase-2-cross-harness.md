## Phase 2: cross-harness comparison (Claude Code, Codex CLI)

Phase 2 answers one question: **how much of the Phase-1 result is the model, and how much is Dyad?** We rerun the identical 9 checkpoints (3 apps x 3 milestones) through each model vendor's own coding-agent harness — Claude Code CLI for the Anthropic models, Codex CLI for the gpt-5.6 family — against the same neon-sim backend, the same CUJ/security/judge scoring (identical fixed judge panel and cross-vendor pairing rule — see 2.4), and the same pricing table. The harnesses' differing system prompts, tools, and planning behavior are _not_ confounds to eliminate; they are the treatment. Everything else is held equal.

### 2.1 Harness-agnostic task bundle

Everything a harness needs lives in one directory, with zero Dyad imports, so Phase 1 and Phase 2 consume the identical inputs:

```
benchmarks/app-builder/
  bundle/
    apps/<crm|helpdesk|admin-portal>/
      milestone-1.md  milestone-2.md  milestone-3.md   # plain markdown, byte-identical across harnesses
      cujs/*.spec.ts                                   # self-contained Playwright CUJs (UI-driven data setup)
      probes/*.spec.ts                                 # adversarial security probes
      judge/rubric.md
    workspace-template/                                # dyad-sh/nextjs-template @ pinned commit,
                                                       #   node_modules pre-installed, npm cache warmed (offline runs);
                                                       #   ships AI_RULES.md incl. the better-auth SDK note (see below)
    agents-context.md                                  # copied into workspace as BOTH AGENTS.md and CLAUDE.md;
                                                       #   carries the identical better-auth SDK note
    scripts/db.mjs                                     # `node scripts/db.mjs "<SQL>"` via @neondatabase/serverless
    scoring.config.json                                # 60/25/15 weights, milestone timeouts 15/20/25 min (M1/M2/M3), retry-once policy
    pricing.json                                       # per-model list prices incl. cached-read and cache-write rates
    models.json                                        # bench model id -> per-harness id + flags
  adapters/
    dyad.mjs  claude-code.mjs  codex.mjs
  run.mjs                                              # matrix runner: append-only JSONL + resume
```

Key bundle rules:

- **Prompts are harness-agnostic.** Milestone prompts pin routes and `data-testid`s but never mention Dyad, dyad-tags, or `dyad-execute-sql`. Migrations are expressible in any harness: the template ships `scripts/db.mjs`, which posts SQL to `DATABASE_URL` via `@neondatabase/serverless` — the same neon-sim HTTP-SQL endpoint Dyad's `dyad-execute-sql` path hits, so both routes are wire-identical. `agents-context.md` documents it.
- **The auth SDK note travels with the bundle, identically for every harness.** Email verification is off (`require_email_verification:false`), and the only injected guide documenting the better-auth client calls is suppressed in that configuration (`neon_prompt.ts:81`). So the starting template snapshot ships a short factual note — in `AI_RULES.md` (which Dyad reads) and as the identical text inside `agents-context.md`, hence in both CLIs' `AGENTS.md`/`CLAUDE.md` — documenting `authClient.signUp.email({email,password,name})`, `authClient.signIn.email({email,password})`, `authClient.signOut()`, and server-side session reading via the `createNeonAuth` server helper. This note is part of the task bundle and byte-identical for every model and harness.
- **Workspace setup is identical bytes.** `setup()` copies `workspace-template/`, writes the same `.env.local` (`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` from neon-sim — the values Dyad would inject), `git init && git commit`, and copies `agents-context.md` to `AGENTS.md` + `CLAUDE.md`. neon-sim is a real out-of-process shim that only _mirrors_ the endpoint surface of the E2E mock in `src/neon_admin/neon_management_client.ts:113-359`; `E2E_TEST_BUILD` must be **unset** in every benchmark process — if set, Dyad's in-process Neon mock short-circuits everything (`neon_management_client.ts:112-113`) and no traffic ever reaches the shim. The Dyad adapter deletes both context files (Dyad gets its own Neon system prompt plus the template's `AI_RULES.md` note instead — see 2.4).
- **Scoring is outside the adapter.** After each milestone the runner starts the app from the working tree and runs CUJs, probes, and the judge (scoring attempts run against per-attempt clones of the milestone DB snapshot, per the Phase-1 checkpoint design). Scoring reads the **working tree, not git history** — Dyad auto-commits via its response processor (`src/testing/chat_flow_harness.ts:9-10`), the CLIs may not commit at all; the runner does a bookkeeping commit after scoring so per-milestone diffs are recoverable.

**Adapter interface** (all three implement it; the Dyad adapter wraps `setupChatFlowHarness()` / `streamChat()` from `src/testing/chat_flow_harness.ts:227` and `:196-202`, passing the same `chatId` across milestones for session continuity, and relies on the three-item Phase-1 benchmark-support patch set — P1 the `DYAD_NEON_API_BASE_URL` base-URL override at the `createApiClient` sites, pointing Dyad at neon-sim; P2 the `fixtureAppPath` harness option, an absolute path to the template snapshot; P3 catalog wiring, `useFakeCatalog:false` plus `DYAD_LANGUAGE_MODEL_CATALOG_URL` pointed at a local pinned catalog file containing all 7 engine model ids and the auto provider (`chat_flow_harness.ts:288-330`). Dyad's engine traffic runs through the recording proxy via `DYAD_ENGINE_URL`):

```ts
interface HarnessAdapter {
  readonly id: "dyad" | "claude-code" | "codex";
  /** Fresh workspace + per-run isolated state (config dirs, session ids). */
  setup(ctx: {
    workspace: string;
    model: BenchModel;
    proxy: UsageProxyHandle;
  }): Promise<void>;
  /** One milestone to completion. Throws only on infra failure (retried once);
      a bad model result is not an error — the checkpoint is scored as-is. */
  runMilestone(
    promptText: string,
    index: 1 | 2 | 3,
  ): Promise<{ durationMs: number }>;
  teardown(): Promise<void>;
}
```

**Token/cost capture is external to every adapter.** A local logging reverse proxy (pattern already proven in `benchmarks/code-explorer/run.mjs:565-575`, which fronts engine traffic with a rewriting local proxy) records every request/response and the runner reads a usage **delta** around each `runMilestone()` call — Dyad routes engine traffic through it via `DYAD_ENGINE_URL`, the CLIs via `ANTHROPIC_BASE_URL` / `openai_base_url` (2.2–2.3). Adapters never self-report cost. Wire formats are normalized to one canonical triple:

| canonical        | Anthropic wire (proxy sees SSE `message_start`/`message_delta.usage`)   | OpenAI Responses wire                                           |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `uncached_input` | `usage.input_tokens` (already excludes cache)                           | `usage.input_tokens - usage.input_tokens_details.cached_tokens` |
| `cached_read`    | `usage.cache_read_input_tokens`                                         | `usage.input_tokens_details.cached_tokens`                      |
| `cache_write`    | `usage.cache_creation_input_tokens` (billed at the cache-write premium) | 0 (no write premium)                                            |
| `output`         | `usage.output_tokens`                                                   | `usage.output_tokens` (includes reasoning tokens)               |

`cost = uncached*P_in + cached_read*P_cache_read + cache_write*P_cache_write + output*P_out`, prices from `pricing.json`, summed over **all** requests in the milestone window — including sidecar calls (Claude Code's background Haiku calls, subagents), attributed per-model from the request's `model` field. This is the same methodology as Phase 1's Dyad cost capture, so cross-harness cost numbers are directly comparable. Results append to `runs.jsonl` with resume, reusing the exact pattern from `benchmarks/code-explorer/run.mjs:159,191` (append-only) and `:266-283` (`--resume-from` rebuilds the remaining matrix), with eval-style structure as in `src/__tests__/evals/`.

### 2.2 Claude Code adapter (`claude-sonnet-5`, `claude-opus-5`, `claude-fable-5`)

**Invocation.** Headless mode is `claude -p` (docs: code.claude.com/docs/en/headless). Per milestone, from the workspace directory:

```bash
# Milestone 1 — capture the session id
result=$(claude -p "$(cat milestone-1.md)" \
  --model "$MODEL" \
  --output-format json \
  --dangerously-skip-permissions)
session_id=$(jq -r '.session_id' <<<"$result")

# Milestones 2–3 — same session, same directory
claude -p "$(cat milestone-2.md)" --resume "$session_id" \
  --model "$MODEL" --output-format json --dangerously-skip-permissions
```

- **Do not use `--bare`.** Bare mode skips CLAUDE.md auto-discovery, and reading the workspace `CLAUDE.md` is precisely the product behavior we want measured. Reproducibility comes from isolation instead: per-run `CLAUDE_CONFIG_DIR` pointing at a fresh temp dir (no user hooks, plugins, memory, or `.mcp.json` leakage), `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
- **Unattended permissions.** Recommended: `--dangerously-skip-permissions` — the bench runner is an isolated machine, the backend is an offline simulator, and the only secret in the environment is the bench API key. Locked-down alternative if the runner is shared: `--permission-mode acceptEdits --allowedTools "Bash(npm *),Bash(node *),Bash(git *),Read,Edit,Write,Glob,Grep"` (permission-rule prefix syntax). Do not rely on `dontAsk` — a denied tool aborts the run mid-milestone and would be scored as model failure when it is actually harness config.
- **Session sequencing.** `--resume <session_id>` (id from the milestone-1 JSON result) rather than `--continue`: explicit ids are robust if anything else touches the project dir, and session lookup is scoped to the workspace directory, so all three milestones must run with the same cwd. This mirrors Dyad Phase 1, where milestones 2–3 stream into the same chat (`streamChat({ chatId })`, `src/testing/chat_flow_harness.ts:197-202`). Fresh-session-per-milestone with only repo state was rejected: Dyad keeps conversational context, so the CLIs must too.
- **Token capture.** `ANTHROPIC_BASE_URL=http://127.0.0.1:<proxyPort>` routes every API call through the logging proxy, which passes `x-api-key`/`Authorization` through untouched and forwards to `api.anthropic.com` (`ANTHROPIC_API_KEY` set in the env; no OAuth involved). The proxy records anthropic wire usage per response — `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` — per model. Cross-check: the `--output-format json` result carries `total_cost_usd` and a per-model usage breakdown; the runner asserts proxy-computed cost is within 10% of CLI-reported cost and flags the row otherwise. The proxy number is canonical (single methodology across all three harnesses).
- **Duration and timeout.** `durationMs` = wall clock around process spawn-to-exit. The milestone timeout ladder (M1 15 min, M2 20 min, M3 25 min) is runner-enforced via SIGTERM (Claude Code aborts the turn, kills child processes, exits 143 per the headless docs); a timed-out milestone gets outcome `truncated` (distinct from `agent_gave_up`/`infra_error`/`build_failed`) and is still scored from the working tree as-is and flagged — identical semantics to a Dyad turn timeout.
- Record `claude --version` in run metadata; pin the version for the whole benchmark.

### 2.3 Codex adapter (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`)

**Invocation.** `codex exec` is the headless mode (docs: developers.openai.com/codex/noninteractive). Per-run isolation via a fresh `CODEX_HOME` temp dir containing:

```toml
# $CODEX_HOME/config.toml
model = "gpt-5.6-sol"                      # from models.json mapping (Dyad engine id -> OpenAI API id)
approval_policy = "never"
sandbox_mode = "workspace-write"
openai_base_url = "http://127.0.0.1:<proxyPort>/v1"   # logging proxy -> api.openai.com
[sandbox_workspace_write]
network_access = true                      # npm scripts + localhost neon-sim + dev server
```

```bash
# Milestone 1 — capture the session/thread id from the JSON event stream
codex exec --json --cd "$WORKSPACE" - < milestone-1.md > m1.jsonl
session_id=$(jq -r 'select(.type=="thread.started") | .thread_id' m1.jsonl)

# Milestones 2–3 — resume the same session
codex exec resume "$session_id" --json --cd "$WORKSPACE" - < milestone-2.md > m2.jsonl
```

- **Unattended strategy.** `codex exec` never prompts; `approval_policy = "never"` plus the sandbox is the safety boundary. `workspace-write` with `network_access = true` is the default choice (writes confined to the workspace; network open so the generated app can bind ports and reach neon-sim on localhost). If the platform sandbox interferes with port binding or Docker-hosted Postgres access on the bench machine, fall back to `--dangerously-bypass-approvals-and-sandbox` on the isolated runner and record which mode ran. Do **not** pass `--ephemeral` (it disables session persistence and breaks `resume`).
- **Context file.** Codex reads `AGENTS.md` from the workspace root — the same bytes as Claude Code's `CLAUDE.md`, including the auth SDK note (2.1). `model_reasoning_effort` is left at the Codex default (recorded in metadata): harness defaults are part of the treatment in the headline run (see 2.4 for the effort-matched sensitivity cell).
- **Token capture.** `openai_base_url` points the built-in provider at the logging proxy (fully-explicit fallback: a `[model_providers.bench]` entry with `base_url` + `env_key`). The proxy sees Responses-API usage (`input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`) and normalizes per the table in 2.1. Cross-check: `--json` `turn.completed` events carry `usage` with `input_tokens`, `cached_input_tokens`, `output_tokens`; assert agreement with the proxy within 10%.
- **Auth mode and cost accounting.** Codex supports ChatGPT-plan sign-in and API-key auth (`CODEX_API_KEY`). **The benchmark uses API-key mode only**: plan auth bills against a subscription with no per-token price, making "dollar cost at list price" undefined, and it may route to a different serving stack. API-key usage is metered per token and priced from the same `pricing.json` used for Phase 1. Disclosed caveat: most real Codex users are on plans, so our dollar figures represent list-price API economics, not typical user spend — this applies equally to the Claude Code rows (also run on API key, not a Max plan).
- **Duration and timeout.** Same as 2.2: wall clock around the process, runner-enforced SIGTERM at the same 15/20/25-minute M1/M2/M3 ladder, `truncated` outcome, tree scored as-is. Record `codex --version`.

### 2.4 Fairness and comparability

**Differs by design — this is the experiment (do not equalize):** system prompts; built-in tool sets; planning/subagent behavior; context management and compaction; prompt-caching strategy (cache discipline is genuinely part of a harness's cost-effectiveness); default reasoning-effort settings (Claude Code defaults to `xhigh` effort, Codex to its own `model_reasoning_effort` default, Dyad engine to its Phase-1 product defaults per model — each recorded and disclosed, none overridden in the headline run).

**Effort-matched sensitivity cell.** Differing effort defaults are a real confound on both cost and quality, so the matrix adds exactly **one effort-matched sensitivity cell**: a single model x app rerun with the CLI harness's reasoning effort pinned to the Dyad Phase-1 product default for that model. It is reported as a labeled secondary row only — the defaults-as-shipped run remains the headline result — and it bounds how much of the Dyad-vs-native delta is attributable to effort defaults rather than harness scaffolding.

**Budget.** Phase 2 runs under its own budget envelope of roughly **$100–150**, separate from Phase 1 and inclusive of the sensitivity cell, with the same guards as Phase 1: pre-run projected-cost gate, the $40 per-cell dollar ceiling enforced live by the logging proxy (abort -> outcome `budget_abort`), and the global $300 kill-switch.

**Held equal:** starting workspace (identical template snapshot, `.env.local`, pre-installed `node_modules`, identical auth SDK note); byte-identical milestone prompts; backend (same neon-sim stack, project reset between apps); scoring pipeline and judge assignment — the fixed panel gpt-5.6-terra, claude-opus-5, gemini-3.6-flash, each candidate scored by its two cross-vendor judges (same-vendor judge dropped) with scores averaged, under the same judge-input caps (<=40k chars of milestone diff + <=20k chars of selected source files) in both phases; pricing table and token-normalization rules; machine, with one run at a time (duration fairness); milestone timeout ladder (M1 15 min, M2 20 min, M3 25 min) and retry-once infra policy; underlying model id per comparison row; pinned CLI versions.

**Known asymmetries, disclosed in the report:**

1. **Dyad's Neon context vs CLI discovery.** Dyad injects a Neon-aware system prompt (use `@neondatabase/serverless`/`@neondatabase/auth`, migrations via `dyad-execute-sql`); the CLIs get none of that natively. Mitigation: `AGENTS.md`/`CLAUDE.md` in the bundle — identical for both CLIs — states the DB/auth setup, the better-auth SDK note (same text as the Dyad template's `AI_RULES.md` note, see 2.1), and the `scripts/db.mjs` migration path, so neither CLI has to reverse-engineer `.env.local`. **Ruling: Dyad's richer integration context stays — it is the product.** The benchmark measures shipped harness value, and pre-wired backend knowledge is exactly the kind of value Dyad claims. The report presents this explicitly rather than pretending the playing field is flat.
2. `AGENTS.md` is bench-authored aid the CLIs receive; its auth-SDK note is identical to the `AI_RULES.md` note Dyad reads, so the CLI-only portion reduces to the env-var/db-script/run-command lines, kept minimal and factual (env vars, auth endpoints, db-apply script, "app must run with `npm run dev`") so it informs rather than coaches.
3. Dyad runs in-process via the vitest harness (`src/testing/chat_flow_harness.ts:1-19` — real `chat:stream` pipeline, real files/git, only Electron mocked, plus the packaged-Electron parity smoke check); the CLIs run as subprocesses. Process overhead is negligible against multi-minute turns.
4. Prompt-cache warmth: milestone 1 is cold for every harness; later milestones benefit from each harness's own caching — by design (see above), but it means milestone-1 cost is the cleanest apples-to-apples token number.
5. Dyad commits per response; CLIs may not. Neutralized by tree-based scoring (2.1).

### 2.5 grok-4.5

No first-party coding-agent harness exists for Grok, so grok-4.5 is **Phase-1 only** — there it runs as the Dyad engine id `openrouter/x-ai/grok-4.5` (through engine.dyad.sh via the same recording proxy, priced at xAI list) — and the cross-harness report renders its native-harness column as n/a. Optional future work — not in scope: run it through a third-party open harness such as opencode (which supports arbitrary OpenAI-compatible providers). If ever added, it would be labeled a _third-party_ harness column, not a vendor-native one, since it tests opencode's harness value rather than xAI's.

### 2.6 Cross-harness report

Generated from `runs.jsonl` into `report.md` + `report.json`:

- **Per model, per checkpoint (9 rows):** quality score, CUJ pass rate, security-probe score, judge score (mean of the candidate's two cross-vendor judges), dollar cost, wall-clock duration — Dyad column vs native-harness column, with delta and ratio.
- **Per model aggregate:** mean checkpoint quality, total 9-milestone cost, total duration, plus the Dyad-minus-native delta on all four headline metrics (quality, CUJ pass rate, cost, duration).
- **Frontier chart:** quality vs cost scatter; color = model, marker shape = harness. The interesting read is whether Dyad points sit up-and-left (more quality per dollar) of their same-model native points.
- **Metadata block:** CLI versions, model ids per harness, sandbox/permission mode used, reasoning-effort defaults in force (plus the pinned effort of the sensitivity cell), proxy-vs-self-reported usage agreement.
- **Caveats section (always included):** N=1 per cell (deltas are directional, not significant); API-list-price accounting vs subscription reality; harness defaults intentionally not equalized (effort-matched sensitivity cell reported as a labeled secondary row); Dyad's Neon context counted as product advantage; `truncated` (timeout) and `budget_abort` milestones flagged per row; any sandbox-mode fallbacks flagged.

### References

- Claude Code headless mode (`claude -p`, `--output-format json|stream-json`, `total_cost_usd`, `--resume`/`--continue`, `--allowedTools`, `--permission-mode`, `--bare`): [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- Claude Code gateway routing via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`: [Connect Claude Code to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect), [Requesty: Claude Code environment variables](https://www.requesty.ai/blog/claude-code-environment-variables-anthropic-base-url-auth-token)
- Codex non-interactive mode (`codex exec`, `--json`, `--output-schema`, `--output-last-message`, `codex exec resume --last | <SESSION_ID>`, `thread.started`/`turn.completed` events, `cached_input_tokens`, `CODEX_API_KEY`): [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive), [openai/codex docs/exec.md](https://github.com/openai/codex/blob/main/docs/exec.md), [DeepWiki: Headless Execution Mode](<https://deepwiki.com/openai/codex/4.2-headless-execution-mode-(codex-exec)>)
- Codex `config.toml` (`model`, `model_provider`, `openai_base_url`, `model_providers.<id>.base_url/env_key/wire_api`, `approval_policy`, `sandbox_mode`, `CODEX_HOME`): [Codex advanced configuration](https://developers.openai.com/codex/config-advanced), [OpenRouter: Codex CLI config.toml setup](https://openrouter.ai/blog/tutorials/codex-cli-openrouter/)
- Repo grounding: `src/testing/chat_flow_harness.ts:1-19` (real-pipeline harness), `:196-202` (`streamChat` + `chatId`), `:227` (`setupChatFlowHarness`), `:288-330` (catalog wiring); `src/neon_admin/neon_management_client.ts:112-113` (`E2E_TEST_BUILD` mock short-circuit), `:113-359` (Neon mock surface the shim mirrors); `benchmarks/code-explorer/run.mjs:159,191` (append-only JSONL), `:266-283` (resume), `:565-575` (local auth/rewrite proxy prior art); `src/__tests__/evals/` (eval structure).
