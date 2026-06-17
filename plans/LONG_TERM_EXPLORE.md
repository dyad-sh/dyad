# Long-Term Explore Architecture

> Written 2026-06-09 after the deterministic-report experiment in
> `src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts` and the follow-up
> discussion about generalizability, main-context density, and model-authored source references.

## Summary

The long-term `explore_code` architecture should separate judgment from authority.

The value model is good at deciding what evidence matters after broad exploration. It is not a
reliable authority for exact source references when it has to type paths, line ranges, and roles
from memory. Deterministic code is good at preserving exact observations, validating budgets, and
rendering canonical references. The right design is therefore:

```text
user query
  -> tools produce typed observed candidates
  -> candidate registry normalizes, dedupes, scores, and assigns stable IDs
  -> deterministic packer builds a bounded candidate packet
  -> value model selects candidate IDs, roles, confidence, and next action
  -> deterministic renderer emits the final verified report
  -> main model reads only useful files/ranges when raw source is actually needed
```

This is not a quarantine around benchmark hacks. Benchmark-specific production logic should be
deleted. The durable interface is observed candidates plus candidate-ID selection, not
repo-specific path knowledge.

## Current State

The current implementation has moved in the right direction by making deterministic,
host-rendered reports first-class. The sub-agent explores with tools, the final model text is
ignored, and `buildDeterministicReport(...)` emits a report from observed candidates only.

That fixed the source-reference reliability issue, but it is still an interim shape:

- deterministic ranking now carries too much judgment;
- the value model can explore but cannot yet express which observed candidates matter;
- the host renderer can only choose from heuristic top candidates;
- observed references are valid, but not always the best possible dense handoff for the main
  model.

The full benchmark run before this change showed why this matters. `explore_code` improved overall
cost and main uncached input, but all 24 explorer trials fell back to deterministic reporting
because model-authored reports failed validation. The largest validation failures were unobserved
paths, unobserved ranges, too-wide ranges, unsupported role claims, and density-budget violations.
Those are symptoms of the wrong contract: the model should not author raw references.

## Goals

- **Generalizability:** no production logic should mention benchmark repos, product flows, magic
  filenames, or task literals.
- **Dense main context:** the main model should receive a small verified map, not broad raw search
  output or huge files.
- **Broad sub-agent exploration:** the explorer should have enough room to investigate unfamiliar
  codebases. Use adaptive stopping and resource budgets, not a tiny fixed loop count.
- **Unrepresentable invalid refs:** the final report should only be able to cite paths and ranges
  that were observed by a tool.
- **Useful model judgment:** the value model should decide importance, roles, confidence, gaps, and
  next action by selecting IDs from a trusted candidate packet.
- **Measurement without benchmaxxing:** benchmarks should measure product behavior. They must not
  become production behavior.

## Non-Goals

- Hard-limiting the explorer to one or two tool calls.
- Forcing the main model to read exactly one file. Real tasks can require several files; the goal
  is to avoid useless files and huge ranges.
- Letting the value model type arbitrary `path:line` references.
- Inlining large raw source excerpts into the final report.
- Building a language-perfect semantic index before improving the current tool boundary.

## Core Invariant

The value model never writes source references directly.

It can select `candidateId`s, assign roles to those IDs, describe missing coverage, and choose a
recommended action. Deterministic code resolves IDs to canonical `path` and `range` values. Unknown
IDs are rejected or dropped. Unobserved ranges are impossible to render.

This keeps the model's judgment while removing its ability to fabricate references.

## Architecture

### 1. Typed Observations

Every exploration tool should emit structured observations at the host boundary:

- `explore_code_raw`: compiler/graph candidates with symbols, declarations, references, and
  declaration ranges;
- `grep`: structured matches with `path`, `line`, match text, literal/regex diagnostics, and
  bounded context metadata;
- `read_file`: structured read ranges with canonical path, start/end lines, file size, and whether
  the range was truncated;
- `list_files`: structured path candidates and directory traits, but no read target unless source
  was actually read;
- future tools: framework route scanners, import/call graph edges, package manifest readers, and
  repo-index caches.

Rendered Markdown is for humans and logs. It should not be parsed back into evidence when a typed
payload can exist.

### 2. Candidate Registry

Normalize all tool observations into a registry:

```ts
type CandidateId = `c${number}`;

interface ObservedCandidate {
  id: CandidateId;
  path: string;
  range: { start: number; end: number } | null;
  source:
    | "compiler"
    | "grep"
    | "read_file"
    | "list_files"
    | "framework"
    | "index";
  symbols: Array<{ name: string; kind: string; line: number }>;
  evidence: {
    summary: string;
    matchedTerms: string[];
    observedTextKinds: Array<
      "symbol" | "path" | "line" | "import" | "call" | "route"
    >;
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
      | "test"
    >;
  };
  roles: Array<
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
  scores: {
    lexical: number;
    graph: number;
    pathTrait: number;
    roleCoverage: number;
    rangeTightness: number;
    genericPenalty: number;
  };
  provenance: Array<{ tool: string; reason: string }>;
  estimatedTokens: number;
}
```

