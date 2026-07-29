# Compaction Quality Benchmark

> Goal: measure the quality of Dyad's context-compaction summaries across candidate models
> (initially `gpt-5.6-sol` vs `gpt-5.6-luna`), on realistic long AI-coding chats, so we can
> decide whether to pin a dedicated compaction model instead of reusing the user's chat model.

## Grounding: what exists today

- **Compaction pipeline** (`src/ipc/handlers/compaction/compaction_handler.ts`): when a Pro
  local-agent chat crosses the threshold (`getCompactionThreshold` in
  `src/ipc/utils/token_utils.ts` — min(250k, contextWindow − 25k); 190k for Google),
  `performCompaction` formats all pre-boundary messages via `formatAsTranscript`
  (`compaction_storage.ts` — XML transcript, tool results truncated to
  `TOOL_RESULT_TRUNCATION_LIMIT = 1000` chars), sends it with `COMPACTION_SYSTEM_PROMPT`
  (`src/prompts/compaction_system_prompt.ts`) and the user message
  `"Please summarize the following conversation:\n\n${conversationText}"`, and inserts the
  streamed summary as a `<dyad-compaction>` assistant message.
- **Model selection today**: `compaction_handler.ts:202` — always
  `getModelClient(settings.selectedModel, …)`. Not configurable. Sub-agents by contrast pin a
  model (`explore_code_subagent.ts:63` — `{ provider: "openai", name: "gpt-5.6-luna" }`), which
  is the pattern we'd copy if this benchmark shows a clear winner.
- **No quality measurement exists**: current tests are structural only (storage format, boundary
  filtering, orchestration mocks). Nothing exercises `COMPACTION_SYSTEM_PROMPT` output quality.
- **Reusable eval harness** (`src/__tests__/evals/`, `npm run eval`): the chat-history benchmark
  (PR #4007) established the machinery we reuse wholesale —
  `get_eval_model.ts` (Dyad Engine gateway adapter; forces `stream: true` + SSE reassembly
  because the engine 500s on non-streaming), `DYAD_PRO_API_KEY` gating (bridged from
  `DYAD_PRO_KEY`), concurrency gate (engine 429s above ~4), `*_RESUME`/`*_SMOKE`/`*_ONLY` env
  filters, results appended to `benchmark-results/<name>/<run>/results.jsonl` + `summary.md`,
  never failing vitest on wrong answers.
- **Model availability**: confirmed by smoke test (2026-07-28) — both `gpt-5.6-sol` and
  `gpt-5.6-luna` return valid streamed completions from `https://engine.dyad.sh/v1` with the
  Dyad Pro key. (`gpt-5.6-luna` is also already the production sub-agent model.)

## What "compaction quality" means

A compaction summary is good iff the agent can **keep working** after the swap. Concretely:

1. **Retention** — key decisions, code changes made, current task state, active plan, error
   history, and important context (file paths, constraints, user preferences) survive.
2. **Faithfulness** — nothing invented: no fabricated file paths, decisions, or "completed"
   work that never happened. A hallucinated "we already fixed X" is worse than an omission.
3. **Recency/priority weighting** — the in-flight task is preserved in actionable detail;
   long-superseded detours are allowed to fade. Superseded decisions must not resurface as
   current ones.
4. **Usability** — the downstream model can actually act on it (the end-to-end test).
5. **Cost/latency** — summary tokens + wall-clock, since compaction blocks the turn mid-stream.

## Design decisions & options

### D1. Fixture corpora: where do the long chats come from?

| Option                                                                             | Pros                                                                                                                                                                                                                            | Cons                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **(a) LLM-authored synthetic transcripts with a planted ground-truth manifest** ✅ | Controlled ground truth (each planted fact is scoreable); can deliberately plant hazards (superseded decisions, mid-chat pivots, errors-then-fixes, distractor detours); reproducible; same pattern as `fixtures/chat_history/` | Risk of "too clean" — real transcripts are messier; authoring effort                                            |
| (b) Real captured Dyad sessions                                                    | Maximum realism                                                                                                                                                                                                                 | No ground truth without expensive manual labeling; privacy; hard to share in-repo; not reproducible across runs |
| (c) Replay eval artifacts (`eval-results/` tool-call logs) as transcripts          | Real tool-call texture for free                                                                                                                                                                                                 | Short, single-file edits — nothing like a 200k-token session; no narrative arc to summarize                     |

**Decision: (a)** (approved 2026-07-28), with realism enforced by construction: each scenario
is generated as a turn-by-turn AI-coding session **in Dyad's actual transcript format** (user
turns, assistant turns with `<tool-use>` blocks, truncated tool results,
`<dyad-write>`/`<dyad-edit>` tags), **authored by `gpt-5.6-sol`** from a scenario brief, then
mechanically validated. (Authoring ≠ summarizing, so self-preference contamination risk is
low; both candidates summarize the same fixed transcripts either way.) Each fixture ships with a
`manifest`: a list of ground-truth facts, each tagged with a category and an importance tier
(see D3), plus a list of "trap" facts (superseded decisions, abandoned approaches) whose
_current-state_ form is what must survive.

