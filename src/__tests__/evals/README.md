# Evals

LLM eval suite for tool-use quality. Currently covers the `search_replace` tool
across Claude Sonnet 4.6, GPT 5.4, and Gemini 3 Flash. Each case gives the
model a real source file plus an editing instruction, runs the model with the
`search_replace` tool wired up, applies the produced edits, and then asks an
LLM judge (GPT 5.4) whether the result satisfies the instruction.

## Prerequisites

All models are routed through the Dyad Engine gateway, so you only need one
credential: a Dyad Pro API key, exposed as `DYAD_PRO_API_KEY`.

The suite is skipped entirely when `DYAD_PRO_API_KEY` is unset — no tests will
fail, they just won't run. This keeps regular `vitest run` safe for contributors
without a key.

Export the key for the session:

```bash
export DYAD_PRO_API_KEY="..."
npm run eval
```

Or set it inline for a single command:

```bash
DYAD_PRO_API_KEY="..." npm run eval
```

Optional: override the gateway URL with `DYAD_ENGINE_URL` (defaults to
`https://engine.dyad.sh/v1`).

## Running the suite

Run every case against every model:

```bash
npm run eval
```

**Heads up — this is expensive.** Each full run issues one generation per
(model × case) pair plus one judge call per case, across 12 cases and 3
models. Expect dozens of LLM requests, some of which run reasoning models on
300+ line fixtures. Use sparingly; prefer single-case runs during development.

### Running a single case

Vitest's `-t` flag filters by test name. Case names are the `name` field in
the `CASES` array of
[search_replace_tool_use.eval.ts](search_replace_tool_use.eval.ts).

```bash
DYAD_PRO_API_KEY="..." npm run eval -- -t "Extract a helper function"
```

`-t` matches as a substring, so a short unique fragment works too:

```bash
DYAD_PRO_API_KEY="..." npm run eval -- -t "zod"
```

### Running against one model

Set `EVAL_MODEL` to a case-insensitive substring of the model's label or
model name. It matches against both, so short fragments like `sonnet`, `gpt`,
or `gemini` work:

```bash
EVAL_MODEL=sonnet DYAD_PRO_API_KEY="..." npm run eval
```

Combine it with `-t` to run one case against one model:

```bash
EVAL_MODEL=sonnet DYAD_PRO_API_KEY="..." npm run eval -- -t "Extract a helper function"
```

Note: vitest's `-t` pattern is applied across the full describe/test hierarchy
as a regex, which makes "model label > case name" style patterns brittle
across vitest versions. Prefer `EVAL_MODEL` for model filtering and reserve
`-t` for case-name filtering.

## Where results are stored

Every run writes structured output to `eval-results/` at the repo root. The
directory is gitignored and never cleaned automatically — delete old runs by
hand when you want to.

Layout:

```
eval-results/
  search_replace_eval/
    <run-start-ts>__<model-label>/     ← one folder per (run, model)
      <case-name>/                     ← one folder per case
        record.json                    ← full structured record
        record.txt                     ← human-readable render of the same
        tool_calls/
          01.txt                       ← combined view of tool call #1
          01/                          ← split view, one piece per file
            old_string.ts
            new_string.ts
            file_before.ts
            file_after.ts
            diff.patch
            meta.txt
          02.txt
          02/
          ...
```

`<run-start-ts>` is captured once at process start, so every case from the
same `npm run eval` invocation for a given model clusters into one folder.
Folder names sort chronologically under `ls`.

### Record format

`record.json` contains the complete machine-readable record. Key fields:

- `timestamp`, `suite`, `caseName` — identifying metadata.
- `model` — `{label, provider, modelName, responseModelId}`. `responseModelId`
  is the exact model string the gateway echoed back, which can differ from
  `modelName` (e.g. dated snapshots).
- `llm.totalDurationMs`, `llm.totalUsage` — wall-clock time and token totals
  for the model under test (not the judge).
- `llm.requests` — per-step breakdown: each entry is one HTTP round-trip with
  its own duration, usage, and `finishReason`.
- `toolCalls` — every `search_replace` call the model made. Each entry
  records the arguments (`filePath`, `oldString`, `newString`), the file
  before and after the call, and a unified diff of just that call.
- `diff` — unified diff from the original fixture to the final file
  (i.e. the cumulative effect of all tool calls).
- `judge` — the judge's verdict: `label`, `modelName`, `durationMs`,
  `usage`, `pass` (boolean), and `explanation` (the judge's written
  reasoning, with the trailing `PASS`/`FAIL` verdict line stripped).
- `passed` — the overall test outcome. Requires the judge to say `PASS` *and*
  all structural checks to pass *and* no exceptions to be thrown.
- `errorMessage` — set when the test threw (tool-call failure, structural
  check failure, judge FAIL, etc.); `null` otherwise.

`record.txt` is a readable render of the same information — headers, inline
tool-call bodies, usage totals, the final diff, and the judge's explanation.
Open it when you want a quick human-readable summary instead of parsing JSON.

The `tool_calls/` subdirectory exists for per-call inspection. Each call
gets a combined `NN.txt` (everything about the call in one file) and a
`NN/` folder containing the raw pieces as standalone files with the source
extension preserved — useful for opening in an editor with syntax
highlighting or for diffing two calls against each other.