The registry is responsible for:

- canonical app-relative paths;
- line-range snapping to observed declarations or read windows;
- dedupe by path/range/symbol/source;
- merging provenance from multiple tools;
- estimating token cost before anything reaches the main model;
- preserving a larger internal recall pool than the final report will use.

### 3. Candidate Packet

The value model should receive a compact packet, not raw tool dumps:

```ts
interface CandidatePacket {
  query: string;
  budget: {
    maxPrimary: number;
    maxReadTargets: number;
    maxReportChars: number;
  };
  candidates: ObservedCandidateSummary[];
  coverageHints: string[];
  knownGaps: string[];
  toolStats: {
    toolCalls: number;
    candidatesSeen: number;
    diagnostics: string[];
  };
}
```

The packet can include more candidates than the final report, but it must still be bounded. A
reasonable starting point:

- internal registry: many candidates, limited by elapsed time and memory;
- model packet: top 20-40 diverse candidates;
- final primary files: usually 3-6;
- final read targets: usually 1-6, with tight ranges;
- report text: around one screen, with structured metadata.

The packer should enforce diversity. It should avoid sending 20 near-duplicate files from the same
directory or role. It should also avoid support, fixture, generated, docs, and test files unless the
query asks for those surfaces or they are necessary to understand the flow.

### 4. Model Selection

The value model receives the packet and returns a structured selection:

```ts
interface ExploreSelection {
  primaryCandidateIds: CandidateId[];
  secondaryCandidateIds: CandidateId[];
  readTargetIds: CandidateId[];
  roleAssignments: Array<{
    candidateId: CandidateId;
    role: ObservedCandidate["roles"][number];
    reason: string;
  }>;
  findings: string[];
  flowSummary: string;
  recommendedPrimaryAction:
    | "answer_from_report"
    | "read_targets"
    | "targeted_gap_search"
    | "skip_explore_result";
  confidence: "high" | "medium" | "low";
  missingCoverage: string[];
  needMoreEvidence?: {
    roleGap: string;
    targetedQueries: string[];
    preferredTools: string[];
  };
}
```

This should be a schema-bound result or a dedicated tool call such as
`select_explore_candidates`. The model can be wrong about importance, but it cannot invent files.

The model may request more exploration when the packet is insufficient. That loop should be
adaptive:

- continue when a specific role gap remains and targeted searches are available;
- stop when role coverage is good enough for the recommended action;
- stop when additional loops produce mostly duplicate or low-signal candidates;
- use generous wall-time/tool-call budgets rather than a tiny fixed cap;
- record why the loop stopped.

The sub-agent should have space to explore unfamiliar codebases. The guardrail is not "few calls";
the guardrail is "do not leak broad, low-density output into the main context."

### 5. Deterministic Renderer

The renderer resolves selected IDs to canonical references and emits the final report:

- compact summary of what was found;
- primary files with roles and tight ranges;
- read targets only when raw source is useful for the main task;
- flow or dependency explanation in prose, without large source excerpts;
- confidence and missing coverage;
- recommended primary action;
- diagnostics separated from evidence.

If selection validation fails, the renderer should degrade predictably:

- drop unknown IDs;
- drop or lower unsupported role assignments;
- lower confidence when coverage is incomplete;
- optionally run one schema repair/selection pass;
- fall back to deterministic-only ranking when the value model fails.

### 6. Main Model Contract

The main model should treat a high/medium explorer report as a verified discovery map, not as a
prompt to redo broad exploration.

Expected behavior:

- for answer-only tasks, answer from the report when confidence and coverage are sufficient;
- for edit/debug tasks, read the selected edit ranges before modifying code;
- read multiple files when needed, but prefer selected ranges over whole files;
- avoid huge files unless no tight range exists and the report explains why;
- run targeted gap searches only for a named missing role, contradiction, or stale file.

This is realistic: the main model will often need several files. The optimization is that those
files should be useful and bounded.

## Ranking And Budgeting Principles

Candidate ranking must use generic features:

- exact identifier, symbol, or route match;
- action/noun co-occurrence from the user query;
- graph distance from matched declarations;
- inbound/outbound references and import edges;
- path traits such as route/component/hook/service/api/store/action/type/config;
- role coverage across entry, UI, handler, state, data/API, persistence, render/output;
- range tightness and estimated token cost;
- generic penalties for generated, fixture, docs-example, test, and support paths unless requested.

