## Runner, metrics, and scoring

### 0. Decisions at a glance

| Decision                | Choice                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cell execution engine   | **vitest** (one `vitest run` child process per model×app cell), orchestrated by a **plain-node** `run.mjs`                                                                  | The chat-flow harness hard-requires `vi.hoisted` + `vi.mock("electron")` — "they cannot be hidden inside the harness" (src/testing/CHAT_FLOW_HARNESS.md:40-43) — plus `@/` alias resolution and TS transform. Plain node would mean rebuilding vitest's loader + module interception. One harness per process is mandatory (src/testing/chat_flow_harness.ts:69-73, CHAT_FLOW_HARNESS.md:266-269), which maps 1:1 onto "one vitest child process per cell". The orchestrator itself (arg parsing, worker pool, runs.jsonl, resume) is plain node, copying benchmarks/code-explorer/run.mjs:181-203. |
| Request→run attribution | **One recording proxy per cell, in-process**, milestone stamped by the cell                                                                                                 | No attribution patches (the P1–P3 benchmark patch set below is unrelated to attribution). Header injection would require hooking Dyad's outbound header path (`X-Dyad-Request-Id` is minted per turn at src/ipc/handlers/chat_stream_handlers.ts:1439 and rewritten per attempt at src/ipc/utils/llm_engine_provider.ts:210-216 — no clean seam to add run metadata). Env-var URL reads happen at call time (CHAT_FLOW_HARNESS.md:287-289; src/ipc/utils/dyad_engine_url.ts:2; src/ipc/utils/get_model_client.ts:111), so setting `DYAD_ENGINE_URL` in the cell process is sufficient.              |
| Build vs. score         | **Decoupled**: build phase writes checkpoints (git SHAs + DB snapshots + request logs); scoring phase is a separate command that can rerun without re-spending model tokens | Scoring is deterministic-ish and cheap to redo (except judge); builds are expensive. Also required for phase 2, where checkpoints come from Claude Code / Codex CLI instead of the Dyad harness but flow into the _same_ scoring pipeline.                                                                                                                                                                                                                                                                                                                                                          |
| Concurrency             | 2 parallel cells (build), 2 parallel checkpoints (scoring); `--concurrency` capped at 3                                                                                     | Engine rate limits plus local CPU: each scoring checkpoint runs `pnpm install` + `next build`; each build cell may trigger model-driven package installs. Beyond 3, wall-clock numbers get polluted by CPU contention (duration is a reported metric).                                                                                                                                                                                                                                                                                                                                              |

**Benchmark-support patch set — exactly three items, nothing else touches product code:**

- **P1 — Neon base-URL env override.** `DYAD_NEON_API_BASE_URL`, read at the `createApiClient` sites in src/neon_admin/neon_management_client.ts, points all Neon control-plane calls at the neon-sim shim. (This is the only accepted product-code patch; the shim **mirrors** the endpoint surface of the in-process E2E mock but is a separate out-of-process service — see §3.)
- **P2 — `fixtureAppPath` harness option.** A small additive option taking an absolute path to the template snapshot, next to the existing `fixtureApp` resolution at chat_flow_harness.ts:258-261.
- **P3 — harness catalog wiring.** `useFakeCatalog: false` plus `DYAD_LANGUAGE_MODEL_CATALOG_URL` pointed at a local pinned catalog file containing all 7 engine model ids and the `auto` provider. Without this the harness's fake catalog only knows `test-model` and cells cannot select benchmark models (chat_flow_harness.ts:288-330).

**`E2E_TEST_BUILD` must be UNSET in every benchmark process** (build cells, scoring workers, parity smoke). If set, Dyad's in-process Neon mock short-circuits every control-plane call before it reaches the network (src/neon*admin/neon_management_client.ts:112-113) and the shim is never exercised. The neon-sim shim only \_mirrors* that mock's endpoint surface; it does not reuse it.

### 1. Directory layout

```
benchmarks/app-builder/
  BENCHMARK.md                     # results doc; auto-updated section (see §6)
  README.md                        # how to run, env vars, resume
  specs/                           # HARNESS-AGNOSTIC (phase-2 reuse)
    apps/
      crm/
        app.json                   # { id, name, milestones: ["m1","m2","m3"] }
        m1.md  m2.md  m3.md        # exact prompt text, plain markdown, no Dyad wording
      helpdesk/  ...
      admin-portal/  ...
    rubric.md                      # global judge rubric (§4)
  cuj-tests/                       # HARNESS-AGNOSTIC Playwright suites
    playwright.config.mjs          # baseURL from APP_URL env; JSON reporter
    helpers/                       # signup/login/tenant-create via pinned data-testids
    crm/
      m1.cuj.spec.ts  m1.security.spec.ts
      m2.cuj.spec.ts  m2.security.spec.ts   # m2 suite = m1 CUJs + m2 CUJs (cumulative)
      m3.*.spec.ts
    helpdesk/  admin-portal/       # same shape
  catalog/
    engine-models.json             # P3: pinned local model catalog — all 7 engine ids + auto provider
  runner/
    run.mjs                        # build-phase orchestrator (plain node)
    cell.bench.test.ts             # THE one parameterized vitest cell file (env-driven)
    vitest.appbuilder.config.ts    # forks pool, node env, repo aliases (clone of vitest.eval.config.ts wiring; package.json:47)
    score.mjs                      # scoring-phase orchestrator
    judge.mjs                      # judge panel invocation
    summary.mjs                    # summary.md/json, scatter.html, BENCHMARK.md update
    taxonomy.mjs                   # failure classification (§8)
    parity-smoke.mjs               # packaged-app parity (§7)
  proxy/
    engine_recording_proxy.mjs     # §2
    sse_usage.mjs                  # incremental SSE usage extractor (unit-tested)
  pricing/
    pricing.json                   # §5, pinned + FILLED
    cost.mjs                       # per-request cost, tier branching
  .cache/                          # gitignored
    nextjs-template/<sha>/         # pinned template clone (mirrors createFromTemplate.ts:79-156 caching)
    pnpm-store/                    # shared pnpm store for all installs
```

