# Explore V2: Single-Conversation Explorer With a Schema-Bound Finish

> Written 2026-06-09 after reviewing the candidate-selection implementation in
> `src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts` on the
> `explore-code-subagent` branch. Builds on `GENERALIZABLE_EXPLORER_AGENT.md` and
> `LONG_TERM_EXPLORE.md`; supersedes their implementation sequencing where they conflict.

## Summary

The current implementation got the core invariant right: the value model selects observed
candidate IDs and can never type a file path or line range into the final report. That fixed
fabricated references.

But the implementation around that invariant has three structural problems:

1. **Laundered overfitting.** Benchmark-specific path literals were deleted, but the behavior
   came back as "generic" English word lists, a web-app role taxonomy, and intent regexes that
   are visibly derived from the benchmark repos (`scene`, `channel`, canvas-style target
   resolution, `/onboarding/` as a support path). These will misfire on mobile apps, backend
   services, CLIs, and non-React conventions.
2. **Split-brain orchestration.** The explorer model builds full understanding across up to 8
   tool steps, is told to throw it away (`respond only: done`), and then a _separate_ selection
   call re-derives judgment from a lossy 180-char-evidence candidate packet. With the targeted
   and gap follow-up passes, one `explore_code` call can cost ~6 sequential LLM invocations,
   each rebuilding context the first one already had.
3. **A report that repeats itself and begs.** The deterministic report renders the same facts up
   to four times (answer draft, JSON summary, findings, causal chain, flow, recommended action)
   and embeds 400-600 chars of per-call "do not call grep again" imperatives in uncached tokens
   — policy that already lives in the cached tool description and system prompt.

V2 collapses exploration and selection into **one conversation that must end with a structured
`submit_report` tool call**, demotes deterministic code from judge to validator, makes task
intent a tool argument supplied by the main model, and cuts the report to a single
representation at roughly a third of the current budget.

The fabricated-fact problem also moves into scope: the selection model currently authors causal
"facts" from candidate metadata it never read. V2 grounds facts by requiring them to quote
observed evidence, and earns main-model trust with short verbatim quotes instead of per-report
prohibitions.

## Goals

- **One model invocation chain, not six.** Exploration, judgment, and gap-filling happen in a
  single sub-agent conversation. Follow-up is a continuation, not a re-selection pass.
- **Generalizability by deletion.** No English morphology tables, action-word lists, web-app
  role enums scored by regex, or query-intent regexes in production scoring code.
- **Dense, trusted main context.** One-representation report at ~2,500 chars with verifiable
  evidence quotes. Policy text lives in cached context, never in the per-call report.
- **Deterministic code validates; it does not judge.** It can drop, clamp, dedupe, and lower
  confidence. It never upgrades an action, pads a file list, or rewrites the model's selection.
- **Keep the core invariant.** The model selects candidate IDs only. Unobserved references stay
  unrepresentable.

## Non-Goals

- A semantic index or new retrieval channels (Phase 3/5 of the prior plans still apply later).
- Letting the model write raw `path:line` references.
- Optimizing sub-agent token spend at the expense of main-model context density. The sub-agent
  is cheap; the main model is not.
- Preserving current benchmark scores through the refactor. A dip when word lists are deleted is
  signal, not regression.

## Current State (what to keep, what to delete)

### Keep

- Candidate ID invariant and `resolveCandidateIds`-style resolution.
- Candidate extraction at the tool boundary (`candidatesFrom*Result`), dedupe, overlap merging,
  range clamping (`clampRangeForReport`), and ranked-candidate ID assignment.
- Chat-scoped report cache with file-stat invalidation (`explore_code.ts`).
- Benchmark recorder instrumentation and the new `--arms` / `--resume-from` harness plumbing.
- The grep literal-inference fallback (`grep.ts`) — genuinely generic.
- Generic test/support/generated/docs path classification, **minus** product-shaped entries
  (`/onboarding/`, `/tours/`).

### Delete

- `selectExploreCandidates` and the standalone selection prompt/parse path
  (`parseExploreSelection`, `extractJsonObject`, and friends) — replaced by a forced tool call.
- `runTargetedEvidencePass`, `runModelAuthoredGapEvidencePass`, `runMinimumEvidencePass`, and
  their query-synthesis helpers (`buildMinimumEvidenceQueries`, `buildTargetedIdentifierGrepQueries`,
  `extractTargetIdentifiers`) — replaced by conversation continuation.
