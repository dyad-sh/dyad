# Generalizable Explorer Agent

> Written 2026-06-08 after reviewing `explore_code_subagent.ts`, `BENCHMARK.md`,
> `IMPROVE_CODE_EXPLORE.md`, and consulting `claude -p` as an architecture advisor.

## Summary

`explore_code` has drifted from a general code-reconnaissance tool into a benchmark-shaped
deterministic ranker. The value model, which is the component most likely to generalize across
repositories, is currently used mostly as a one-step tool-call planner. When observations exist,
the implementation discards the model's report and rebuilds a deterministic report from a large
pile of query/path heuristics in `explore_code_subagent.ts`.

That is backwards. Deterministic code should retrieve, constrain, and verify. The value model
should judge which evidence matters and compress it into dense findings for the main model.

This plan is intentionally aggressive: delete benchmark-specific production logic rather than
quarantining it behind a permanent compatibility layer. Keep the benchmark as a measurement tool,
not as a source of product behavior.

## Goals

- **Generalizability first:** `explore_code` should work on repositories and workflows never seen
  in the benchmark suite.
- **Dense main-model context:** the main model should receive concise findings, tight ranges, and
  a clear next action, not broad raw source/search output or duplicated boilerplate.
- **One source of retrieval truth:** compiler/graph retrieval should happen in the worker, with
  structured provenance. Do not render Markdown and parse it back into refs.
- **Deterministic validation, not deterministic judgment:** code should enforce schema, observed
  ranges, no raw excerpts, range tightness, and support-file policy. It should not memorize that a
  particular product flow uses a particular file name.

## Non-Goals

- Preserving benchmark-specific wins when they depend on repo/task literals.
- Building a general semantic-code-search service for every language.
- Replacing `grep` and `read_file`; the explorer should reduce broad discovery, not remove all
  targeted follow-up.
- Optimizing elapsed time ahead of context density and generalization.

## Current Problem

The production sub-agent contains explicit benchmark-shaped logic:

- task detectors such as auth-login/signup, post-send, invoice-create, export, toolbar-action,
  and record-detail route;
- repo/path literals such as Excalidraw action/render internals, Mattermost editor/send-button
  paths, Twenty side-panel route paths, mock-data script paths, CLI path penalties, and similar;
- deterministic augmentation greps shaped around known benchmark failures;
- unit tests that assert exact benchmark path behavior, locking the overfit in place.

This creates two failures:

- **Poor generalization:** new repositories will not share these names, paths, or architecture.
- **Low context density:** when the deterministic report is wrong or incomplete, the main model
  treats it as a starting point and repeats broad exploration, bloating uncached and cached context.

## Target Architecture

Invert the responsibility split.

| Layer           | Owner                      | Responsibility                                                                        |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| Retrieve        | deterministic worker       | Build graph/search candidates with structured provenance.                             |
| Assemble        | deterministic main process | Merge typed tool observations, dedupe, and budget candidates.                         |
| Judge and write | value model                | Pick the important evidence, explain the flow, and choose the next main action.       |
| Validate        | deterministic main process | Enforce schema, observed ranges, no raw source, tight refs, and generic safety rules. |

### Retrieval Channels

Do not assume the TypeScript graph alone is enough. Real applications wire behavior through JSX
props, framework routes, server actions, generated clients, dependency injection, string keys,
config files, and callback boundaries that a declaration/call graph will miss.

Use multiple generic retrieval channels and merge them into one candidate set:

- **compiler graph:** exact/qualified symbol hits, references, imports, calls, declaration ranges;
- **lexical symbol search:** exact identifiers, camelCase/snake/kebab variants, action+noun pairs;
- **path trait search:** generic path roles such as route, component, hook, service, API, store,
  action, type, config, test;
- **framework surface search:** repo-independent conventions such as Next/Vite/React route and
  component files, API route files, server/client boundary files, and test files when requested;
- **bounded grep fallback:** targeted searches for query identifiers and action+noun terms when
  compiler results are weak;
- **verification reads:** tight reads of candidate declarations or high-signal ranges only after
  retrieval has candidate paths.

These channels are allowed because they are structural, not benchmark-specific. They should not
mention product names, benchmark repo names, or one-off file paths.

### 1. Retrieve In The Worker

Extend the worker result beyond rendered source windows. Return structured candidates:

```ts
interface ExplorerCandidate {
  path: string;
  range: { start: number; end: number } | null;
  symbols: Array<{ name: string; kind: string; line: number }>;
  score: number;
  source: "compiler" | "grep" | "read_file" | "list_files";
  provenance: string[];
  graph?: {
    rootMatchScore?: number;
    distanceFromRoot?: number;
    inboundEdges?: number;
    outboundEdges?: number;
    edgeKinds?: string[];
  };
  traits: {
    isTest: boolean;
    isSupport: boolean;
    isGenerated: boolean;
    isDocsExample: boolean;
    pathKinds: Array<
      | "route"
      | "component"
      | "hook"
      | "service"
      | "api"
      | "store"
      | "action"
      | "type"
      | "config"
    >;
  };
  estimatedTokens: number;
  evidenceRoles: Array<
    | "entry"
    | "ui"
    | "handler"
    | "state"
    | "data"
    | "api"
    | "persistence"
    | "render"
    | "output"
    | "type"
    | "test"
  >;
}
```

Ranking should use generic features only:

- exact symbol/identifier match;
- qualified-name match;
- query noun/action co-occurrence;
- graph distance from root hits;
- definition/caller/callee/reference evidence;
- path trait alignment with query traits;
- tight range and low estimated-token cost;
- generic test/support/generated/docs penalties unless explicitly requested.

### Evidence Roles

The report should not only list files; it should explain which generic role each file plays. This
is how we avoid a valid-looking but semantically shallow report.

Use repo-independent evidence roles:

- **entry:** route, command, event listener, exported API, page/screen, or public function where
  the flow starts;
- **ui:** component, hook, view, form, button, modal, or renderer-facing code;
- **handler:** callback, action, command, mutation function, service method, or event handler;
- **state:** store, reducer, atom, context, cache update, local state update;
- **data/api:** fetch, RPC, GraphQL/tRPC, REST route, server action, client call;
- **persistence:** database, file write, external service write, queue/enqueue, mutation sink;
- **render/output:** rendered view, canvas/DOM update, export/serialization/download, final output;
- **type/test:** type contracts or tests, only when relevant.

The model may assign roles, but validation must check that every claimed role is backed by an
observed candidate with matching generic traits or evidence text. Confidence must be based on role
coverage, not only on model self-assessment.

### 2. Assemble Typed Observations

Stop using `formatRawExploreCodeResult(...)` as the data boundary for the sub-agent. Markdown is
for display only. The sub-agent observation log should preserve typed results from:

- raw compiler explorer;
- `grep`;
- `read_file`;
- `list_files`.

If a tool only returns text today, wrap it in a typed adapter at the observation boundary. The
report builder should never regex-parse `#### path - symbol` or `path:line:` from rendered output
when structured data is available.

### 3. Let The Value Model Judge

The value model should receive a compact candidate packet, not full raw source. It should author
the report:

- 2-5 primary files;
- concise findings;
- one flow paragraph;
- a small set of validated read targets when exact source is needed;
- `recommendedPrimaryAction`;
- confidence and missing coverage.

Do not discard this report just because observations exist. Deterministic report generation should
be a fallback for model failure, invalid JSON, or abort-safe degraded behavior.

### Confidence Rules

Confidence is not whatever the value model says. It is validator-approved:

- **High:** requested evidence roles are covered by observed candidates; primary ranges are tight;
  citations are valid; no critical gap remains.
- **Medium:** the report has useful observed evidence, but one non-critical role is missing, one
  range is wider than ideal, or the flow is likely but not fully verified.
- **Low:** evidence is mostly lexical/listing based, critical roles are missing, cited ranges are
  broad, or validation had to drop/repair important refs.

For answer-only tasks, high/medium can support `answer_from_report`. For edit/debug tasks,
high/medium can support `read_targets`, but the targets must be explicitly tied to the edit/debug
purpose.

### 4. Validate The Report

The validator should be strict and repo-agnostic:

- report JSON parses and matches schema;
- every cited `path:start-end` was observed;
- cited files still exist and are inside the app root;
- ranges are not over-wide unless justified by an observed declaration range;
- primary files are deduped and non-overlapping;
- no raw source excerpts or large code blocks appear in the report;
- tests/support/generated/docs are excluded unless requested or explicitly marked as caveats;
- claimed evidence roles are backed by observed candidates;
- confidence matches validator-approved role coverage and range quality;
- `recommendedPrimaryAction` is internally consistent:
  - `answer_from_report` has no read target and no missing critical coverage;
  - `read_targets` has observed, tightly ranged targets with concrete purposes;
  - `targeted_gap_search` has concrete terms and bounded scopes.

If validation fails, repair generically:

1. drop invalid/unobserved refs;
2. tighten or remove wide ranges;
3. ask the model for a schema-only repair using the same candidate packet;
4. fall back to a conservative low-confidence report with targeted search guidance.