Results land outside the repo tree in the existing gitignored root, following code-explorer (benchmarks/code-explorer/run.mjs:22) and the compaction eval (src/**tests**/evals/compaction.eval.ts:93):

```
benchmark-results/app-builder/<run-id>/        # run-id = run-<ISO ts>, code-explorer format (run.mjs:56)
  runs.jsonl                                   # append-only, one row per checkpoint (§6)
  meta.json                                    # git SHA, dirty flag, command line, template SHA, pricing version
  cells/<model>__<app>/
    requests.jsonl                             # proxy capture (§2)
    app.git/                                   # bare clone of the built app repo (all tags)
    messages.json                              # chat transcript dump from harness.db
    cell.log                                   # vitest child stdout/stderr
  scoring/<model>__<app>__m<k>/
    build.log  server.log
    cuj-report.json  security-report.json      # Playwright JSON reporter output
    judge/<judgeId>.json                       # one file per cross-vendor panelist (§4)
  scores.jsonl                                 # one row per scored checkpoint
  summary.md  summary.json  scatter.html
```

`specs/` and `cuj-tests/` contain nothing Dyad-specific: prompts are plain instructions any coding agent can act on (routes + data-testid contract), and CUJ suites only need `APP_URL`. Phase 2 swaps `runner/cell.bench.test.ts` for a CLI driver and reuses everything else.

New package.json scripts (alongside the existing `benchmark:code-explorer` family, package.json:60-63):

```
"benchmark:app-builder":        "node benchmarks/app-builder/runner/run.mjs",
"benchmark:app-builder:score":  "node benchmarks/app-builder/runner/score.mjs",
"benchmark:app-builder:parity": "node benchmarks/app-builder/runner/parity-smoke.mjs"
```

### 2. Engine recording proxy

`proxy/engine_recording_proxy.mjs` exports `startRecordingProxy({ upstreamEngineUrl, upstreamGatewayUrl, captureFile, context, pricing, cellCeilingUsd })`:

- Plain `node:http` server on an ephemeral port (`listen(0, "127.0.0.1")`), started **inside the cell process** in `beforeAll`, before `setupChatFlowHarness`. The cell then sets `process.env.DYAD_ENGINE_URL = proxy.url + "/engine/v1"` and `DYAD_GATEWAY_URL = proxy.url + "/gateway/v1"` — the same two-mount shape the harness's fake server uses (src/testing/chat_flow_harness.ts:295-298). The cell does **not** pass `engine: true` (that would point at the fake LLM server instead). Defaults: upstream engine = `https://engine.dyad.sh/v1` (the product default, src/ipc/utils/dyad_engine_url.ts:2), overridable via `APP_BUILDER_UPSTREAM_ENGINE_URL` for the Codex-proxy phase-2 path (pattern: benchmarks/code-explorer/run.mjs:621-679). All seven phase-1 models route through this same proxy to engine.dyad.sh — **including grok-4.5, whose phase-1 upstream is the Dyad engine id `openrouter/x-ai/grok-4.5`** (priced at xAI list, §5).
- **Streaming pass-through**: forward method/headers/body via `fetch` (strip `host`/`connection`/`content-length`), pipe upstream response bytes to the client unmodified as they arrive, and tee them into `sse_usage.mjs` — an incremental SSE parser that scans `data:` events for a `usage` object and keeps the **last one seen** (OpenAI-style final chunk with empty `choices` and usage, the exact shape code-explorer's proxy emits at run.mjs:958-967). Non-streaming JSON responses: parse `body.usage`. The proxy never buffers the whole stream; TTFB and pacing are preserved so duration metrics stay honest.
- **Live budget enforcement (per C9)**: after each request row is finalized, the proxy prices it with `cost.mjs` against the pinned `pricing.json` and accumulates a running per-cell dollar total. When the total crosses the **$40 per-cell ceiling**, the proxy aborts the in-flight upstream request, refuses further upstream calls with a synthetic 402, and signals the cell — the milestone ends with outcome `budget_abort` (§8); the checkpoint (commit/tag + DB snapshot) is still taken and scored as-is, flagged. The orchestrator additionally sums live totals across cells and triggers the **$300 global kill-switch** (stop scheduling, abort running cells → `budget_abort`).
- **Per-request JSONL row**, appended to `cells/<cellId>/requests.jsonl` on response end:

```jsonc
{
  "ts": "2026-07-28T18:02:11.482Z",
  "cellId": "anthropic__claude-opus-5__crm",   // from proxy context
  "milestone": 2,                              // stamped via proxy.setContext({milestone}) before each turn
  "requestId": "5f0c…:attempt-1",              // X-Dyad-Request-Id, set by Dyad's fetch wrapper (llm_engine_provider.ts:242-244); uuid per turn (chat_stream_handlers.ts:1439), ":attempt-N" suffix per retry (llm_engine_provider.ts:210-216)
  "path": "/engine/v1/chat/completions",
  "model": "anthropic/claude-opus-5",          // from parsed request body
  "reqBytes": 183220, "reqMessages": 14,
  "status": 200, "ttfbMs": 412, "totalMs": 38110,
  "usage": {                                   // normalized from final SSE chunk
    "prompt_tokens": 41210,
    "cached_tokens": 36800,                    // usage.prompt_tokens_details.cached_tokens
    "completion_tokens": 1290
  },
  "usageRaw": { ... },                         // FULL usage payload verbatim — retains cache-write fields if the engine forwards them (§5)
  "costUsd": 0.1042,                           // priced live for the $40 ceiling (§5)
  "error": null
}
```

- **Tagging: proxy-per-cell, not run-id header injection.** Because each cell is its own OS process with its own proxy and capture file, attribution to (model, app) is structural; milestone attribution is a `setContext` call between turns; `requestId` is recorded purely to join rows to chat turns and to count transport retries (same uuid, higher `attempt`). Injecting a run id into outbound headers would need a product patch with no existing hook, and a single shared proxy would need exactly that header to demux — rejected.
- Judge traffic (§4) goes through a **separate** proxy instance with its own capture file (`scoring/…/judge-requests.jsonl`) so evaluation spend is never mixed into model cost.

### 3. Run orchestration (build phase)

`run.mjs` flags: `--models`, `--apps`, `--concurrency` (default 2, max 3), `--resume-from <run-id>`, `--retry-from <run-id>`, `--dry-run` — semantics cloned from code-explorer (run.mjs:24-46, 232-347).

**Pre-stage (once per run):**

1. Clone `dyad-sh/nextjs-template` at a pinned SHA into `.cache/nextjs-template/<sha>/` (same cache-then-copy approach as the product, src/ipc/handlers/createFromTemplate.ts:79-156); record `templateSha` in `meta.json`. The snapshot ships the task-bundle `AI_RULES.md` auth note (authClient.signUp.email/signIn.email/signOut + createNeonAuth server helper — identical for every model and harness).
2. `pnpm install --store-dir benchmarks/app-builder/.cache/pnpm-store` inside the cached template once, so every cell's install is a hard-link copy.
3. Verify neon-sim is up (control-plane health endpoint); verify `DYAD_PRO_KEY` is set (fail-fast like run.mjs:138-142); **assert `E2E_TEST_BUILD` is unset in the orchestrator env and delete it from every child env** (§0 — otherwise the in-process Neon mock short-circuits the shim, neon_management_client.ts:112-113).
4. **Projected-cost gate (C9)**: multiply the cell matrix by per-milestone token projections at pinned prices; refuse to start if the projection exceeds the run budget (`--force-budget` to override, recorded in meta.json).

**Cell matrix**: 7 models × 3 apps = 21 cells; N=1. The worker pool (2-3 workers) pulls cells off a shared index, exactly the `runTrials` loop at run.mjs:181-203. Each cell = `spawn("npx", ["vitest", "run", "--config", "runner/vitest.appbuilder.config.ts", "runner/cell.bench.test.ts"])` with env: `APP_BUILDER_MODEL`, `APP_BUILDER_APP`, `APP_BUILDER_CELL_DIR`, `APP_BUILDER_RESULTS_FILE`, `DYAD_PRO_KEY`, `DYAD_NEON_API_BASE_URL` (the P1 override, pointed at neon-sim), `DYAD_LANGUAGE_MODEL_CATALOG_URL` (P3, pointed at `catalog/engine-models.json`), with `E2E_TEST_BUILD` explicitly deleted, plus a hard orchestrator-side kill at 90 min/cell (the three milestone turn caps alone sum to 60 min, §8). Reasoning-effort settings are **Dyad's product defaults per model** — not tuned — recorded per run in runs.jsonl (`reasoningEffort`) and disclosed in the summary (C10). grok-4.5's upstream is the engine id `openrouter/x-ai/grok-4.5` through engine.dyad.sh (§2); phase 2 gets its own budget envelope (~$100-150) plus one effort-matched sensitivity cell.

**Inside `cell.bench.test.ts`** (standard harness preamble, CHAT_FLOW_HARNESS.md:45-81):

1. Start recording proxy; set `DYAD_ENGINE_URL`/`DYAD_GATEWAY_URL` at it (§2). `DYAD_NEON_API_BASE_URL=<neon-sim>` is already in the env (P1, the minimal product patch making the `createApiClient` base URL in src/neon_admin/neon_management_client.ts env-overridable); `E2E_TEST_BUILD` is unset so the in-process mock stays dead.
2. `setupChatFlowHarness` with: the pinned template as the app checkout via **P2** (`fixtureAppPath: <absolute path>`, next to the existing `fixtureApp` resolution at chat_flow_harness.ts:258-261); **P3 catalog wiring** — `useFakeCatalog: false` so the harness loads the real catalog path, with `DYAD_LANGUAGE_MODEL_CATALOG_URL` pointed at the pinned local `catalog/engine-models.json` containing all 7 engine model ids and the `auto` provider (without this the harness only knows `test-model`, chat_flow_harness.ts:288-330, and cells cannot select benchmark models); and settings for real Pro local-agent mode: `selectedModel: { provider: "auto", name: <engine model id> }`, `settings: { enableDyadPro: true, providerSettings: { auto: { apiKey: { value: DYAD_PRO_KEY } } } }` (the same settings shape code-explorer seeds via `set-user-settings`, run.mjs:1278-1288). The harness already fakes the Pro user-info endpoint so nothing hits api.dyad.sh (chat_flow_harness.ts:291-294). Every `streamChat` passes `requestedChatMode: "local-agent"` explicitly (required for Pro-mode harness chats, CHAT_FLOW_HARNESS.md:296-299).
3. **Connect neon-sim through the product path**: create a project via the neon-sim control plane (the shim **mirrors** the endpoint surface of the in-process E2E mock, src/neon_admin/neon_management_client.ts:113-359, but is its own service reached via `DYAD_NEON_API_BASE_URL`), write `neonProjectId`/`neonBranchId` onto the apps row via `harness.db` (the fields neon_handlers sets at src/ipc/handlers/neon_handlers.ts:255), then call the real `autoInjectNeonEnvVars` (src/ipc/utils/neon_utils.ts:222 → `updateNeonEnvVars`, src/ipc/utils/app_env_var_utils.ts:210,241-248) so `.env.local` gets `DATABASE_URL`/`NEON_AUTH_BASE_URL`/`NEON_AUTH_COOKIE_SECRET` exactly as the product writes them.
4. `pnpm install --store-dir <shared>` in `harness.appDir`; commit lockfile churn if any.
5. **Three sequential milestones.** For milestone k: `proxy.setContext({ milestone: k })`; read `specs/apps/<app>/m<k>.md`; `Promise.race([harness.streamChat(prompt, { requestedChatMode: "local-agent" }), sleep(capMin)])` where **capMin = 15 for M1, 20 for M2, 25 for M3** (C5); on cap invoke the `chat:cancel` handler (typed envelope, CHAT*FLOW_HARNESS.md:295) and classify `truncated`; a proxy budget signal (§2) likewise cancels the turn and classifies `budget_abort`. After the turn (any outcome except infra crash): `git add -A && git commit --allow-empty -m "checkpoint m<k> (<status>)"` then `git tag checkpoint-m<k>` in `harness.appDir` (git helper pattern chat_flow_harness.ts:219-225) — local-agent auto-commits approved changes, the extra commit catches stragglers from terminal tools. Record the SHA. **Then capture the database checkpoint (C6)**: ask the shim to run `CREATE DATABASE cell*<cellId>\_ckpt<k> TEMPLATE <dev_db>`— a cheap Postgres template copy that also carries the`neon_auth` schema — and record the snapshot name in the milestone row. **A failed milestone does not stop the cell**: milestone k+1 runs against whatever state exists (keeps all 9 checkpoints per model comparable and mirrors real usage).
6. Teardown: dump chat messages to `messages.json`, `git clone --bare appDir cells/<cellId>/app.git` (preserves all tags/SHAs for scoring), `harness.dispose()`.
7. The cell appends one row per milestone to `runs.jsonl` (schema §6) as each milestone finishes — append-only, so a killed cell leaves its completed milestones behind.

**Retry & resume.** Error classification per §8. `infra_error` at any point aborts the cell (post-crash git/db state is untrustworthy) and the orchestrator re-queues the whole cell once (`attempt: 2`, fresh app dir); milestone rows from the aborted attempt stay in runs.jsonl with their status. `--resume-from` re-emits rows whose cells are complete (all 3 milestone rows in a terminal state: `ok`/`agent_gave_up`/`truncated`/`budget_abort`) and re-runs the rest from scratch — same preserved/re-run split as code-explorer's `loadResumedRows`/`buildResumeMatrix` (run.mjs:266-324). Model-behavior failures (`agent_gave_up`, `truncated`) and `budget_abort` are **never** retried: N=1 means the first sample is the sample.

### 4. Scoring pipeline (decoupled)

`score.mjs --run <run-id> [--checkpoints <filter>] [--skip-judge]` reads `runs.jsonl`, iterates the up-to-63 checkpoint SHAs with a 2-worker pool, appends to `scores.jsonl` (resumable by checkpoint key). Per checkpoint:

1. **Checkout**: `git clone cells/<cellId>/app.git <tmp> && git checkout <sha>` (clone-per-checkpoint rather than worktree because two workers may score the same cell's m1/m2 concurrently).
2. `pnpm install --store-dir <shared>` (lockfile may differ per checkpoint — the model may have added deps).
3. **Database from snapshot-clone (C6)**: each scoring attempt clones the milestone's build-time snapshot — the shim runs `CREATE DATABASE scoring_<cellId>_ckpt<k>_a<n> TEMPLATE cell_<cellId>_ckpt<k>` — and a scoring-scoped neon-sim project is bound to the clone (its per-project better-auth instance mounts over the cloned `neon_auth` schema; instance lifecycle per the shim's keyed-mount/teardown contract, safe under the 2-worker concurrency). `.env.local` is written via the same `updateNeonEnvVars` helpers. Schema and auth data therefore arrive _by copy_, never by replay: **no `migrations/*.sql` files exist in Dyad-built checkouts** (neon_prompt.ts forbids manual migration files), and the shim's per-app SQL ledger from `dyad-execute-sql` traffic is retained as a **diagnostic only**, not a reconstruction mechanism. Pre-existing build-phase data in the clone is harmless because CUJ suites are self-contained with RUN_ID-suffixed identities/records. Record `dbSource: "snapshot-clone"` plus the snapshot/clone names.
4. `pnpm exec next build` (20-min cap). **Build failure ⇒ `buildStatus:"failed"`, CUJ and security components score 0, but the judge still runs** (it sees the diff + build error, so a near-miss still differentiates from an empty checkpoint).
5. `pnpm exec next start -p <port>`; poll `GET /` until 200 (120 s cap; failure to boot = `buildStatus:"boot_failed"`, treated like build failure).
6. `npx playwright test cuj-tests/<app>/m<k>.cuj.spec.ts --reporter=json` with `APP_URL=http://localhost:<port>` (Playwright Chromium; localhost is a trustworthy origin — SPIKE S-AUTH settles the `__Secure-` cookie question, with the mkcert TLS front-proxy at `https://localhost:<port>` as the fallback), then `m<k>.security.spec.ts` the same way. Suites are fully self-contained (sign-up, tenant/record creation through the UI; security probes create two users/tenants then attempt cross-tenant/role-escalation access, obtaining every target id **only from pinned surfaces**: `/api/me`, pinned list APIs' id fields, `data-user-id`/`data-project-id` attributes). Reports saved verbatim.
7. Teardown: kill server, drop the scoring clone + scoring-scoped sim project (the shim tears down its better-auth instance and closes pools), rm the git clone.

**Judge invocation** (`judge.mjs`): the panel is **three fixed judges — `gpt-5.6-terra`, `anthropic/claude-opus-5`, `gemini-3.6-flash`** (all in Dyad's catalog), called directly via `POST ${DYAD_ENGINE_URL}/chat/completions` with `DYAD_PRO_KEY` (same single-credential model as the eval suite, src/**tests**/evals/README.md:22-24), through the judge-side recording proxy. **Each candidate checkpoint is scored by the TWO cross-vendor judges — the same-vendor judge is dropped**: Anthropic candidates → terra + gemini-3.6-flash; OpenAI candidates → opus + gemini-3.6-flash; grok-4.5 → terra + opus. Inputs per checkpoint are **hard-capped: ≤40 K chars of milestone diff** (`git diff checkpoint-m<k-1>..checkpoint-m<k>`, m0 = template SHA, API routes/schema prioritized) **+ ≤20 K chars of selected source files** (auth/middleware/db), plus the milestone prompt, file tree, the CUJ + security JSON results summary, and build status. Output: strict JSON `{ bugs, security, code_quality, schema_quality, rationale }`, each 0-10, parsed with one re-prompt on invalid JSON. Global rubric outline (specs/rubric.md):

- **bugs (0-10)** — does the implementation match the milestone spec; runtime errors, broken flows, unhandled edge cases.
- **security (0-10)** — server-side tenant scoping on every query, role checks enforced in API routes (not just UI), authn on all mutating endpoints, no secrets/IDs leaked client-side.
- **code_quality (0-10)** — structure, duplication, typing, dead code, error handling.
- **schema_quality (0-10)** — sensible normalization, tenant-scoping columns + constraints/indexes; schema evolution judged from the SQL visible in the diff (no migration files exist in Dyad-built checkouts).

Judge score = mean of the four dims ÷ 10, **averaged across the checkpoint's two cross-vendor panelists**; if one panelist infra-fails after one retry, use the other and set `judgePanel:"partial"`. Checkpoint score = `0.60·cujPassRate + 0.25·securityPassRate + 0.15·judgeScore`.

### 5. Cost module

`pricing/pricing.json` — pinned, **shipped filled** (per 1M tokens), reviewed by hand, never fetched at runtime:

```jsonc
{
  "pricingVersion": "2026-07-28", // pinned-date label, stamped into every runs.jsonl row
  "models": {
    "gpt-5.6-sol": {
      "source": "https://openai.com/api/pricing/",
      "inPerM": 5.0,
      "cachedInPerM": 0.5,
      "outPerM": 30.0,
    },
    "gpt-5.6-terra": {
      "source": "https://openai.com/api/pricing/",
      "inPerM": 2.5,
      "cachedInPerM": 0.25,
      "outPerM": 15.0,
    },
    "gpt-5.6-luna": {
      "source": "https://openai.com/api/pricing/",
      "inPerM": 1.0,
      "cachedInPerM": 0.1,
      "outPerM": 6.0,
    },
    "anthropic/claude-sonnet-5": {
      "source": "https://claude.com/pricing#api",
      "note": "INTRO pricing until 2026-08-31 — pinned on the pin date, labeled in every summary",
      "inPerM": 2.0,
      "cachedInPerM": 0.2,
      "outPerM": 10.0,
      "cacheWritePerM": 2.5,
    },
    "anthropic/claude-opus-5": {
      "source": "https://claude.com/pricing#api",
      "inPerM": 5.0,
      "cachedInPerM": 0.5,
      "outPerM": 25.0,
      "cacheWritePerM": 6.25,
    },
    "anthropic/claude-fable-5": {
      "source": "https://claude.com/pricing#api",
      "inPerM": 10.0,
      "cachedInPerM": 1.0,
      "outPerM": 50.0,
      "cacheWritePerM": 12.5,
    },
    "openrouter/x-ai/grok-4.5": {
      "source": "https://docs.x.ai/pricing", // xAI list; upstream is engine.dyad.sh, id openrouter/x-ai/grok-4.5 (§2)
      "note": "tier picked per request by total prompt_tokens; the >=200K tier RE-PRICES THE WHOLE REQUEST",
      "tiers": [
        {
          "maxPromptTokens": 200000,
          "inPerM": 2.0,
          "cachedInPerM": 0.3,
          "outPerM": 6.0,
        },
        {
          "abovePromptTokens": 200000,
          "inPerM": 4.0,
          "cachedInPerM": 0.6,
          "outPerM": 12.0,
        },
      ],
    },
  },
}
```

(`cacheWritePerM` = 1.25 × `inPerM`, Anthropic list, 5-min TTL.)

`cost.mjs` computes cost **per request row, then sums** — required for correct tiering:

```
uncached_in = usage.prompt_tokens − usage.cached_tokens
cost_req    = uncached_in × P_in + cached_tokens × P_cached + completion_tokens × P_out
            + cache_write_tokens × P_cacheWrite            // only when visible, see below
```

Same shape as the existing `usageCost` (benchmarks/code-explorer/pricing.mjs:18-25), extended with the cache-write term. **grok-4.5 tier branch**: pick the tier per request by total `prompt_tokens` (cached + uncached) vs. 200 000; the selected tier re-prices the **entire request** (all input and output tokens), not just the tokens above the boundary — a single conversation crosses the boundary mid-run, so per-request selection is the only correct granularity. This tier premium is a disclosed cost-model caveat.

**Cache-write & the engine-visibility caveat.** The engine speaks OpenAI-compat usage (`prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`). Anthropic cache-write tokens (`cache_creation_input_tokens`) are billed at 1.25× input but appear only if the engine forwards them inside the usage payload. The proxy retains `usageRaw` verbatim (§2); `cost.mjs` looks for cache-write fields under known keys (`cache_creation_input_tokens`, `prompt_tokens_details.cache_creation_tokens`) and adds the term when present. When absent for an Anthropic model, the summary flags the cost as a **lower bound** (`cacheWriteVisible: false` column) rather than silently under-reporting — this cache-write invisibility through the OpenAI-compat usage payload is the second disclosed cost-model caveat. Uncached-input is always derived by subtraction, never trusted from a separate field.

**Budget guards (C9).** Three layers, all driven by this module: (1) the **pre-run projected-cost gate** in `run.mjs` (§3 pre-stage step 4); (2) the **live per-cell $40 ceiling** enforced by the recording proxy, which prices every finished request and aborts the cell into `budget_abort` on breach (§2); (3) the **$300 global kill-switch** in the orchestrator over the summed live totals. Phase 2 runs under its own envelope (~$100-150) plus one effort-matched sensitivity cell (C10).

**Steps/checkpoint** = the number of request rows for that milestone in `requests.jsonl` (each row is one engine round-trip; transport retries are visible as `:attempt-N` suffixes on the same uuid and counted separately as `transportRetries`).

### 6. runs.jsonl schema and summary generation

One row per checkpoint (append-only; the scoring pass writes `scores.jsonl`, joined on `cellId`+`milestone`):

```jsonc
{
  "schemaVersion": 1,
  "runId": "run-2026-07-28T17-00-00-000Z",
  "cellId": "anthropic__claude-opus-5__crm",
  "attempt": 1, // 2 after an infra retry
  "harness": "dyad-headless", // phase 2: "claude-code" | "codex-cli"
  "model": "anthropic/claude-opus-5",
  "app": "crm",
  "milestone": 2,
  "status": "ok", // ok | agent_gave_up | truncated | budget_abort | infra_error  (§8)
  "errorClass": null,
  "error": null,
  "startedAt": "…",
  "endedAt": "…",
  "wallClockMs": 421000, // full milestone incl. commit/snapshot
  "chatTurnMs": 402113, // streamChat only
  "turnCapMin": 20, // milestone ladder: M1 15 / M2 20 / M3 25 (C5)
  "reasoningEffort": "medium", // Dyad's product default for this model, recorded + disclosed (C10)
  "sha": "9ab41c…",
  "tag": "checkpoint-m2",
  "dbSnapshot": "cell_anthropic__claude-opus-5__crm_ckpt2", // CREATE DATABASE … TEMPLATE snapshot (C6)
  "steps": 14, // request count for this milestone
  "transportRetries": 1, // extra :attempt-N rows
  "tokens": {
    "uncachedInput": 88210,
    "cachedInput": 512400,
    "output": 21930,
    "cacheWrite": null,
  }, // null = not visible from engine
  "costUsd": 1.8342,
  "costIsLowerBound": true,
  "pricingVersion": "2026-07-28",
  "requestLog": "cells/anthropic__claude-opus-5__crm/requests.jsonl",
  "appRepo": "cells/anthropic__claude-opus-5__crm/app.git",
  "meta": { "dyadGitSha": "…", "templateSha": "…", "neonSimVersion": "…" },
}
```

`scores.jsonl` row: `{ cellId, milestone, sha, buildStatus, dbSource, dbClone, cuj: {passed, total, failedIds}, security: {passed, total, failedIds}, judge: { panel: ["gpt-5.6-terra","gemini-3.6-flash"], perJudge: {...}, avg, panelStatus }, checkpointScore, reports: {...paths} }`.

**`summary.mjs`** (run automatically after scoring; re-runnable) produces:

1. `summary.md` / `summary.json` — headed by run metadata (git SHA, dirty flag, command, pricing version — mirroring `buildRunMetadata`, run.mjs:2061-2091), then the per-model table:

```
| Model | Score % | CUJ % | Sec % | Judge | $/app | Tokens/app (unc-in / cached-in / out) | Min/app | Steps/ckpt | Ckpts scored | Failures |
```

Score % = mean of that model's 9 checkpoint scores over **scored** checkpoints; `Ckpts scored` shows `n/9` and any model with n<9 gets a footnote naming the missing checkpoints and why (§8). `$/app`, tokens/app, min/app = totals ÷ 3 apps. Sonnet-5's intro-pricing note, any `costIsLowerBound` flags, per-model reasoning-effort settings, and any `truncated`/`budget_abort` checkpoints render as table footnotes.

2. `scatter.html` — score-vs-cost scatter, one point per model (x = $/app log-scale, y = Score %), fully self-contained static HTML with inline SVG/JS (no CDN), point labels + hover detail per app.

3. **BENCHMARK.md auto-update**: `benchmarks/app-builder/BENCHMARK.md` contains `<!-- app-builder:results:start -->` / `<!-- app-builder:results:end -->` markers; summary.mjs replaces only the delimited block with the latest per-model table + run id + pricing version, leaving hand-written analysis around it intact. Refusing to write if markers are missing (fail loud, don't append).

### 7. Packaged-app parity smoke

`parity-smoke.mjs`: 2 runs of one fixed cell slice (default `gpt-5.6-luna` × `crm` × milestone 1 only — cheapest reasonable pair) against the **packaged** Electron build:

- Launch via `electron-playwright-helpers` `findLatestBuild`/`parseElectronApp` + `_electron.launch` with a temp `--user-data-dir` (exact pattern: benchmarks/code-explorer/run.mjs:1218-1250), env: `DYAD_ENGINE_URL`/`DYAD_GATEWAY_URL` → a recording proxy, `DYAD_NEON_API_BASE_URL` → neon-sim, `DYAD_PRO_KEY`. The build must be packaged **without** `E2E_TEST_BUILD` and the variable is deleted from the launch env (C1 — a test build's in-process Neon mock would short-circuit the shim). Package freshness asserted like run.mjs:2042-2059.
- Drive the UI through the **e2e page objects** — `PageObject.sendPrompt` (e2e-tests/helpers/page-objects/PageObject.ts:764) / `ChatActions.sendPrompt` + `ChatActions.waitForChatCompletion` (e2e-tests/helpers/page-objects/components/ChatActions.ts:131, :99). Explicitly **not** the code-explorer style `page.evaluate(invoke("chat:stream"))` (run.mjs:1364-1369): that renderer-side IPC path is broken on main; the page-object path is what the product exercises.
- App creation via the real new-app flow from the template; neon connect via the settings UI against neon-sim; then milestone-1 prompt, commit+tag+snapshot, score the checkpoint through the normal §4 pipeline.
- **Pass criteria**, per smoke run vs. the headless run's m1 checkpoint for the same model/app: (a) the CUJ **pass-set is equal** (identical set of passing test ids, not just equal counts); (b) total tokens (uncached-in + cached-in + out) within **±15%**. Result recorded in `summary.md` as a `Parity` section (`pass`/`fail` + the two deltas); a parity failure does not invalidate the run but blocks publishing BENCHMARK.md numbers until explained.

### 8. Failure taxonomy — recording and surfacing

Classification lives in `taxonomy.mjs`; every failure is a **typed row**, nothing is dropped or retried into silence:

| Class           | Detection                                                                                                                                                                                                   | Recorded                                                                                                                        | Retry                                                                             | Scoring                                                                                     | Report surface                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `infra_error`   | Proxy/upstream 5xx or 429-exhaustion after SDK retries; neon-sim or fake-endpoint unreachable; harness setup throw; vitest child crash/OOM; orchestrator kill at the 90-min cell cap                        | runs.jsonl row `status:"infra_error"` + `errorClass` (`engine_5xx`, `rate_limited`, `sim_down`, `harness_crash`, `cell_killed`) | **Cell retried once** from scratch (`attempt:2`); both attempts' rows kept        | Not scored; never averaged as 0 (would conflate infra with model quality)                   | "Incomplete cells" table; model Score % footnoted `n/9`                   |
| `agent_gave_up` | Stream ended cleanly but working tree SHA == previous checkpoint SHA (no file changes) or assistant declined/asked questions                                                                                | `status:"agent_gave_up"`, checkpoint tag still created (state = previous)                                                       | Never (model behavior, N=1)                                                       | **Scored normally** — milestone-k CUJs fail against the stale app, judge sees an empty diff | Counted in `Failures` column; listed per-checkpoint in a Failures section |
| `truncated`     | Milestone turn cap fires (`Promise.race` at 15 min M1 / 20 min M2 / 25 min M3, C5); `chat:cancel` invoked; tree snapshotted as `checkpoint-m<k>` with `(truncated)` commit message; DB snapshot still taken | `status:"truncated"`, partial work preserved in the tag                                                                         | Never                                                                             | **Scored as-is and flagged** — partial implementations earn partial CUJ credit              | Same as `agent_gave_up`, with `chatTurnMs` and the cap shown              |
| `budget_abort`  | Recording proxy's live per-cell cost meter crosses the $40 ceiling mid-milestone (or the $300 global kill-switch fires); in-flight turn cancelled, further upstream calls refused                           | `status:"budget_abort"`, checkpoint tag + DB snapshot still created from current state                                          | Never                                                                             | **Scored as-is and flagged**                                                                | Failures section + dedicated line in the cost section of summary.md       |
| `build_failed`  | Scoring phase: `next build` non-zero or server boot failure (`boot_failed`)                                                                                                                                 | scores.jsonl `buildStatus`, build.log path                                                                                      | Scoring step retried once only for clearly-infra causes (e.g. ENOSPC), else final | CUJ = 0, security = 0, **judge still runs** → checkpoint score = 0.15·judge                 | Failures section links build.log; per-model `Build fails` count           |

Summary rule: every non-`ok` runs.jsonl row and every non-`ok` buildStatus appears verbatim (model / app / milestone / class / first line of error) in summary.md's **Failures** section — the report is only publishable when the failure ledger and the per-model `n/9` footnotes reconcile exactly with the row counts, which `summary.mjs` asserts before writing.

---

**Repo facts relied on**: harness options and constraints (src/testing/chat_flow_harness.ts:69-73, :135 `provider.apiBaseUrl`, :157 `engine`, :258-261 fixture resolution, :288-330 catalog wiring, :291-298 env wiring, :304-315 settings seeding; src/testing/CHAT_FLOW_HARNESS.md:40-43, :266-269, :287-289, :295-299); engine URL call-time reads (src/ipc/utils/dyad_engine_url.ts:2, src/ipc/utils/get_model_client.ts:111); request-id header lifecycle (src/ipc/handlers/chat_stream_handlers.ts:1439; src/ipc/utils/llm_engine_provider.ts:184-191, :210-216, :242-244); orchestration/resume/summary/package-freshness patterns and Codex proxy (benchmarks/code-explorer/run.mjs:22, :56, :138-142, :159, :181-203, :232-347, :621-679, :958-967, :1218-1250, :1278-1288, :1364-1369, :1862-2091, :2042-2059); cost formula precedent (benchmarks/code-explorer/pricing.mjs:18-25); results-dir + append conventions (src/**tests**/evals/compaction.eval.ts:93, :115-116); single-credential engine access for evals/judge (src/**tests**/evals/README.md:22-24); Neon env-injection path (src/ipc/utils/neon_utils.ts:222; src/ipc/utils/app_env_var_utils.ts:210, :241-248; src/ipc/handlers/neon_handlers.ts:255); Neon mock surface mirrored by the shim + `E2E_TEST_BUILD` short-circuit (src/neon_admin/neon_management_client.ts:112-113, :113-359); no manual migration files in Dyad-built apps (src/prompts/neon_prompt.ts); template cache-clone flow (src/ipc/handlers/createFromTemplate.ts:79-156); e2e page objects (e2e-tests/helpers/page-objects/PageObject.ts:764; e2e-tests/helpers/page-objects/components/ChatActions.ts:99, :131); existing scripts (package.json:47, :60-63).