Scenario briefs (8 scenarios, mirroring real Dyad usage):

1. **feature-marathon** — long feature build (auth + profile page) across many files; several
   user requirement changes mid-way.
2. **debug-spiral** — a bug hunt with 4 failed hypotheses before the real root cause; the trap
   is resurrecting a disproven hypothesis.
3. **refactor-plan** — an explicit multi-phase plan created early, phases 1–2 done, phase 3
   in-flight at the compaction point (tests "Active Plan" + "Current Task State").
4. **pivot** — user abandons approach A for approach B halfway; traps: A's decisions must be
   marked superseded, not current.
5. **polyglot-context** — schema migration + API + UI touching many files; tests file-path
   retention breadth.
6. **error-recovery** — recurring build/test failures with specific error messages that inform
   the current fix; tests "preserve errors" guideline.
7. **preferences-and-constraints** — user states lasting preferences (styling system, no new
   deps, target browser) early and sparsely; tests retention of old-but-still-binding context.
8. **tool-noise** — heavy tool-call chatter (searches, reads, MCP calls) around a thin decision
   thread; tests signal extraction from noise.

### D2. Transcript scale

**Decision (approved 2026-07-28): full-scale ~200k-token transcripts** — realism over cost.
Real compaction fires at ~250k context tokens; the transcript the model actually sees is the
post-truncation XML transcript (tool results capped at 1000 chars), so we target **~200k
tokens as-sent**, matching what production `performCompaction` submits.

Authoring at this scale can't be raw LLM output alone (~800k chars/fixture). The pipeline
splits authorship from materialization:

1. `gpt-5.6-sol` authors, per scenario: (i) a small project (10–20 realistic source files,
   full contents), (ii) a session script — an ordered list of turns, each referencing file
   writes/edits (as edit specs against the evolving project), tool calls with plausible
   1000-char-max results, user messages, and narrative assistant prose. Authored in
   sequential segments (~10–15 calls/scenario) so the story stays coherent and facts/traps
   land where the manifest says.
2. A deterministic materializer replays the script: applies each edit spec, inlines the
   **full current file content** into `<dyad-write>` tags at every write (exactly how Dyad
   agents rewrite whole files), emits the Dyad message list, and runs the production
   `formatAsTranscript` over it. Repeated full-file writes amplify a modest authored core to
   ~200k tokens with realistic (not padded) structure.
3. Mechanical validation: token length within 180–220k, every manifest fact string-locatable
   in the transcript, traps present in both original and superseding form, tag well-formedness.

### D3. Scoring methodology

Three layers, cheapest first; all three run on every summary:

1. **Structural checks (mechanical, free)** — required sections present (`## Key Decisions
Made`, `## Current Task State`, `## Active Plan`, …); summary token count; every file path
   mentioned in the summary must appear in the source transcript (**mechanical hallucination
   check** — regex path extraction, exact-match against transcript).
2. **Fact-grid judging (primary metric)** — for each manifest fact, an LLM judge sees _only_
   (fact, summary) and answers `preserved | partial | absent | contradicted`. Traps are scored
   inversely: a superseded decision presented as current = `contradicted`. Score =
   importance-weighted retention (tier-1 "must survive" facts weighted 3×, tier-2 2×,
   tier-3 nice-to-have 1×), plus a separate **hallucination/contradiction count**. Per-fact
   judging is much more reliable than asking a judge for one holistic 1–10 score.
3. **Downstream continuation probe (validity anchor)** — a fresh model
   (fixed across all arms: `gpt-5.4`, the existing judge/workhorse) receives only the summary
   (as the real post-compaction context would) plus 3 scenario-specific probe tasks, e.g.
   "What should we do next and why?", "Did we already try X?", "Which files implement Y?".
   Judge scores each answer against the manifest. This is the "can the agent keep working"
   test — the metric that actually justifies picking a model.

Rejected alternative: **pairwise A/B judging** (judge picks the better of two summaries).
Cheap and sensitive, but produces only a relative ranking, is order-biased, and doesn't
localize _what_ was lost. The fact grid subsumes it; we can still compute head-to-head win
rates from fact-grid scores.

### D4. Judge model

`gpt-5.4` (existing eval judge), **not** one of the candidates — avoids self-preference bias.
Both scoring layers 2 and 3 use it. Risk: gpt-5.4 shares a family with both candidates; if we
want extra insurance, a 20% sample re-judged by `claude-sonnet-4-6` gives an agreement check
(reported, not averaged in).