## What To Delete

Delete benchmark-specific production logic from `explore_code_subagent.ts`, including:

- strict domain scorers for auth-login/signup, post-send, invoice-create, export, toolbar-action,
  and record-detail routes;
- benchmark-specific path and symbol literals such as product-specific editor, action manager,
  side-panel, scene-update, mock-data, CLI, and reaction paths;
- deterministic augmentation searches shaped around known benchmark task failures;
- path-specific render-sink and route-identity exceptions;
- tests whose assertion is effectively "this benchmark prompt returns this benchmark path."

Do not replace these with a renamed list of equivalent hints. If the behavior cannot be expressed
as a generic structural feature, it should not be production ranking logic.

## What To Keep

Keep or strengthen generic mechanisms:

- chat-scoped report cache with file-stat invalidation;
- persistent TypeScript worker/index sessions;
- TypeScript graph construction and search;
- query tokenization and light morphology normalization;
- exact identifier extraction from user queries;
- generic support/test/generated/docs classification;
- range width scoring;
- dedupe and overlap merging;
- output token budgets;
- report schema;
- `recommendedPrimaryAction`;
- benchmark recorder instrumentation.

## Context Density Contract

The report sent to the main model should be treated as a bounded artifact.

Keep separate budgets for two different artifacts:

- **candidate packet:** value-side only; can be larger because it is used by the cheap sub-agent to
  reason and write;
- **main report:** primary-model context; must be compact and must not include the full candidate
  set.

Default report budget:

- <= 5 primary file refs;
- <= 2 secondary file refs;
- <= 5 read targets when exact source is needed;
- <= 1 compact JSON summary;
- <= 8 findings bullets;
- no raw source excerpts;
- no broad grep/list output;
- no duplicated explanation between JSON and prose except path/range refs.

The report must answer: "What does the main model now know that saves it from searching?"

If a token does not reduce future reads, remove it.

Read targets may span multiple files. Real code changes often require checking a component,
handler, state update, API/persistence boundary, type contract, and test. The rule is not "one
file only"; the rule is "no useless files and no huge reads."

Every read target must:

- have a concrete purpose tied to the user's task;
- use a tight observed range, not an entire large file;
- prefer declaration/function/class ranges over arbitrary file slices;
- avoid repeating facts already distilled in the report;
- be marked as required or optional;
- avoid sending the main model to rebuild the explorer's discovery map.

## Sub-Agent Exploration Budget

Do not make the explorer sub-agent artificially timid. The cost/context objective is not "fewest
sub-agent tool calls"; it is "fewest unnecessary tokens entering the main model context." The
sub-agent runs on the cheaper value model and its raw observations are discarded after compression,
so it should have enough room to investigate before writing a dense report.

Default exploration budget:

- allow multiple value-model tool steps, not just one;
- allow broad first-pass reconnaissance inside the sub-agent when the query is ambiguous;
- allow a second phase of targeted verification reads after initial candidates are found;
- allow the sub-agent to inspect enough files to confidently identify the relevant flow;
- stop based on observation budget, confidence, and diminishing returns, not an overly small fixed
  tool-call count.

Suggested caps:

- up to 5 value-model steps;
- up to 15 total sub-agent tool calls;
- up to 3-5 parallel tool calls per step;
- a raw observation budget enforced by estimated tokens/chars;
- a per-file raw-source cap so one large file cannot dominate the value context;
- early stop when the sub-agent has enough validated evidence for the requested coverage.

Stop criteria should be evidence-driven:

- stop when requested roles are covered by observed candidates;
- stop when new candidates are duplicates or low-signal variants of existing candidates;
- stop when observation budget is hit;
- stop when remaining gaps require broad repository search and return bounded
  `targeted_gap_search` guidance instead.

The strict budget belongs at the boundary back to the main model:

- the main report remains compact;
- raw source never leaks into the report;
- only validated path/range/fact summaries survive;
- `recommendedPrimaryAction` is limited to validated read targets or bounded search guidance.

This deliberately trades more value-side exploration for less main-side rediscovery. If the
sub-agent needs 10 cheap tool calls to prevent the primary model from doing 20 broad reads, that is
the correct trade.

## Measurement

### Density Metrics

Add these to benchmark events and generated summaries:

- report token estimate;
- raw observation token estimate;
- compression ratio: `reportTokens / rawObservationTokens`;
- raw source bytes in report;
- primary cited range width median and p90;
- percent cited ranges over 120 lines;
- number of main `grep` / `list_files` calls after a high/medium report;
- number of main `read_file` calls outside `recommendedPrimaryAction`;
- whether the next main tool call followed the recommendation;
- `answer_from_report` rate for answer-only tasks;
- main uncached/cached input token medians over repeats.

