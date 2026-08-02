# App-Builder Benchmark — Design

Status: **proposed — gated on the spike plan in §7** · Authored: 2026-07-28 · Home: `benchmarks/app-builder/`

## 1. What this benchmark measures

Cost-effectiveness of building full-stack apps with Dyad across frontier models, on three axes:

- **Cost** — dollars computed from exact captured token counts (uncached input, cached input, output) × published per-1M list prices. Billing actually flows through Dyad Pro credits via `DYAD_PRO_KEY`; list-price dollars are the reported, reproducible metric (same methodology as cursor.com/evals).
- **Quality** — per-checkpoint score = **60%** fixed Playwright CUJ pass rate + **25%** adversarial security probes + **15%** LLM judge rubric (bugs, security, code quality, schema quality).
- **Duration** — wall-clock per milestone turn and per app build.

Shape: **3 apps × 3 sequential milestone prompts = 9 scored checkpoints per model**, N=1 run per (model × app) cell, 7 models → 21 app builds, 63 scored checkpoints. Inspired by CursorBench but deliberately lighter-weight; unlike Cursor's terse prompts, milestone prompts are PRD-style with pinned routes and `data-testid` contracts, because a fixed CUJ suite must run unmodified against whatever each model builds.

Headline report per model (CursorBench-style): **Score %, $/app, tokens/app, minutes/app, steps/checkpoint** — one sortable table + one score-vs-cost scatter. Model score = unweighted mean of its 9 checkpoint scores (the milestone difficulty ramp provides differentiation; no extra weighting).

## 2. Fixed decisions

| Decision                 | Choice                                                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Models (Dyad engine ids) | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `anthropic/claude-sonnet-5`, `anthropic/claude-opus-5`, `anthropic/claude-fable-5`, `openrouter/x-ai/grok-4.5`                                                                                                        |
| Harness                  | Headless `chat_flow_harness` (real `chat:stream` pipeline, local-agent Pro mode); packaged-Electron parity smoke (§Runner)                                                                                                                                            |
| Template                 | `dyad-sh/nextjs-template`, pinned snapshot vendored into the task bundle                                                                                                                                                                                              |
| Backend                  | **neon-sim**: offline local Postgres behind a Neon v2 control-plane shim + serverless-driver SQL proxy + self-hosted better-auth standing in for Neon Auth (§neon-sim)                                                                                                |
| Auth contract            | Identical across all 3 apps: custom sign-up/sign-in forms with pinned test ids; prebuilt AuthView disallowed; email verification off; a short factual auth-SDK note ships in the template's `AI_RULES.md` (+ identical `AGENTS.md` for phase 2)                       |
| Milestone timeouts       | 30 min per milestone (raised from 15/20/25 after S-CELL showed wall-clock was dominated by transport stalls, not model speed — see §11; recalibrate on clean cells); timeout ⇒ outcome `truncated` (scored as-is, flagged — distinct from failure)                    |
| Checkpoint capture       | Git commit + tag per milestone; DB captured via `CREATE DATABASE … TEMPLATE` snapshot in neon-sim; scoring clones the snapshot per attempt                                                                                                                            |
| Judge                    | **Single fixed judge: `gpt-5.6-sol`** for every candidate (user decision 2026-07-29, superseding the cross-vendor pair scheme; same-vendor bias toward the gpt-5.6 candidates is disclosed in every report); inputs hard-capped (≤40k chars diff + ≤20k chars source) |
| Scale                    | N=1, all 7 models (~$130–260 expected list-price; guards in §4)                                                                                                                                                                                                       |
| Reasoning effort         | Dyad product defaults per model — recorded per run and disclosed (phase 1 measures "what a Dyad user gets")                                                                                                                                                           |

## 3. Feasibility findings (research summary)

