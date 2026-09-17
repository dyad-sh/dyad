---
name: dyad:run-benchmark
description: Run the app-builder benchmark (benchmarks/app-builder) for one or more models — build the three apps through headless Dyad against neon-sim and the recording proxy, score them (Playwright CUJs + security probes + LLM judge), verify the wire ledger, and regenerate RESULTS.md and the scores page. Use this whenever the user asks to benchmark, bench, or eval a model, run it "at low/high effort", compare cost or scores of models on the apps, rerun a lost cell, or asks what a model scored. Also use it for follow-up questions about a run (why a checkpoint failed, how much it cost) — the procedures for diagnosing cells live here.
---

# Run the app-builder benchmark

The benchmark measures cost (exact wire token counts × pinned list prices),
quality (60% fixed Playwright customer-journey suites + 25% security probes +
15% single LLM judge, per checkpoint, averaged over three milestones) and
duration, for building three apps (Relay CRM, Deskhero, Portalis) with Dyad's
local-agent mode. Everything is n=1 per cell, so a single bad line in one
milestone moves an app column by 30 points; read every number with that in
mind and say so when reporting.

## Where things are

`BENCH` = the `benchmarks/app-builder` directory. It is not on every
checkout: look in the current repo first, then the sibling checkout the user
runs benchmarks from (as of 2026-09 that is `/Volumes/essd/dyad-2`, whose
`benchmarks/app-builder` carries uncommitted hardening). Export `BENCH` for the
bundled scripts if it is not under this repo. Key pieces:

| Piece           | Path                                                                                                                          | Role                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cell runner     | `run-cell.sh <provider/model>`                                                                                                | one model × one app × 3 milestones through the headless harness; guards (engine drain probe, proxy effort match, model-in-pin)                       |
| Recording proxy | `proxy/engine-proxy.mjs --port P --cell ID`                                                                                   | sits at `DYAD_ENGINE_URL`; serves the pinned catalog; forces effort; writes `proxy/logs/requests-<cell>.jsonl`; enforces `APPBENCH_CELL_CEILING_USD` |
| Backend sim     | `neon-sim/server.mjs`                                                                                                         | Neon control-plane + auth + TLS SQL proxy on :7788 / :443 / :5433 (wildcard bind required on macOS)                                                  |
| Scorer          | `s-score.sh <cellId>` (env `APPBENCH_APP`, `APP_PORT`)                                                                        | clones each checkpoint snapshot, builds, runs the suite, then `judge/judge.mjs`                                                                      |
| Report          | `node report.mjs` → `RESULTS.md`; `./make-scores.sh` → `results/videos/scores.html`; `./make-gallery.sh` → demo-video gallery | served on the tailnet by `serve-gallery.sh`                                                                                                          |
| Pins            | `catalog/catalog-<date>.json`, `pricing/pricing.json`                                                                         | never overwrite a pin; historical runs reference them                                                                                                |
| Bundled here    | `scripts/run-arm.sh`, `scripts/verify-ledger.mjs`, `scripts/find-missing-judges.sh`                                           | the driver and the two checks that catch silent failures                                                                                             |

Cell ids are `<slug>-<app>[-<effort>][-<label>]` where slug = the model spec
with the provider stripped and non `[a-z0-9.-]` chars replaced by `_`
(`openrouter/z-ai/glm-5.3` → `z-ai_glm-5.3`). The unsuffixed cell is the
product default; a tier suffix only exists for forced tiers. Artifacts per
cell: `results/s-cell/<cell>.summary.json` (+ `.m<k>.messages.json`,
`checkouts/<cell>`), `results/s-score/<cell>-ckpt<k>-a1.json`,
`results/judge/<cell>-m<k>.json`, `proxy/logs/requests-<cell>.jsonl`.

## Procedure

1. **Preconditions.** `curl -sf http://127.0.0.1:7788/__sim/state` must answer
   (else `cd $BENCH/neon-sim && node server.mjs &`; if :443 is refused, quit
   the Tailscale app, which holds it, and restart). `DYAD_PRO_KEY` must be in
   the environment or the repo `.env`. Free ports for the arm (below).

2. **New model?** Follow `references/adding-a-model.md` first: pin the live
   catalog, check `maxOutputTokens` and `defaultEffortLevel`, pin list
   pricing with provenance, register the slug in `report.mjs` /
   `make-scores.sh`. A model missing from the proxy's pin is refused by
   run-cell for a reason (`references/traps.md`).