### D5. Arms (models under test)

**Decision (approved 2026-07-28): two arms only** — the `claude-sonnet-4-6` reference arm is
dropped.

- `gpt-5.6-sol` (candidate)
- `gpt-5.6-luna` (candidate; already the sub-agent model)

Both via Dyad Engine gateway with `DYAD_PRO_API_KEY` (mapped from env `DYAD_PRO_KEY`), openai
gateway prefix `""` per `language_model_constants.ts`. The production prompt
(`COMPACTION_SYSTEM_PROMPT`) and production formatting (`formatAsTranscript`, 1000-char tool
truncation) are imported directly — the benchmark tests models, not prompt variants.
(Prompt-variant A/B is an easy follow-up: fork the prompt into
`helpers/compaction_prompts.ts` the way `prompts.ts` does for the Pro agent prompt.)

### D6. Repetitions & aggregation

2 reps per (scenario × model) — sampling variance was visible in the chat-history benchmark.
Grid: 8 scenarios × 2 models × 2 reps = **32 compaction generations**, each followed by
~12 fact-judge calls + 3 probe generations + 3 probe-judge calls (small, cheap).
Report: mean weighted retention, hallucination count, trap-failure rate, probe success rate,
summary tokens, latency — per model, with per-scenario breakdown in `summary.md`.

### D7. Harness form

Vitest eval suite, same shape as `chat_history.eval.ts`:

- `src/__tests__/evals/compaction.eval.ts` — grid runner: gate(4) concurrency, `CMP_SMOKE=1`
  (1 scenario × both candidates), `CMP_ONLY=<substr>`, `CMP_RESUME=<run-dir>`,
  `CMP_MODELS=<csv>` override.
- `src/__tests__/evals/helpers/compaction_harness.ts` — fixture loading + validation,
  transcript assembly via the real `formatAsTranscript`, structural checks, fact-grid judge,
  probe runner.
- `src/__tests__/evals/fixtures/compaction/*.json` — `{ brief, transcriptMessages, manifest,
probes }` + `AUTHORING.md`.
- Results: `benchmark-results/compaction/<run>/results.jsonl` + `summary.md` (gitignored).

Rejected: the Electron/Playwright harness (`benchmarks/code-explorer/`) — full-app fidelity is
unnecessary because `performCompaction`'s model-facing surface is exactly (prompt, transcript),
both of which we import directly; the app harness would add minutes per run and flakiness for
zero extra signal about summary quality.

## Cost & time estimate

Input-dominated: 32 generations × ~200k input tokens ≈ **6.4M input tokens** for the mains,
plus judge/probe calls (~32 × 15 small calls ≈ 0.4M; probes reuse only the summary, not the
transcript). At gateway concurrency 2–4 (200k-token requests are slow and 429-prone), expect
**1.5–3 h wall-clock** for the full grid; the runner supports resume. Fixture authoring with
`gpt-5.6-sol` is a one-time ~1.5M-token cost (segmented authoring, deterministic
materialization), reusable for future prompt-variant runs.

## Execution plan (approved 2026-07-28)

0. ~~Smoke-test model ids~~ — done; both candidates confirmed live on the engine.
1. Author fixtures: authoring pipeline (D2) writes 8 scenario transcripts + manifests;
   validate each mechanically (token length, format tags, manifest facts present).
2. Build harness + smoke run (`CMP_SMOKE=1`).
3. Full grid run; verify no 429/truncation anomalies mid-run (resume if needed).
4. Write up `summary.md` + verdict with per-scenario breakdown and a recommendation on
   pinning a compaction model (and whether prompt-variant follow-up looks worthwhile).

## Results (2026-07-28)

Full grid ran clean: 32/32 runs, 0 errors (~282k actual prompt tokens per generation —
right at the production compaction threshold). Verdict in
`benchmark-results/compaction/run-2026-07-28T18-04-03-218Z/VERDICT.md` (local, gitignored):
**quality tie** (artifact-corrected weighted retention 83% luna vs 81% sol; tier-1 93/91;
probes 80/78; zero trap contradictions and zero hallucinated paths for both), **gpt-5.6-luna
~2× faster** (11s vs 21s mean). Recommendation: if pinning a compaction model, pin
`gpt-5.6-luna`. Shared weakness worth a prompt follow-up: sparse early user
preferences/constraints survive worst (50–67% probe scores) — consider a dedicated
"standing preferences/constraints" section in `COMPACTION_SYSTEM_PROMPT`.

## Resolved review questions (2026-07-28)

1. **Arms**: sonnet reference arm dropped — two gpt-5.6 candidates only (32 gens).
2. **Scale**: full-realism ~200k-token transcripts (D2 decision above).
3. **Fixture authoring model**: `gpt-5.6-sol`.