1. **Self-hosting real Neon is not viable.** Dyad's integration calls the Neon public v2 control-plane API (`@neondatabase/api-client` → `console.neon.tech/api/v2`; `src/neon_admin/neon_management_client.ts:388`), which is closed source. The OSS `neondatabase/neon` docker-compose ships only the storage layer (no management API, no proxy); "Neon Local" requires a cloud API key; current Neon Auth is "Managed Better Auth," a Neon-hosted REST service built on better-auth. Hence **neon-sim**: the shim reimplements exactly the endpoint surface Dyad is proven to depend on (mirrors the app's own E2E mock at `neon_management_client.ts:113-359`), a ~100-line HTTP-SQL proxy speaks the `@neondatabase/serverless` fetch protocol, and a self-hosted better-auth server stands in at `NEON_AUTH_BASE_URL`. The riskiest unknown — whether `@neondatabase/auth` tolerates a non-Neon base URL — is spike S-AUTH.
2. **All 7 models are live in Dyad's remote catalog** (`api.dyad.sh/v1/language-model-catalog`, fetched 2026-07-28) and reachable through `engine.dyad.sh/v1` with `DYAD_PRO_KEY`. The catalog carries **no per-token pricing** (only a relative 0–10 scale), so pricing is pinned externally (§4). grok-4.5 exists only as the OpenRouter-prefixed engine id.
3. **Exact token accounting requires interception.** Dyad persists only a lossy per-message max-total (`messages.maxTokensUsed`, a context-fullness proxy — explicitly not accumulated; `src/ipc/handlers/chat_stream_handlers.ts:2024`). But `DYAD_ENGINE_URL` is env-overridable (proven e2e pattern), and every engine request carries `X-Dyad-Request-Id` which equals `messages.requestId` in sqlite — so a local recording reverse proxy captures per-request `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`, raw payloads, and latency, cleanly correlated to chat turns. The same proxy pattern prices phase-2 CLI harnesses identically.
4. **The old packaged-app benchmark path is broken on main.** `benchmarks/code-explorer/run.mjs` drove chats by invoking the `chat:stream` IPC directly, but that handler is now test-only (`registerLegacyChatStreamTestHandler`, throws outside vitest; production goes through the chat state-machine actor). The headless `chat_flow_harness` runs the identical real pipeline (same handler, real file writes, git commits, local-agent tool loop; only `electron` mocked) — so headless is both the cheaper and the honest choice, with a packaged-app UI-driven smoke for parity. The code-explorer harness's isolation/resume/results conventions are reused.

## 4. Cost model

Pinned list prices (per 1M tokens; **pinned 2026-07-28**, sources in `pricing/pricing.json`):

| Model           | Input  | Cached input | Output | Notes                                                                  |
| --------------- | ------ | ------------ | ------ | ---------------------------------------------------------------------- |
| gpt-5.6-sol     | $5.00  | $0.50        | $30.00 | long-context tier exists; disclosed if hit                             |
| gpt-5.6-terra   | $2.50  | $0.25        | $15.00 |                                                                        |
| gpt-5.6-luna    | $1.00  | $0.10        | $6.00  |                                                                        |
| claude-opus-5   | $5.00  | $0.50        | $25.00 |                                                                        |
| claude-fable-5  | $10.00 | $1.00        | $50.00 | most expensive; ~⅓ of projected spend                                  |
| claude-sonnet-5 | $2.00  | $0.20        | $10.00 | **intro pricing through 2026-08-31** ($3/$15 after) — pinned + labeled |
| grok-4.5        | $2.00  | $0.30        | $6.00  | prompt ≥200K ⇒ whole request re-priced $4.00/$0.60/$12.00              |

`cost = uncached_in × P_in + cached_in × P_cached + out × P_out` (+ cache-write where visible in raw payloads). **Caveats, disclosed in every report:** (a) the engine's OpenAI-compatible usage payload may not expose Anthropic cache-_write_ tokens — raw payloads are retained and priced when present, otherwise Anthropic true cost is slightly undercounted; (b) grok's ≥200K tier re-prices whole requests, so agentic turns with big contexts depress its cost-effectiveness by pricing-model shape, not efficiency; (c) sonnet-5 numbers are intro-priced and shift ~50% on 2026-09-01.