- `inferTaskIntent` and every intent-conditional branch — replaced by an `intent` tool argument.
- `normalizeRecommendedAction` — replaced by validation-only rules (see below).
- `supplementPrimaryCandidates` and `MIN_ANSWER_PRIMARY_FILES` padding.
- `normalizeSearchTerm` morphology table, `isActionSearchTerm`, `isLowSignalSearchTerm`,
  the `scene`/`scenes` blocklist entries, and `hasTargetResolutionEvidence`.
- `getEvidenceRoles` / `getStrongEvidenceRoles` / `hasStrongApiEvidence` regex haystacks — role
  judgment moves to the model with an open vocabulary.
- The `target` evidence role (canvas-app residue).
- Answer draft, separate findings list, and duplicated causal-chain prose in the report.
- Per-report imperative policy text.
- `DYAD_CODE_EXPLORER_REPORT_MODE` env-var control of production behavior — benchmark arms get
  explicit plumbing.

### Known bugs to fix in passing

- Dead ternary in `resolveSelection` (both branches return `fallbackReadTargets`).
- Duplicate `routes?` check in `normalizeSearchTerm` (moot once deleted).
- `skip_explore_result` parses but silently renders as `targeted_gap_search` — make it a real
  rendered outcome ("explorer found nothing relevant; proceed without it") or drop it from the
  schema.
- Per-observation char cap exists but total raw-observation budget is unbounded across steps.
- `estimatedTokens = rangeWidth * 8` overestimates ~2x; use ~4 tokens/line or measure.

## Architecture

```text
user query + intent (from main model)
  -> sub-agent conversation (single streamText call, tool loop)
       tools: explore_code(raw), grep, read_file, list_files, submit_report
       every tool result is annotated inline with candidate IDs: [c12]
       host accumulates typed candidates at the tool boundary (unchanged)
  -> conversation MUST end by calling submit_report(selection)
       selection schema = candidate IDs + roles + facts + action + confidence + gaps
  -> deterministic validator
       drop unknown IDs / unobserved ranges; clamp budgets; verify fact quotes;
       lower confidence; never upgrade or rewrite
  -> if validator finds a critical gap AND step budget remains:
       append one user message naming the gap; continue the SAME conversation
  -> deterministic renderer emits the final compact report
  -> main model answers, reads listed ranges, or runs the listed bounded searches
```

### 1. Candidate IDs injected inline

Today candidates get IDs only after exploration ends, so the explorer model cannot reference
them. V2 assigns IDs as observations arrive and annotates the tool result text the model sees:

- compiler windows: `#### src/store/channels.ts [c7] - switchChannel (function:42)`
- grep clusters: one ID per rendered cluster;
- read_file: one ID for the read range;
- list_files: IDs only for paths, marked path-only.

The registry stays host-side and typed (unchanged from today). The inline annotation is purely
so the model can select IDs it has actually seen, in the same conversation, with the full
evidence in context. ID assignment must be stable across the conversation (monotonic counter,
dedupe maps to the first ID).

### 2. `submit_report` as a forced tool call

Replace the prose-JSON selection pass with a `submit_report` tool whose input schema is the
selection. Enforce completion: if the model stops without calling it, send one nudge message;
if it still fails, fall back to deterministic-only selection (current fallback behavior).
Schema validation happens at the tool-call layer, so `extractJsonObject` regex parsing and the
`selection_invalid` path disappear.

```ts
interface ExploreSelectionV2 {
  primaryCandidateIds: CandidateId[]; // 1-5, no padding
  readTargets: Array<{
    candidateId: CandidateId;
    purpose: string; // tied to the caller's intent
    required: boolean;
  }>;
  flow: Array<{
    candidateId: CandidateId;
    role: string; // OPEN vocabulary; suggested list in prompt only
    fact: string; // must contain a quote from observed evidence (validated)
    quote: string; // <=2 lines, verbatim from an observed window/cluster
  }>;
  missingCoverage: string[]; // specific, <=3
  recommendedPrimaryAction:
    | "answer_from_report"
    | "read_targets"
    | "targeted_gap_search"
    | "skip_explore_result";
  searchTargets?: string[]; // only for targeted_gap_search; bounded terms+scopes
  confidence: "high" | "medium" | "low";
}
```

Notes:

- `role` is a free string with a _suggested_ vocabulary (entry, ui, handler, state, data/api,
  persistence, render/output, type, test) in the prompt. No closed enum, no regex scoring of
  roles. A mobile app can say "gesture recognizer"; a CLI can say "command dispatch".
- `quote` is the trust mechanism: <=2 verbatim lines per flow link (~30 tokens) that the
  validator string-matches against observed evidence. A verifiable quote does more to stop
  main-model re-reading than any amount of prohibition text.
- `flow` replaces findings + causalChain + flowSummary. One list, ordered, is the explanation.

### 3. Intent comes from the caller

Add to `exploreCodeSchema`:

```ts
intent: z.enum(["explain", "locate", "edit", "debug"]).describe(
  "What the result will be used for. explain/locate: answer or point at code. " +
    "edit/debug: exact ranges will be read before changing code.",
);
```

The main model knows why it is calling the tool; inferring intent from English query regexes is
strictly worse. Intent flows into the sub-agent prompt and into validation thresholds (e.g.
`answer_from_report` is only legal for explain/locate). `inferTaskIntent` is deleted. Cache key
must include intent.

### 4. Adaptive continuation instead of follow-up passes

After `submit_report`, the validator checks the selection. If there is a critical, _specific_
gap (a flow link whose quote failed validation, a missing role the model itself named, zero
ranged candidates for an edit intent) and the budget allows, the host appends one user message
to the same conversation:

```text
Your report cited a missing link: "<gap>". You have N tool steps remaining.
Find observed evidence for it, then call submit_report again.
```

At most 2 continuation rounds. Budgets: ~12 total tool steps, a total raw-observation cap
(~60k chars), and wall-time. The model keeps everything it already learned; no packet rebuild,
no re-selection call, no separate gap-pass system prompt. Stop reasons are recorded for the
benchmark.

### 5. Validator (the only deterministic policy)

Allowed operations, in order:

1. drop unknown candidate IDs and read targets without observed ranges;
2. drop flow links whose `quote` does not appear (whitespace-normalized substring match) in that
   candidate's observed evidence; record `fact_unverified` for each;
3. clamp counts (<=5 primary, <=8 read targets, <=3 missingCoverage) and ranges
   (`clampRangeForReport`);
4. dedupe and overlap-merge (existing logic);
5. downgrade only:
   - `answer_from_report` with intent edit/debug -> `read_targets` (or `targeted_gap_search`
     if no ranged targets survive);
   - `read_targets` with zero surviving targets -> `targeted_gap_search`;
   - confidence `high` with any dropped link or non-empty missingCoverage -> `medium`;
   - confidence `medium` with zero surviving flow links -> `low`.

Forbidden operations: upgrading an action, padding primary files, synthesizing search queries,
rewriting facts, reordering the model's flow. If validation guts the selection (no primary
files survive), fall back to the deterministic low-confidence report.

### 6. Report format: one representation

````text
## explore_code report
Query: "..." | Intent: explain | Confidence: high | Action: answer_from_report

Flow:
1. src/routes/app.tsx:18-44 (entry) - Route mounts <ChannelSidebar/>.
   > <Route path="/channels/:id" element={<ChannelSidebar/>} />
2. src/components/sidebar.tsx:120-163 (handler) - Click calls switchChannel(id).
   > onClick={() => switchChannel(channel.id)}
3. src/store/channels.ts:42-58 (state) - switchChannel dispatches setCurrentChannel.
   > dispatch(setCurrentChannel(id))

Missing: none
Read targets (only if editing): src/store/channels.ts:42-58 - edit the dispatch payload.

```json
{ ...compact machine block: paths/ranges/action/confidence only... }
````

```

Rules:

- Each path appears exactly once outside the JSON block.
- The JSON block carries only what machines need (cache invalidation in `explore_code.ts`
  parses it; keep that contract but shrink it — paths, ranges, action, confidence).
- Budget: `MAX_REPORT_CHARS = 2_500` (down from 8,000).
- Zero imperative policy text. "Follow recommendedPrimaryAction", "don't re-explore after a
  high/medium report" live only in the tool description and `local_agent_prompt.ts`, which are
  cached per session. Update both to describe the V2 format and remove references to sections
  that no longer exist (answer draft, findings).
- Quotes are <=2 lines each and are the *only* source text allowed in the report. The validator
  rejects anything longer.

### 7. Ranking stays, word lists go

Until worker-side graph ranking (prior plan Phase 3) lands, keep the existing
`buildCandidate` scoring but reduce it to structural features only:

- source weight (compiler > read_file > grep > list_files);
- exact query-identifier match against path basename / symbol names / evidence — using the
  raw query tokens split on non-alphanumerics and camelCase, **no morphology table, no
  action/noun lists**;
- range tightness and estimated token cost (fixed: ~4 tokens/line);
- generic test/support/generated/docs penalty.

Role coverage disappears from scoring entirely (roles are now model-assigned labels, not
ranking features). This costs some recall ordering; the explorer model compensates because it
now sees candidates inline and can keep exploring when the top of the list looks wrong.

## Token Accounting (why this nets out)

Per `explore_code` call, V1 (candidate-followup) vs V2:

