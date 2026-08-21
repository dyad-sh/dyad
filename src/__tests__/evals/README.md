# Evals

LLM eval suite for tool-use quality. Five suites run the same 16 cases across
the model matrix (Claude Sonnet 4.6, GPT 5.4, Gemini 3 Flash, GPT 5.6 Sol,
GPT 5.6 Luna) but with different tool sets and system prompts:

| Suite name               | Tools available                | System prompt                                |
| ------------------------ | ------------------------------ | -------------------------------------------- |
| `search_replace`         | `search_replace` only          | Minimal custom "precise code editor" prompt  |
| `search_replace_few`     | `search_replace` only          | Variant prompt encouraging fewer tool calls  |
| `basic_agent`            | `search_replace`, `write_file` | Production `LOCAL_AGENT_BASIC_SYSTEM_PROMPT` |
| `pro_agent`              | `search_replace`, `write_file` | Production `LOCAL_AGENT_SYSTEM_PROMPT` (Pro) |
| `pro_agent_experimental` | `search_replace`, `write_file` | Editable copy of the Pro prompt for tweaking |

The `newline_probe` suite is separate: it runs its own four cases (not the
shared 16), skips the LLM judge, and measures `search_replace` serialization
mechanics rather than edit quality. See [Newline probe](#newline-probe).

Each case gives the model a real source file plus an editing instruction,
runs the model with the suite's tools wired up, applies the produced edits,
and then asks an LLM judge (GPT 5.4) whether the result satisfies the
instruction.

## Prerequisites

All models are routed through the Dyad Engine gateway, so you only need one
credential: a Dyad Pro API key, exposed as `DYAD_PRO_API_KEY`.

The suite is skipped entirely when `DYAD_PRO_API_KEY` is unset — no tests will
fail, they just won't run. This keeps regular `vitest run` safe for contributors
without a key.

Export the key for the session (plus the two required filter vars — see
[Running the suite](#running-the-suite)):

```bash
export DYAD_PRO_API_KEY="..."
EVAL_SUITE=all EVAL_MODEL=all npm run eval
```

Or set everything inline for a single command:

```bash
DYAD_PRO_API_KEY="..." EVAL_SUITE=all EVAL_MODEL=all npm run eval
```

Optional: override the gateway URL with `DYAD_ENGINE_URL` (defaults to
`https://engine.dyad.sh/v1`).

## Running the suite

**Both `EVAL_SUITE` and `EVAL_MODEL` are required.** A full run of every
suite against every model is expensive, so the suite will not run unless
the caller opts in explicitly. If either variable is unset, the eval prints
a warning describing how to configure it and registers a single skipped
placeholder — it does not fail CI, but it also does not run any cases.

Use the special value `all` to mean "run everything":

```bash
# Run every suite against every model against every case.
EVAL_SUITE=all EVAL_MODEL=all DYAD_PRO_API_KEY="..." npm run eval
```

**Heads up — this is expensive.** A full `all`/`all` run issues one
generation per (suite × model × case) triple plus one judge call per case,
across 5 suites, 5 models, and 16 cases. Expect dozens of LLM requests,
some of which run reasoning models on 300+ line fixtures. Use sparingly;
prefer narrow filters during development.

### Running a single suite

Set `EVAL_SUITE` to the exact `name` (case-insensitive) of the suite — the
same name that appears as a folder under `eval-results/`. A comma-separated
list runs multiple suites:

```bash
# Just the original search_replace-only suite
EVAL_SUITE=search_replace EVAL_MODEL=all DYAD_PRO_API_KEY="..." npm run eval

# The basic_agent suite (Basic agent prompt, search_replace + write_file)
EVAL_SUITE=basic_agent EVAL_MODEL=all DYAD_PRO_API_KEY="..." npm run eval

# The pro_agent suite (Pro agent prompt, search_replace + write_file)
EVAL_SUITE=pro_agent EVAL_MODEL=all DYAD_PRO_API_KEY="..." npm run eval
```

Note: `EVAL_SUITE` matches suite `name`s exactly (case-insensitive), and
accepts a comma-separated list for multiple suites (e.g.
`EVAL_SUITE=search_replace,basic_agent`). Unknown names error out with the
available list.

### Running a single case

Vitest's `-t` flag filters by test name. Case names are the `name` field in
the `CASES` array of [tool_use.eval.ts](tool_use.eval.ts).

```bash
EVAL_SUITE=all EVAL_MODEL=all DYAD_PRO_API_KEY="..." \
  npm run eval -- -t "Extract a helper function"
```

`-t` matches as a substring, so a short unique fragment works too:

```bash
EVAL_SUITE=all EVAL_MODEL=all DYAD_PRO_API_KEY="..." npm run eval -- -t "zod"
```

### Running against one model

Set `EVAL_MODEL` to a case-insensitive substring of the model's label or
model name. It matches against both, so short fragments like `sonnet`, `gpt`,
or `gemini` work:

```bash
EVAL_SUITE=all EVAL_MODEL=sonnet DYAD_PRO_API_KEY="..." npm run eval
```

### Combining filters

`EVAL_SUITE`, `EVAL_MODEL`, and `-t` compose. A tight development loop:

```bash
EVAL_SUITE=search_replace EVAL_MODEL=sonnet \
  DYAD_PRO_API_KEY="..." npm run eval -- -t "Extract a helper function"
```

Note: vitest's `-t` pattern is applied across the full describe/test
hierarchy as a regex, which makes "model label > case name" style patterns
brittle across vitest versions. Prefer `EVAL_SUITE` / `EVAL_MODEL` for
suite and model filtering and reserve `-t` for case-name filtering.

## Where results are stored

Every run writes structured output to `eval-results/` at the repo root. The
directory is gitignored and never cleaned automatically — delete old runs by
hand when you want to.

Layout:

```
eval-results/
  <suite-name>/                          ← one top-level folder per suite
    <run-start-ts>__<model-label>/       ← one folder per (run, model)
      <case-name>/                       ← one folder per case
        record.json                      ← full structured record
        record.txt                       ← human-readable render of the same
        details/                         ← per-record split views
          file_before.<ext>              ← file at the start of the run
          file_after.<ext>               ← file at the end of the run
          diff.patch                     ← cumulative unified diff
          system_prompt.txt              ← system prompt sent to the model
          instructions.txt               ← case instructions (no file content)
          user_prompt.txt                ← full user message (file + instructions)
          metadata.json                  ← run metadata without big blobs
          metadata.txt                   ← same info, human-readable
        tool_calls/
          01.txt                         ← combined view of tool call #1
          01/                            ← split view, one piece per file
            file_before.<ext>
            file_after.<ext>
            diff.patch
            meta.txt
            <arg_name>.<ext>             ← one file per tool arg (see below)
          02.txt
          02/
          ...
```

The top-level folder is the suite `name`, so each suite lands in its own
directory:

- `eval-results/search_replace/`
- `eval-results/search_replace_few/`
- `eval-results/basic_agent/`
- `eval-results/pro_agent/`
- `eval-results/pro_agent_experimental/`

`<run-start-ts>` is captured once at process start, so every case from the
same `npm run eval` invocation for a given (suite, model) pair clusters into
one folder. Folder names sort chronologically under `ls`.

### Record format

`record.json` contains the complete machine-readable record. Key fields:

- `timestamp`, `suite`, `caseName` — identifying metadata.
- `model` — `{label, provider, modelName, responseModelId}`. `responseModelId`
  is the exact model string the gateway echoed back, which can differ from
  `modelName` (e.g. dated snapshots).
- `prompt` — `{system, instructions, user}`. `system` is the full system
  prompt sent to the model (including the production agent prompts when the
  suite uses one). `instructions` is the bare case instruction — useful for
  scanning what was asked without the fixture file inlined. `user` is the
  full user message actually sent (file content + instructions).
- `file` — `{name, before, after}`. The fixture file name plus its content
  at the start and end of the run. `before` / `after` are also written to
  `details/file_before.<ext>` / `details/file_after.<ext>` for easy editor
  opening with matching syntax highlighting.
- `llm.totalDurationMs`, `llm.totalUsage` — wall-clock time and token totals
  for the model under test (not the judge).
- `llm.requests` — per-step breakdown: each entry is one HTTP round-trip with
  its own duration, usage, and `finishReason`.
- `toolCalls` — every tool call the model made. Each entry records
  `toolName`, `filePath`, an `args` map (keyed by the tool's parameter names,
  so `old_string`/`new_string` for `search_replace`, `content` for
  `write_file`), the file before and after the call, and a unified diff of
  just that call.
- `diff` — unified diff from the original fixture to the final file
  (i.e. the cumulative effect of all tool calls).
- `judge` — the judge's verdict: `label`, `modelName`, `durationMs`,
  `usage`, `pass` (boolean), and `explanation` (the judge's written
  reasoning, with the trailing `PASS`/`FAIL` verdict line stripped).
- `passed` — the overall test outcome. Requires the judge to say `PASS` _and_
  all structural checks to pass _and_ no exceptions to be thrown.
- `errorMessage` — set when the test threw (tool-call failure, structural
  check failure, judge FAIL, etc.); `null` otherwise.

`record.txt` is a readable render of the same information — headers, the
system prompt and instructions, inline tool-call bodies, usage totals, the
final diff, and the judge's explanation. Open it when you want a quick
human-readable summary instead of parsing JSON.

### The `details/` folder

`details/` is a split view of the record, intended for quick inspection and
diffing without having to parse JSON or scroll through `record.txt`:

- `file_before.<ext>` / `file_after.<ext>` — raw file content before and
  after the run, with the fixture's extension preserved so editors apply
  the right syntax highlighting.
- `diff.patch` — the same unified diff as `record.diff`.
- `system_prompt.txt`, `instructions.txt`, `user_prompt.txt` — the three
  views of the prompt input.
- `metadata.json` / `metadata.txt` — everything from `record.json` minus the
  large content blobs that already have their own files (no inline file
  contents and no per-tool-call entries). Useful for skimming token counts,
  judge verdict, and model identity across many runs.

### The `tool_calls/` folder

One `NN.txt` (combined view) and one `NN/` folder (split view) per tool
call. The split view contains the raw pieces as standalone files:

- `file_before.<ext>`, `file_after.<ext>`, `diff.patch` — file state around
  the single call.
- `meta.txt` — timestamp, tool name, target path, and per-arg length summary.
- One file per tool argument, named after the arg's key. String args use the
  target file's extension (for syntax highlighting); non-string args become
  JSON blobs. So a `search_replace` call produces `old_string.ts` and
  `new_string.ts`; a `write_file` call produces `content.ts` and
  `description.ts`.

## Newline probe

`search_replace` builds its operations string by joining the model's raw args
with newline delimiters:

```
<<<<<<< SEARCH\n${old_string}\n=======\n${new_string}\n>>>>>>> REPLACE
```

A newline that merely _terminates_ an arg therefore becomes a trailing empty
line in the parsed block. On the search side that empty line matches nothing,
the processor's `trimEmptyLines` fallback rescues the match, and — before the
fix — nothing trimmed the replace side, so the phantom line was written into
the file as a stray blank line.

This suite measures how often real models send the triggering arg shape.
Every `search_replace` call is applied twice: once with the current
serialization and once with a counterfactual that trims the terminator.
Divergence marks a call the defect fires on.

```bash
DYAD_PRO_API_KEY="..." EVAL_SUITE=newline_probe EVAL_MODEL="GPT 5.6 Sol" npm run eval
```

`EVAL_SKIP_JUDGE=1` skips the judge round-trip on any suite, which halves the
spend when you only care about serialization mechanics.

### What the first run found

Across 82 applied `search_replace` calls from GPT 5.6 Sol (the shared 16-case
`search_replace` suite):

|                                           | count        |
| ----------------------------------------- | ------------ |
| applied calls                             | 82           |
| both args newline-terminated (symmetric)  | 18           |
| `new_string`-only terminated (asymmetric) | 0            |
| `trimEmptyLines` fallback fired           | 7            |
| **corrupted**                             | **7 (8.5%)** |

All 7 were the symmetric shape. The model terminates both args because it
copies a contiguous region of the file — in 18 of 18 symmetric calls the
replace block ended on the same line the search block ended on, i.e. copied
context rather than an authored blank line. Corruption followed in exactly the
7 cases where the file had no real blank line at that boundary.

Reading a report:

- **Non-zero divergence** — the defect reproduced. The summary prints a
  `current` vs `fixed` unified diff per affected call, and the offending args
  sit in that run's `tool_calls/NN/` folder as ready-made fixtures.
- **Zero divergence** — the defect did not fire for that model on those cases.

### Known gap

The processor fix covers the symmetric shape only, because it lives inside the
`trimEmptyLines` fallback and an unterminated `old_string` matches as-is, so
the fallback never fires. The asymmetric shape (`new_string` terminated,
`old_string` not) still writes a stray blank line. It was not observed once in
82 calls, so it is unfixed by choice rather than oversight — the probe stays
live for it, and `helpers/newline_probe.spec.ts` pins the behavior.

Output goes to `eval-results/newline_probe/` (`samples.json` plus
`summary.txt`), accumulated across runs, in addition to the per-case records.

The probe's own detector is unit-tested in `helpers/newline_probe.spec.ts`,
which runs in the normal `vitest` suite with no API key. That test matters: the
first version of this probe compared against an asymmetric-only counterfactual,
which by construction leaves symmetric calls untouched — so it reported "0
corrupted" while 7 real corruptions sat in the data. The spec now pins that
blind spot explicitly.

## Recorded calls

`recorded_calls/<model>/` holds real `search_replace` tool calls captured from
eval runs, stored as the operations strings the tool builds from the model's
arguments. `recorded_calls.spec.ts` replays them against the current processor.

Each case starts from a fixture already in `fixtures/`, so replaying the calls
in order reconstructs the edit session. That keeps the evidence behind the
newline findings reviewable without an API key and without `eval-results/`,
which is gitignored and gets wiped.

The assertion is that an applied call produces exactly what replacing the first
verbatim occurrence of `old_string` with `new_string` produces — the tool's
whole contract, and the thing a trailing newline in the arguments breaks.

To add cases, copy `old_string` / `new_string` out of a run's `tool_calls/NN/`
folder into `<model>/<case>/NN.txt` in the marker format, and list the case
under that model in `manifest.json` with the fixture it starts from.

### Replaying against the pre-fix processor

The current processor no longer writes stray blank lines, so replaying these
calls against it shows none. `helpers/legacy_search_replace.ts` is a frozen
copy of the processor as it stood at `67c9ee7c`, the commit before
[#4338](https://github.com/dyad-sh/dyad/pull/4338), kept so the recordings can
still be replayed against the behavior they were captured from.

The spec replays both by default and asserts each model's totals, so the
measurement is pinned in CI rather than described in prose:

| model        | processor    | applied | did not match | stray blank lines |
| ------------ | ------------ | ------- | ------------- | ----------------- |
| GPT 5.6 Sol  | before #4338 | 9       | 7             | 7                 |
| GPT 5.6 Sol  | current      | 11      | 5             | 0                 |
| GPT 5.6 Luna | before #4338 | 5       | 0             | 2                 |
| GPT 5.6 Luna | current      | 5       | 0             | 0                 |

Sol's applied count goes up because two calls that could not match were being
blocked by a stray blank line an earlier call had introduced.

Both models produce the defect, at different rates. Over the full runs these
recordings were drawn from, Sol corrupted 7 of 82 applied calls and Luna 2 of
116, so the recorded set is the corrupting subset rather than a sample.

To replay only one implementation:

```bash
SEARCH_REPLACE_IMPL=legacy npx vitest run src/__tests__/evals/recorded_calls.spec.ts
SEARCH_REPLACE_IMPL=current npx vitest run src/__tests__/evals/recorded_calls.spec.ts
```

`legacy_search_replace.ts` is a historical snapshot. It should not be updated
to track the real processor - its only job is to keep producing the old output.
