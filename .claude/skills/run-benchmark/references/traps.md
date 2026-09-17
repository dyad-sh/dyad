# Traps that produced wrong numbers (and the guard for each)

Every item here cost at least one full arm before it was understood. The
guards are in the scripts; this file explains what they protect against so
a new failure can be recognised as new.

## Model not in the pinned catalog → Anthropic output silently capped at 4096

The proxy serves a PINNED catalog. A model absent from the pin resolves to
`maxOutputTokens = undefined`, and the AI SDK Anthropic provider then sends
`max_tokens: 4096`. Every large `write_file` truncates, the model re-reads and
retries, and the cell "implements nothing after milestone 1" (six fable-5.1
cells lost this way). Guard: `run-cell.sh` refuses a model the proxy's catalog
lacks; always start proxies with `APPBENCH_CATALOG=<pin that has the model>`.
Ledger tell-tale: `maxTokens` missing on every row, responses at exactly 4096
completion tokens.

## Catalog maxOutputTokens is sent verbatim as max_tokens

The opposite failure: muse-spark-1.3's catalog entry said 943,718. OpenRouter
counts prompt + max_tokens against the 1,048,576 context, so every request
past ~105k prompt tokens was refused (400) and the eval aborted the cell.
Guard: read the new model's `maxOutputTokens` in the pin and compare with the
provider's context accounting; if absurd, copy the pin and cap it (65,536 was
used), note it in the pin's `appbenchNote`, and disclose it in RESULTS.

## Effort override lives in the PROXY's env

`APPBENCH_EFFORT` is applied by the proxy (as `reasoning.effort` /
`reasoning_effort`, or a Gemini `thinking.budget_tokens`). A driver that set
it only on `run-cell.sh` produced a whole arm labelled `xhigh` that ran at the
product default. Guard: `/healthz` reports the proxy's effort and run-cell
refuses a mismatch. Ledger tell-tale: `effort` column ≠ the cell's suffix.

## Gemini effort on the engine path is a thinking BUDGET

Through the engine (LiteLLM) Dyad sends Gemini `thinking: {type: "enabled",
budget_tokens: N}` with medium = 4000 and high = -1 (dynamic), not a
`thinkingLevel`. The proxy override mirrors that mapping for `gemini/` models
and records `thinking:enabled:budget=N`.

## Judge returned an empty body → verdict silently scored as 0

The judge (`gpt-5.6-sol`) capped `max_tokens` at 1500 on chat/completions,
where its own reasoning tokens count against the cap; on larger checkpoints
it returned a 0-byte body twice and `report.mjs` counted the missing verdict
as judge = 0 (up to ~4 composite points per checkpoint). Ten historical
checkpoints were affected; nine were backfilled (cap now 6000). Guard:
`scripts/find-missing-judges.sh` after every scoring pass.

## Provider-side faults mid-cell abort before the checkout is archived

Seen: Vertex "Corrupted thought signature" 400 (Gemini via LiteLLM), OpenRouter
429 "temporarily rate-limited upstream" and 503 "Provider returned error"
(Muse). The eval's stream-error assertion fails, milestone 3 never runs, and
`s-score.sh` reports "no archived checkout". These are not model capability:
rerun the cell with `--label r2` and map it in `report.mjs` `CELL_OVERRIDES`
(one comment per entry saying why). Never override a cell for a bad score.

## Parallel cells against a throttled upstream

Three concurrent Muse cells turned 25-minute milestones into 70-minute ones
full of 5–8 minute stalls, and cost 2–3x. When a provider shows 429/503 or
multi-minute request durations in the ledger, use `--sequential` and one arm
at a time.

## Drain-check probe traps

The startup probe once read the model from an env var that was not yet set
(it probed gpt-5.6-luna for every cell), used `max_tokens: 1` (OpenRouter
refuses that for reasoning models), only `max_tokens` (gpt-6-astra requires
`max_completion_tokens`), and lacked the `gemini/` / `anthropic/` gateway
forms. All fixed in `run-cell.sh`; a "REJECTED both forms" message with a
brand-new model usually means a new variant of this, not a bad model.

## Duplicate data-testid = strict-mode failure on every journey

The suites use strict Playwright locators. An app that renders the same
`data-testid` on two elements fails every journey that touches it (Gemini
3.8 Flash Deskhero, all three checkpoints). This is a legitimate contract
failure — the spec lists each id as one element — and 14 other cells have
tripped it once. Do not "fix" the app or the suite for it.

## Machine limits

16 GB Mac mini: three parallel builds is comfortable (~5 GB), six is the
ceiling (~3.5 GB headroom). Each build is a Next dev server plus the harness
with a 12 GB heap limit (`NODE_OPTIONS=--max-old-space-size=12288` in
run-cell). Playwright browsers can be garbage-collected by an app's `pnpm
install`; `PLAYWRIGHT_SKIP_BROWSER_GC=1` is set by run-cell and s-score.

## Judge cost note

Every judge call is a real gpt-5.6-sol request (~$0.10–0.30). A full 3-app
scoring pass is 9 calls; backfills and reruns add up.