3. **Launch an arm** in the background and watch its `[arm]` lines:

   ```bash
   BENCH=... scripts/run-arm.sh openai/gpt-6-astra catalog-2026-09-04.json            # product default
   BENCH=... scripts/run-arm.sh openai/gpt-6-astra catalog-2026-09-04.json --effort low \
       --proxy-base 7795 --block-base 7 --score-port 3100                              # second arm, own ports
   BENCH=... scripts/run-arm.sh openrouter/meta/muse-spark-1.3 catalog-…-musefix.json --sequential
   ```

   Port plan: arm A uses proxies 7789/7791/7793, port blocks 4/5/6, scoring
   on 3000; arm B 7795/7797/7799, blocks 7/8/9, 3100. Three parallel builds
   need ~5 GB; six is the ceiling on the 16 GB mini, so start a second arm
   after the first's builds finish unless `vm_stat` shows ≥5 GB free +
   inactive. Use `--sequential` when a provider throttles (429/503 or
   multi-minute request durations in the ledger); parallel cells against a
   rate-limited upstream double cost and wall-clock.

4. **Verify the wire within the first minute** — this is what separates a
   real measurement from a mislabelled one:

   ```bash
   node scripts/verify-ledger.mjs <cell>... --bench $BENCH [--expect-effort low] [--expect-max 65536]
   ```

   Expect: the intended model string, the intended effort (or `thinking:…budget=N`
   for Gemini, `none` for OpenRouter models, which get no effort field), the
   catalog's max output tokens (OpenAI-compatible paths may send none — fine
   unless it is an Anthropic model), all HTTP 200. The `gpt-5.6-luna` rows are
   Dyad's own side tasks and are normal.

5. **When a build exits.** `exit=0` → read `summary.json`: every milestone has
   a `snapshotDb`, `errorEvents` 0, note `overSoftCap`. `exit=1` → `grep
"Local agent stream error\|AssertionError" build-<app>.log`. A stream
   error aborts the cell before its checkout is archived, so it cannot be
   scored. Classify it: provider-side (429/503, "Corrupted thought
   signature", context-length 400 from a bad catalog value) → rerun with
   `--label r2` (after the arm finishes, alone if the provider is throttled)
   and map it in `report.mjs` `CELL_OVERRIDES` with a one-line reason;
   model-side (it wrote broken code) → score as-is. Quarantine invalid
   artifacts under `results/s-cell/quarantine/` and rename their ledgers
   rather than deleting; the report must stay reproducible.

6. **After scoring.** Per checkpoint, `results/s-score/<cell>-ckpt<k>-a1.json`
   has `buildStatus` (`ok` / `build_failed` / `server_error`; `harness_error`
   is unscored, not zero) and `failures`; the Playwright messages are in
   `results/s-score/cuj-<cell>-ckpt<k>-a1.json`. Then:

   ```bash
   scripts/find-missing-judges.sh --bench $BENCH [--fix]   # a missing verdict scores as 0
   cd $BENCH && node report.mjs && ./make-scores.sh         # and ./make-gallery.sh if tours were recorded
   ```

   Confirm the scores page still serves (`curl -s -o /dev/null -w "%{http_code}"
https://wwwillchen-bot-mini.tail5775e4.ts.net:8443/scores.html`).

7. **Diagnose before you explain.** When an app column is low, find the
   first failing assertion in the cuj JSON; most collapses are one bug
   (duplicate `data-testid`, a workspace switch that 400s, a missing default
   workspace) that takes every downstream journey with it. If static reading
   doesn't settle it, reproduce: clone the checkpoint snapshot via
   `POST :7788/__sim/clone`, build and serve the checkout, drive the failing
   journey with a small Playwright script logging `/api` responses, and
   inspect the clone DB with `psql`. Say what the bug is, not "the model
   did badly".

8. **Optional demo video.** `./record-tours.sh <cell> <app> <port> "<title>"
"<subtitle>"` records a zoomed, slow-paced walkthrough of checkpoint 3;
   add the cell to `make-gallery.sh` `MODELS` and rerun `./serve-gallery.sh`.

## Reporting results

Lead with the table, then the leaderboard position, then the failure story,
then the caveats. Always state: per-app composite / cost / build minutes,
overall, total cost, where it lands on the headline table, which cells are
labelled reruns and why, any harness intervention (a capped catalog value,
a raised judge cap), and that n=1 means a few points is noise. Cost
comparisons are only meaningful against the same apps; quote list-price
ratios alongside measured bills, because fast models routinely bill far
below their list-price ratio (fewer turns, less re-read context).

Effort arms: the headline row is the product default (from the pin's
`defaultEffortLevel` at the time of the run — it can change; `headlineSuffix`
in `report.mjs` handles a flipped default); other tiers go in the sweep
table. Never present a forced tier as the default without saying so.

## Expectations (for sanity-checking a run)

|                      | Typical                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Milestone wall-clock | 5–30 min; 60+ min means stalls (check ledger `durationMs`)         |
| Three-app cost       | $0.60 (luna) … $47 (fable-5.1); $10/$50-list models land $24–47    |
| Per-cell ceiling     | `APPBENCH_CELL_CEILING_USD` 40 (proxy cuts the cell, scored as-is) |
| Scoring              | ~5–9 min per cell; 9 judge calls per model                         |

Read `references/traps.md` before touching the proxy, catalog, pricing, judge
or drain check: each entry is a past run that reported a wrong number.