### Generalization Metrics

The current benchmark is contaminated by the production heuristics. Add a held-out split:

- existing benchmark repos/tasks become "known";
- new repos/tasks become "held-out";
- no production code may mention held-out repo or task terms;
- headline metric includes known vs held-out delta.

Add:

- domain-literal guard test for production explorer scoring files;
- top-k primary-file recall/MRR against manually labeled role-based key files;
- quality pass rate;
- in-sample vs held-out cost/context delta;
- repeats >= 3 for any claimed improvement.

Start with a small but real held-out set: 8-12 tasks across repos that were not used to write the
old heuristics. Label acceptable files by evidence role instead of exact single paths, e.g. "entry
may be any of these route/page files; persistence may be any of these service/mutation files."

## Implementation Sequence

### Phase 1: Remove Benchmark Hacks

- Delete domain-specific scorers and hard-coded path/symbol branches from
  `explore_code_subagent.ts`.
- Delete benchmark-specific augmentation greps.
- Replace exact benchmark-path unit assertions with generic invariants:
  - cited files exist;
  - ranges are observed;
  - tests/support files are excluded unless requested;
  - report schema is valid;
  - report stays within density budget.
- Add a guard test that fails if production explorer scoring code contains known benchmark repo,
  task, or path literals.

Acceptance:

- Unit tests pass after being rebaselined around generic behavior.
- No benchmark repo/task literals remain in production explorer ranking/report policy code.

### Phase 2: Typed Candidate Pipeline

- Add `ExplorerCandidate` and typed observation result types.
- Change raw `explore_code` sub-agent tool to record structured `CodeExplorerResult` data before
  formatting it for display.
- Convert grep/read/list observations into typed candidates at the boundary.
- Remove regex parsing of rendered compiler Markdown from report construction.

Acceptance:

- Deterministic code consumes typed candidates only.
- Rendered Markdown is no longer an internal data protocol.

### Phase 3: Worker-Owned Generic Ranking

- Move generic file/candidate ranking into the worker where graph signal is available.
- Return score components/provenance so the value model can see why candidates were selected.
- Add generic fallback retrieval channels for framework/path/lexical cases the graph cannot see.
- Remove duplicate sub-agent-side ranking except generic budget/dedupe validation.

Acceptance:

- Candidate order is explainable from structured generic features.
- Weak compiler graph results can still produce useful generic candidates.
- No product-specific path or symbol terms are needed to rank candidates.

### Phase 4: Model-Authored Report With Validator

- Stop replacing non-empty model reports with deterministic reports.
- Ask the value model to choose primary files and write findings from the candidate packet.
- Give the value model enough tool-step budget to explore and verify the map before reporting.
- Add deterministic validator/repair.
- Keep deterministic report generation only as fallback.

Acceptance:

- The normal report path is model-authored and validator-approved.
- Invalid model reports degrade to low-confidence targeted guidance rather than broad search.

### Phase 5: Main Prompt Tightening

- Keep main-model trust guidance, but make it depend on validator-approved reports.
- Tell the main model that validated high/medium reports should be treated as the code map.
- Keep re-search allowed only when:
  - confidence is low;
  - validator reported missing coverage;
  - user asks for exact code edits and validated read targets must be opened.

Acceptance:

- High/medium reports reduce main broad search calls on held-out tasks.

### Phase 6: Held-Out Benchmark

- Add held-out repos/tasks before further tuning.
- Run known and held-out suites with repeats >= 3.
- Report density and generalization metrics together.

Acceptance:

- Held-out quality does not regress.
- Main uncached/cached context decreases on median.
- Follow-up broad search after high/medium reports decreases.

## Risks

- Short-term benchmark scores may drop when memorized path boosts are deleted.
- Model-authored reports may need validator repair more often at first.
- Unit tests will require significant rebaselining because many currently encode overfit behavior.
- Typed observation plumbing touches tool/report boundaries and needs focused test coverage.

These risks are acceptable. The current alternative is a code explorer that looks good on its own
benchmark and becomes less trustworthy as it accumulates special cases.

## Immediate Next Step

Start with Phase 1 and Phase 2 together:

1. delete domain-specific scorer branches and benchmark augmentation probes;
2. replace exact-path tests with generic invariant tests;
3. introduce typed candidates so the next phase can remove Markdown parsing cleanly.

Do not add new benchmark-specific compensating heuristics if scores dip. A dip is signal that the
benchmark was being memorized.