| Cost center                     | V1                          | V2                         |
| ------------------------------- | --------------------------- | -------------------------- |
| Sub-agent LLM invocations       | up to 6 sequential          | 1 (+<=2 continuations)     |
| Candidate packet resends        | up to 3 x 3-8k tokens       | 0 (inline IDs)             |
| Report into main context        | ~2k tokens, 4x redundant    | ~600 tokens, single-form   |
| Per-call policy text (uncached) | 400-600 chars every call    | 0                          |
| Padding files                   | always 5 primary            | only what the model picked |
| Rediscovery after distrust      | common (unverifiable facts) | reduced (verbatim quotes)  |

The dominant lever is the last row. A report the main model trusts replaces 5-20 broad main
reads; a report it distrusts is pure overhead on top of them. Quotes plus validated facts are
the trust mechanism; everything else is supporting cost reduction.

## Implementation Sequence

### Phase A: submit_report + inline IDs (the collapse)

- Add stable candidate-ID assignment at observation time; annotate rendered tool results.
- Add `submit_report` tool with the V2 selection schema; force completion with one nudge.
- Delete the selection pass, both follow-up passes, the minimum-evidence pass, and JSON
  scraping. Wire the validator + continuation loop.
- Keep the deterministic report builder as the model-failure fallback only.
- Rebaseline `explore_code_subagent.spec.ts` around invariants: unknown IDs cannot render,
  quotes must match evidence, budgets hold, downgrades-only validation, fallback works. Do not
  assert specific winners.

Acceptance: one streamText conversation per explore call on the happy path; selection arrives
as a validated tool call; all existing invariant tests pass.

### Phase B: intent argument + word-list deletion

- Add `intent` to `exploreCodeSchema`, tool description, main prompt guidance, and cache key.
- Delete `inferTaskIntent`, morphology/action/low-signal lists, role regexes, `target` role,
  product-shaped support paths.
- Reduce `buildCandidate` to structural features.
- Add the **domain-literal guard test**: production explorer files must not contain benchmark
  repo names, product nouns, or task vocabulary (`scene`, `channel`, `invoice`, `excalidraw`,
  `mattermost`, ...). This test would have caught today's residue.

Acceptance: guard test passes; no intent regexes remain; scoring is explainable from structure.

### Phase C: report V2 + prompt tightening

- New renderer (single representation, 2.5k budget, quotes, slim JSON block).
- Update `explore_code.ts` cache-stat extraction for the slim JSON block.
- Rewrite tool description and `local_agent_prompt.ts` guidance for the V2 contract; move all
  policy there.

Acceptance: report chars p50 <= 2.5k; every path renders once; zero imperative sentences in
report bodies.

### Phase D: measurement

- Benchmark arms: `explore-v1` (current candidate-followup) vs `explore-v2`, plus baseline.
- Headline metric: **main-model tool calls after a high/medium report** (broad grep/list_files
  count, read_file calls outside read targets), on a held-out repo split (>=8 tasks from repos
  never used to write any heuristic), repeats >= 3.
- Secondary: main uncached input p50, report tokens, sub-agent invocations and elapsed time,
  `fact_unverified` rate, continuation-round distribution, answer quality rubric.

Acceptance: held-out quality >= V1; main uncached input and post-report broad calls decrease;
no production diff reintroduces domain literals.

## Risks

- **Cheap model can't drive a forced tool call reliably.** Mitigation: one nudge retry, then
  deterministic fallback (already exists). Measure the fallback rate; if it exceeds ~10%,
  revisit model choice for the sub-agent before adding orchestration back.
- **Quote validation is too strict** (whitespace/truncation mismatches drop real facts).
  Normalize aggressively (collapse whitespace, strip line numbers), match against untruncated
  observation text, and track `fact_unverified` rate before tightening further.
- **Deleting word lists drops benchmark recall.** Expected and acceptable in-sample; the
  held-out split is the metric that matters. Do not add compensating vocabulary back.
- **Inline ID annotations confuse the explorer model.** Keep them terse (`[c7]`) and explain
  them once in the system prompt; verify with a few manual traces before benchmarking.
- **Spec rebaseline is large.** It is — but it is the last rebaseline of this size if the tests
  assert invariants instead of winners.

## Acceptance Criteria

- One sub-agent conversation per explore call; selection is a schema-validated tool call.
- The value model still cannot author paths or ranges; additionally, every rendered fact is
  backed by a verbatim observed quote.
- No morphology tables, action/intent word lists, closed role enums, or domain literals in
  production explorer code (enforced by a guard test).
- Reports are single-representation, <=2.5k chars, with policy text only in cached context.
- Held-out benchmark: post-report main broad-search calls and main uncached input decrease
  versus V1 without quality regression, across >=3 repeats.
```