**Spend guards:** projected-cost gate before the run (from per-milestone token envelopes in the app specs); live per-cell ceiling **$40** enforced by the recording proxy (abort ⇒ outcome `budget_abort`); global kill-switch **$300**. Judges add ~$10–20 (input-capped). Phase 2 has its own envelope (~$100–150).

## 5. Benchmark-support patch set (Dyad changes required)

One small upstreamable PR, three items:

- **P1** — Neon control-plane base URL env override `DYAD_NEON_API_BASE_URL` at the `createApiClient` call sites (`src/neon_admin/neon_management_client.ts:388-395`); today no override exists.
- **P2** — `fixtureAppPath` option in `chat_flow_harness` (absolute path to the template snapshot; today only `e2e-tests/fixtures/import-app/*` names resolve).
- **P3** — harness catalog wiring: `useFakeCatalog:false` + `DYAD_LANGUAGE_MODEL_CATALOG_URL` at a local pinned catalog containing the 7 engine ids and the `auto` provider (today the harness catalog only knows `test-model`).

`E2E_TEST_BUILD` must be **unset** in every benchmark process — if set, Dyad short-circuits to its in-process Neon mock (`neon_management_client.ts:112-113`) and nothing real is exercised; neon-sim only _mirrors_ that mock's endpoint surface.

## 6. Spike plan (gating, in order)

| #       | Spike                                                                   | Falsifiable question                                                                                                                                                                   | Blocks          |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| S-AUTH  | `@neondatabase/auth` vs self-hosted better-auth over `http://localhost` | Does sign-up/sign-in/session work with a non-Neon `NEON_AUTH_BASE_URL`, and do `__Secure-` session cookies survive on trustworthy http://localhost (fallback: mkcert TLS front-proxy)? | Everything      |
| S-SQL   | serverless driver + `dyad-execute-sql` against the SQL proxy            | Tagged queries, `sql.query`, transactions, error shapes, schema introspection, and `ts-pg-schema-diff`'s ssl-pinned TCP path all behave                                                | neon-sim        |
| S-CELL  | One full model × 3-milestone cell through the patched harness           | Wiring end-to-end (P1–P3, catalog, engine proxy, shim) + first real token/cost sample to calibrate the budget gate                                                                     | Runner + budget |
| S-FORMS | 2–3 models against the CRM M1 prompt with verification off              | Do models produce working custom auth forms with the pinned test ids given the AI_RULES note?                                                                                          | App specs       |
| S-SCORE | Snapshot-clone + full CUJ/probe run on the S-CELL checkpoints           | Clones score deterministically; every probe can obtain its target ids from pinned surfaces                                                                                             | Scoring         |

## 7. Run plan

Build phase: 21 cells (7 models × 3 apps), concurrency 2–3, worst case ~60 min/cell ⇒ one working day of wall-clock. Scoring phase decoupled and re-runnable from snapshots. Resume from append-only `runs.jsonl` (code-explorer conventions). Results in `benchmark-results/app-builder/<runId>/` (gitignored), summary auto-written like `benchmarks/code-explorer` does.

## 8. Phase 2 (summary)

Rerun the same 9 checkpoints per model through **Claude Code CLI** (sonnet-5 / opus-5 / fable-5) and **Codex CLI** (sol / terra / luna) from the identical task bundle (same template snapshot, same neon-sim, same prompts, same CUJ scoring, same pricing). Token capture via the same proxy pattern at `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` (Anthropic wire format additionally exposes cache-write counts). Headline run keeps each harness's shipped defaults (that _is_ the product comparison), plus one labeled effort-matched sensitivity cell. grok-4.5 is phase-1 only (no first-party harness). Details in the Phase 2 section.

## 9. Risks & disclosures