Candidate ranking must not use:

- benchmark repo names;
- benchmark task names;
- hard-coded product workflows;
- magic path boosts for known benchmark files;
- tests that assert a benchmark-specific path must outrank all generic evidence.

## Diagnostics Policy

Tool diagnostics are not evidence.

Examples:

- invalid regex fallbacks;
- 413 or payload-too-large responses;
- missing-file errors;
- truncated `read_file` ranges;
- unavailable TypeScript project errors.

These should help the explorer decide what to try next, but they should not appear as primary
findings unless the user's task is about tool behavior. The final report can include a short
diagnostic note only when it affects confidence or the recommended action.

Near-term robustness work:

- keep `grep` diagnostics separate from matches;
- return missing-file near matches as structured suggestions, not narrative evidence;
- make `code_search` shrink, chunk, or prefilter payloads when a request is too large;
- record diagnostics in benchmark metadata so leakage is measurable.

## Implementation Phases

### Phase 1: Observation Plumbing

- Add structured result adapters for `grep`, `read_file`, `list_files`, and `explore_code_raw`.
- Preserve existing user-visible tool output while recording typed observations internally.
- Add tests that assert observations are structured and app-relative.

### Phase 2: Candidate Registry And Renderer V2

- Introduce `ObservedCandidate`, `CandidateRegistry`, and candidate IDs.
- Move current deterministic report construction onto the registry.
- Keep final reports host-rendered and observed-only.
- Add invariant tests: unknown paths/ranges cannot render.

### Phase 3: Candidate Packet And Selection Schema

- Build a bounded, diverse `CandidatePacket`.
- Add schema-bound value-model selection by candidate ID.
- Render final reports from selected IDs only.
- Keep deterministic-only fallback for model failure.

### Phase 4: Adaptive Exploration Loop

- Let the selection response request targeted follow-up evidence.
- Stop based on coverage, duplicate yield, elapsed time, and budget.
- Log stop reasons and candidate-yield curves.
- Avoid restrictive caps that prevent legitimate exploration.

### Phase 5: Declaration-Aware Ranges

- Snap compiler candidates to declaration, JSX component, handler, or route spans.
- Prefer range reads over whole files, especially for huge files.
- Allow wider ranges only when they correspond to a meaningful declaration or flow boundary.
- Add language/framework adapters incrementally, starting with TypeScript/React.

### Phase 6: Context Policy Integration

- Strengthen the main prompt/tool guidance around high/medium reports.
- Make recommended actions machine-readable in the tool result.
- Track whether the main model follows report read targets or redoes broad exploration.

### Phase 7: Benchmark And Held-Out Evaluation

- Run the full benchmark suite with repeats.
- Add held-out repos/tasks before optimizing thresholds.
- Compare at least these arms:
  - no explorer baseline;
  - deterministic-only renderer;
  - current explorer with deterministic report;
  - candidate-ID selection plus deterministic renderer.
- Hillclimb only generic thresholds and packet budgets.

## Measurement

Primary metrics:

- main uncached input tokens;
- main cached input tokens;
- final answer quality/rubric pass;
- number and size of main `read_file` calls;
- number of useless or huge files read by the main model.

Secondary metrics:

- combined cost;
- sub-agent cost;
- elapsed time;
- sub-agent tool calls;
- duplicate candidate yield;
- invalid selection repair rate;
- diagnostic leakage into final answers;
- stale-file/cache invalidation misses.

Generalization guardrails:

- run repeats, because single-run variance is large;
- include held-out repositories;
- review production diffs for repo/task literals;
- tests should assert invariants and generic behavior, not benchmark-specific winners.

## Risks

- **Deterministic prefilter drops the real target.** Keep a larger internal recall pool and allow
  targeted `needMoreEvidence` loops.
- **Candidate packet gets too large.** Enforce diversity, role coverage, and token budgets before
  the value-model call.
- **Selection IDs are too lossy for model judgment.** Include compact evidence summaries, matched
  terms, symbols, traits, and provenance in the packet.
- **The model selects too many files.** Validate final budgets and require reasons tied to roles.
- **The main model ignores the report.** Make recommended actions structured and measure follow-up
  behavior in traces.
- **Latency regresses.** Reuse the TypeScript worker/index and cache candidate registries by file
  mtime/size when safe.

## Acceptance Criteria

- Production explorer logic contains no benchmark repo/task/path hacks.
- The value model cannot author raw file paths or line ranges in the final report.
- Final reports contain only observed, canonical references.
- Reports stay compact while still explaining the flow and useful next action.
- The main model reads selected ranges or targeted gaps, not broad useless files.
- Candidate-ID selection matches or beats deterministic-only quality on held-out tasks without
  bloating main context.
- Full benchmark improvements survive repeats and code review for generality.