- **Fidelity:** neon-sim's branch semantics are template-copies, not copy-on-write; Managed Better Auth's exact wire surface vs stock better-auth is undocumented (S-AUTH gates this). The headless harness omits preview-runtime/browser-console signals and UI approval friction; the packaged smoke bounds this gap.
- **Fairness:** UI-contract prompts favor instruction-following (deliberate, disclosed). Truncation at the timeout ladder is reported separately from failure. Same-vendor judge bias mitigated by the drop-same-vendor panel. Engine-side reasoning-effort defaults recorded per run.
- **Reproducibility:** model endpoints are hosted and drift over time; the benchmark version-pins its catalog file, pricing.json, template snapshot, and prompts, and stamps every run with all four versions.

## 10. Spike findings (2026-07-28/29, all five spikes)

Verdicts: **S-AUTH confirmed 9/9** (self-hosted better-auth 1.4.18 works at a non-Neon
base URL; `__Secure-` cookies survive http://localhost; SDK pins better-auth 1.4.18;
cookie prefix `neon-auth` required; auth errors THROW). **S-SQL confirmed 14/14**
(wire protocol reimplementable; `db.localtest.me` URIs + TLS on 443 need zero
`neonConfig` patching; `ts-pg-schema-diff` handled by a TLS TCP front on 5433).
**neon-sim built** (18 control-plane endpoints, per-branch better-auth in the branch
DB's `neon_auth` schema + `users` compat view, snapshot/clone/reset; smoke 17/17 ×2).
The Dyad patch set shrank to two code changes (`DYAD_NEON_API_BASE_URL`,
`fixtureAppPath`). CUJ suite for checkpoint 1: 12/12 tests implemented.

**Transport findings from the first S-CELL run (load-bearing for the duration metric):**

- ~~The engine serializes requests per API key~~ **Corrected 2026-07-29**: a clean
  3-way concurrent same-key test shows the engine handles parallel requests fine
  (wall 1.9s vs 5.1s summed) — modest cell parallelism is viable. What remains
  true: the engine does not appear to cancel server-side work on client
  disconnect, and an accumulation of leaked/zombie requests (from killed runs or
  a proxy that doesn't propagate aborts) degrades it to the point where even
  small new requests time out.
- Node's fetch (undici) aborts at its default **300s headers timeout** and the AI
  SDK retries silently — one slow/queued response cascades into repeated
  exactly-300s stalls. In the first luna cell this inflated M2 from ~4 min of real
  work to 54 min. Idle-engine baseline: ~1.7s TTFB even on 520KB bodies.
- Requirements adopted: the recording proxy propagates client aborts upstream and
  records `client_abort` rows (stall observability); runs start with an engine
  drain-check probe; kill-and-relaunch during a run is an anti-pattern.
- Corollary for fairness: any per-model duration comparison must first check
  `client_abort` counts — a cell with stalls measures infrastructure, not the model.
- **Tool consents**: headless runs must pre-seed `agentToolConsents` — the default
  "ask" hangs 300s per prompt and then _denies the tool_ (run 3 lost `execute_sql`
  entirely). Policy: `always` for every consent-gated tool **including
  `web_search`/`web_crawl`** (user decision 2026-07-28: product realism over
  run-to-run reproducibility; the same policy applies to phase-2 CLI harnesses,
  and web-content drift is a disclosed reproducibility caveat). Consent keys are
  exact tool names: `execute_sql`, `add_dependency`, `restart_app`, `rebuild_app`,
  `web_search`, `web_crawl`.
- **node-pty is Electron-ABI**: under plain node (vitest) every PTY-run command
  (`add_dependency` → npm) dies with `posix_spawnp failed`. Patch P4:
  `DYAD_DISABLE_PTY=1` child_process fallback in `pty_command_runner.ts`.
- **Build gate is compile/type errors, not lint**: `next build --no-lint` in the
  scorer — the template's eslint import-resolver false-positives on tsconfig
  aliases and package-exports subpaths would fail every model's app.
- **Code explorer disabled headless** (`enableCodeExplorer: false`): it runs as
  an Electron utilityProcess and hangs forever under the harness ("Starting
  code explorer host" then silence — wedged gpt-5.6-sol's cell twice; luna
  never engaged it). Disclosed fidelity gap: models that would use deep
  context lose it here; the packaged-app parity smoke can quantify the effect.
- **End-to-end validation (S-FORMS + S-SCORE, 2026-07-29):** with all fixes,
  cells run clean (luna M1 2 min/$0.15, sonnet-5 6 min/$1.44, grok-4.5
  7 min/$0.71, zero tool failures). Scoring is **deterministic**: sonnet-5
  scored 11/12 CUJs with the identical single failure across two independent
  snapshot-clones; grok-4.5 scored 0/12 for a genuinely broken auth
  architecture (client-side read of a server-only env var) — real
  model-differentiating signal. Cache-write tokens are visible on the engine's
  Anthropic route and priced at 1.25×. Known open item: the scorer's readiness probe
  should distinguish "listening but 500s" from "never listened". (The
  `run_type_checks` headless crash is FIXED — `getTypeScriptCachePath` in
  `src/paths/paths.ts` dereferenced `electron.app` with no non-Electron
  fallback; patch P5 adds the same fallback `getUserDataPath` already had.)

## 10b. Measurement lessons (why the oracle exists)

Twelve distinct harness defects surfaced during the first full run, and every
one of them produced a confident, plausible, wrong number. The four worth
generalising:

1. **Skipped tests counted as passed.** `test.describe.serial` abandons the rest
   of a file after the first failure, and the scorer read the spec-level `ok`
   flag, which is true for a skipped test. 860 of 1052 tests never ran and were
   scored as passing. Fix: read
   `test.results[0].status` and count `ran` separately from `passed`; every suite
   restructured so each test provisions its own state.
2. **A probe that passes everything is worse than no probe.** Three probes were
   testing weaker properties than they advertised — one asserted inside a
   `try/catch` that swallowed its own detection, one accepted any 4xx from an app
   that performed the UPDATE and _then_ answered 403, one accepted a silently
   ignored 200 where the spec pins 403. None of them could fail. 25% of the
   quality score rode on that table.
3. **Infrastructure failure is indistinguishable from model failure unless you
   make it distinguishable.** A generated app's own Playwright install garbage-
   collected the suite's browser mid-run; three cells scored 0/54 and looked like
   models that could not build an app. Fix: `PLAYWRIGHT_SKIP_BROWSER_GC=1`, plus a
   `harness_error` status the scorer emits when every test dies at browser launch,
   so the cell is refused rather than scored zero.
4. **String-matched identifiers rot silently.** The judge resolved a cell's app
   with `cellId.endsWith("-deskhero")`, which quietly fell through to `relay-crm`
   the moment cell ids grew an effort suffix — so a whole sweep's deskhero and
   portalis apps were judged against the wrong spec, and the judge dutifully
   explained that the app "builds a Deskhero ticketing app rather than Relay CRM".
   Fix: match the app segment anywhere in the id and **throw** when it does not
   resolve. Prefer failing loudly over defaulting.

The response to all four is `oracle/` — a reference implementation that must score
100% and a deliberately broken twin whose every probe must fail, enforced per app
_and_ per checkpoint by `oracle/preflight.sh` before any model cell is scored. See
[oracle/README.md](oracle/README.md).

`verify-prompt-extracts.mjs` is the same idea applied to the prompts: it proves
each design doc's verbatim prompt block is a byte-identical extract of the
`specs/<app>/m<N>.md` the runner actually sends, so the documented benchmark and
the executed benchmark cannot drift apart.

### What the oracle measures that reading cannot

Apps 4–6 were built as references **from the specs, never from the tests** — the
reference author may read a test to diagnose a failure but may not implement
something the spec does not ask for. That constraint turns each reference build
into a spec-sufficiency audit, and it found eleven cases the three prior review
rounds had not: tests that required something the milestone prompt never pinned.
Three of them would have failed a fully correct app (a probe demanding 403 for a
field the spec says to _ignore_; a CUJ requiring a rating control to stay
rendered where the spec is silent and says the opposite for its sibling
control; a probe demanding 2xx where one prompt clause mandates 403). The rest
were unpinned DOM nesting, an unpinned sign-up landing route, and endpoint fields
named only by inference.

Each such case is a silent subtraction from a correct app's score, attributed to
the wrong cause. Reading a design catches wording defects; only an implementation
built under the same information the models have catches these.

### Known limits of the negative control

The twins prove every probe _trips_. They do not prove every _assertion within_ a
probe trips, because Playwright abandons a test at its first failed assertion: if
the twin answers 200 where 403 is pinned, the probe fails there and its trailing
"and the data is unchanged" re-reads never execute. The probe verdict is still
correct — an app that returns the right status and mutates anyway does reach
those re-reads — but the invariant legs have no demonstrated negative control.
Closing this needs a second twin variant whose handlers write and _then_ answer
4xx. Recorded rather than fixed.

Two probes are also weaker than they advertise, and are documented as such rather
than quietly relied on:

- `led-m3-s07` claims to be the unique detector of float money. It is not: the
  naive `sum(cents/100) × 100` implementation it targets also breaks the exact
  integers pinned by CUJs `led-m3-01` and `led-m3-08`, so a float-money app fails
  those first. Its money legs are a strictly-less-sensitive duplicate of CUJ
  coverage.
- `curb-m3-s02` (six concurrent claims) is validated as "an app with no claim
  exclusivity at all is caught", not as "a check-then-write race is caught" — a
  deterministic twin cannot demonstrate the latter, since its negative control
  would itself be a race.

### One unpinned requirement, deliberately left unpinned

`@neondatabase/auth`'s Next.js client needs a route handler at
`src/app/api/auth/[...path]/route.ts` exporting `auth.handler()`. Without it every
client call 404s, no session is ever established, and the app scores zero with
nothing logged server-side — it cost one reference build a whole checkpoint. The
shared `AI_RULES.md` note documents the client calls and the server helper but
never mentions the mount.

It stays undocumented, because **all 21 shipped cells mounted it unaided**. Adding
the sentence would remove a hurdle no model actually tripped on, while changing
the shared task bundle midway through the benchmark. The gap is recorded here
instead.

## 11. Doc map

| Document                                                           | Contents                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [design/app-1-relay-crm.md](design/app-1-relay-crm.md)             | App 1 spec: multi-tenant CRM — milestone prompts, CUJ suites, security probes, judge rubric additions     |
| [design/app-2-deskhero.md](design/app-2-deskhero.md)               | App 2 spec: role-based helpdesk — roles/workflow depth                                                    |
| [design/app-3-portalis.md](design/app-3-portalis.md)               | App 3 spec: B2B admin portal — tenancy, audit, hardest security checkpoint                                |
| [design/app-4-ledgerly.md](design/app-4-ledgerly.md)               | App 4 spec: double-entry bookkeeping — money arithmetic, immutability, append-only audit                  |
| [design/app-5-slotline.md](design/app-5-slotline.md)               | App 5 spec: clinic scheduling — derived availability, double-booking, instants                            |
| [design/app-6-curbside.md](design/app-6-curbside.md)               | App 6 spec: delivery marketplace — three asymmetric actor types, atomic claim, server-authoritative money |
| [oracle/README.md](oracle/README.md)                               | The controls: reference app (must be 100%) + broken twin (every probe must fail), and the pre-flight gate |
| [design/neon-sim.md](design/neon-sim.md)                           | Offline Neon stand-in: v2 API shim, SQL proxy, better-auth, snapshots, Dyad patch set, spikes             |
| [design/runner-scoring.md](design/runner-scoring.md)               | Runner, engine recording proxy, scoring pipeline, cost module, results schema, reporting, parity smoke    |
| [design/phase-2-cross-harness.md](design/phase-2-cross-harness.md) | Phase 2: Claude Code / Codex CLI adapters, task bundle, fairness protocol                                 |

All six sections were drafted by parallel design agents, reviewed by an adversarial critique pass (7 contradictions, 12 gaps, 7 fairness threats, 7 budget threats found), and revised against the canonical decisions in §2 — the spike plan in §6 carries the residual risk.
