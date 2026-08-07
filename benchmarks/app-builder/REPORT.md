# App-Builder Benchmark — Methodology and Results

A cost-effectiveness benchmark for building full-stack apps with Dyad, across
seven frontier models. It measures three things per app build: **cost** in
list-price dollars from exact wire-captured token counts, **quality** from fixed
Playwright suites plus adversarial security probes plus an LLM judge, and
**duration** in wall-clock minutes.

`RESULTS.md` is the generated scoreboard. This document is the methodology, the
things that went wrong, and the reasons to distrust particular numbers.

---

## 1. Results

Seven models × three apps × three milestone prompts. N=1 per cell, Dyad
local-agent mode, product-default reasoning effort (`medium`, verified at the
wire on every request).

| Model           | Relay CRM | Deskhero | Portalis | Build time | Cost   | **Overall** |
| --------------- | --------- | -------- | -------- | ---------- | ------ | ----------- |
| gpt-5.6-sol     | 86.3%     | 94.2%    | 84.7%    | 58 min     | $20.28 | **88.4%**   |
| claude-opus-5   | 85.2%     | 95.6%    | 79.1%    | 54 min     | $23.66 | **86.6%**   |
| claude-fable-5  | 78.9%     | 93.7%    | 84.0%    | 54 min     | $33.77 | **85.5%**   |
| gpt-5.6-terra   | 87.0%     | 87.1%    | 8.0%     | 25 min     | $6.13  | **60.7%**   |
| claude-sonnet-5 | 8.0%      | 90.5%    | 72.3%    | 58 min     | $14.72 | **56.9%**   |
| grok-4.5        | 82.4%     | 49.2%    | 13.2%    | 50 min     | $4.94  | **48.3%**   |
| gpt-5.6-luna    | 56.7%     | 59.1%    | 3.5%     | 27 min     | $3.18  | **39.8%**   |

Composite per app = 60% CUJ pass rate + 25% security probes + 15% LLM judge.
Overall = mean of the three app composites.

### The near-zero cells are single defects, not incapacity

Three cells sit under 15%, and in each case the app builds a plausible
application that dies on one line:

- **terra / Portalis (8.0%)** and **luna / Portalis (3.5%)** — both declare
  `uuid` columns for the session user id, which is an opaque 32-character
  string. Every query throws `invalid input syntax for type uuid`. The app
  compiles and deploys; nothing works.
- **luna / Portalis at xhigh (0.0%)** — `sessionDataTtl: 0` in the better-auth
  config; the library rejects it at build time.
- **sonnet / Relay CRM (8.0%)** — the client session hook never populates, so
  every authenticated surface renders signed-out.
- **grok / Deskhero (49.2%)** and **Portalis (13.2%)** — genuine breadth
  failures rather than one line: whole M2/M3 feature sets absent.

A benchmark that reports 8% should say whether that means "could not build the
app" or "built the app and typed one word wrong". Here it is the latter, and the
build gate is doing its job by refusing to award partial credit for an app that
cannot serve a request.

### Reasoning effort (luna and terra)

Effort is applied at the recording proxy, because Dyad's `thinkingBudget`
setting exposes only low/medium/high while the engine accepts `xhigh`. These
rows therefore do **not** use a product-reachable configuration and are reported
separately.

| Model         | Effort | Relay CRM | Deskhero | Portalis | Cost   | **Overall** |
| ------------- | ------ | --------- | -------- | -------- | ------ | ----------- |
| gpt-5.6-luna  | medium | 56.7%     | 59.1%    | 3.5%     | $3.18  | **39.8%**   |
| gpt-5.6-luna  | high   | 76.6%     | 68.8%    | 92.5%    | $6.51  | **79.3%**   |
| gpt-5.6-luna  | xhigh  | 41.1%     | 95.8%    | 0.0%     | $9.82  | **45.6%**   |
| gpt-5.6-terra | medium | 87.0%     | 87.1%    | 8.0%     | $6.13  | **60.7%**   |
| gpt-5.6-terra | high   | 85.5%     | 92.6%    | 8.1%     | $10.28 | **62.1%**   |
| gpt-5.6-terra | xhigh  | 84.9%     | 95.8%    | 13.8%    | $16.18 | **64.8%**   |

**terra is effort-insensitive**: +4.1 points for 2.6× the cost and 2.5× the
wall-clock, with the same CUJs and probes passing at every tier.

**luna gains sharply at high and regresses at xhigh** — but the averages
overstate how much of that is reasoning. Two of luna's six non-medium cells are
decided by one bad line in a config file. Deskhero is the only app column where
every checkpoint builds at every tier, and there the curve is cleanly monotone
(59.1% → 68.8% → 95.8%, probes 17/21 → 16/21 → 21/21). That column is the part
worth trusting; it says xhigh is not inherently worse at writing code, while the
other two say it edits more and therefore breaks more.

Practical reading: **run luna at high** (39.8% → 79.3% for 2× cost, still the
cheapest cell in the matrix at $6.51). Leave terra at medium.

---

## 2. Methodology

### Task shape

Three apps, each specified as three sequential PRD-style milestone prompts
(`specs/<app>/m{1,2,3}.md`). Unlike terse benchmark prompts, these pin exact
routes, JSON field names and `data-testid` contracts — necessary because one
fixed test suite must run unmodified against whatever seven different models
build. Prompts run 383–620 words and never mention Dyad, tools, or tags.

The three apps stress different authorization shapes: Relay CRM multi-tenant
workspaces, Deskhero role-based workflow with a state-transition matrix,
Portalis B2B tenancy with audit and API keys. Three further apps (Ledgerly
double-entry bookkeeping, Slotline clinic scheduling, Curbside three-sided
marketplace) are specified, gated and ready but not yet run.

### Backend: neon-sim

Self-hosting real Neon is not viable — Dyad calls the closed-source Neon v2
control-plane API, and the OSS distribution ships only the storage layer. So
`neon-sim` reimplements exactly the endpoint surface Dyad is proven to depend
on: a v2 control-plane shim, an HTTP-SQL proxy speaking the
`@neondatabase/serverless` fetch protocol over TLS, and a self-hosted
better-auth instance standing in for Neon Auth with a per-branch mount. Runs are
fully offline and reproducible, and each scoring pass clones a database snapshot
so no run inherits another's state.

### Cost: measured, not estimated

Dyad persists only a lossy per-message token high-water mark. So every engine
request is routed through a local recording proxy that captures
`prompt_tokens`, `prompt_tokens_details.cached_tokens`, cache-write tokens and
`completion_tokens` per request, across all three wire formats the engine serves
(OpenAI chat-completions, OpenAI Responses, Anthropic messages), correlated to
chat turns via `X-Dyad-Request-Id`. Dollars are those exact counts against list
prices pinned on 2026-07-28 in `pricing/pricing.json`, with Anthropic cache
writes billed at their published 1.25× rate.

Billing actually flows through Dyad Pro credits; list-price dollars are the
reported, reproducible metric.

### Scoring

Per checkpoint: check out that milestone's git tag, clone its database snapshot,
`next build`, serve, and run that checkpoint's Playwright suite. A checkpoint
that fails to build scores zero — not partial credit, and explicitly not "no
failures recorded".

321 tests across the six apps. Every test provisions its own personas and
records; no suite is serial, and no test depends on another having run.

The LLM judge (`gpt-5.6-sol`, single fixed judge for every candidate) scores
bugs, security, code quality and schema quality from a capped diff plus selected
sources. Same-vendor bias toward the gpt-5.6 family is a disclosed caveat,
bounded by the 15% weight.

### The oracle: controls that validate the harness

Every number is gated on two controls, per app **and** per checkpoint:

| Control  | Tree                     | Must score                         |
| -------- | ------------------------ | ---------------------------------- |
| Positive | `oracle/<app>/reference` | 100% of that checkpoint's tests    |
| Negative | `oracle/<app>/broken`    | every security probe must **fail** |

`oracle/preflight.sh` refuses to score a model cell unless both hold. The
positive control catches a suite that is impossible to satisfy; the negative
control catches the more dangerous failure — a probe that passes everything. A
probe nobody has ever seen fire is not evidence of security, and 25% of the
quality score rides on the probe table.

All eighteen controls are currently green across six apps.

---

## 3. What went wrong, and why it is in this document

Twelve distinct harness defects surfaced during this work. Every one produced a
confident, plausible, wrong number, and several survived multiple rounds of
careful reading. They are recorded because the failure modes generalise.

### The measurement bug that invalidated the first run

`test.describe.serial` abandons the rest of a file after the first failure, and
the scorer read the spec-level `ok` flag — which is `true` for a skipped test.
**860 of 1052 tests never ran and were scored as passing.** Fixed by reading
`test.results[0].status`, counting `ran` separately from `passed`, and
restructuring every suite so each test provisions its own state.

### Probes that could not fail

Three probes were testing weaker properties than they advertised: one asserted
inside a `try/catch` that swallowed its own detection; one accepted any 4xx from
an app that performed the `UPDATE` and _then_ answered 403; one accepted a
silently-ignored 200 where the spec pins 403. None could fail. All three were
caught by the broken twins, not by review.

### Tests that could not pass

The largest correction in this benchmark. An audit of the 24 tests that 6+ of 7
models failed found **all 24 required something the prompt never pinned** — none
were fair. Two shared helpers accounted for most:

- Relay CRM's `switchWorkspace` asserted that `workspace-switcher-option`
  becomes _visible_. Playwright never reports an `<option>` inside a `<select>`
  as visible, so a switcher built as a native `<select>` **could not pass at
  all**. Four of seven models built exactly that; the prompt pins only that a
  switcher exists and lists the user's workspaces.
- Deskhero's `transition()` compared rendered status text against the raw value,
  so a ticket displaying "In Progress" failed a check for `in_progress`. The
  prompt pins the status _values_, never the label.

Repairing these test-side (prompts untouched, so existing builds stayed valid)
moved the matrix substantially:

| Model           | Overall before | after | Δ     |
| --------------- | -------------- | ----- | ----- |
| gpt-5.6-sol     | 70.8%          | 88.4% | +17.5 |
| claude-fable-5  | 70.8%          | 85.5% | +14.8 |
| claude-opus-5   | 76.7%          | 86.6% | +10.0 |
| gpt-5.6-terra   | 50.4%          | 60.7% | +10.3 |
| grok-4.5        | 38.1%          | 48.3% | +10.2 |
| claude-sonnet-5 | 50.7%          | 56.9% | +6.2  |
| gpt-5.6-luna    | 41.0%          | 39.8% | -1.2  |

**This changed the ranking.** On Relay CRM the gains were sol +32.4, grok +30.5,
terra +29.0, fable +20.0 — and opus **+3.2**. opus was the only model that
rendered the switcher as always-visible buttons, the one shape the old helper
could observe, so it alone was never penalised. Its previous first-place margin
was substantially an artifact of a harness assertion no `<select>` could satisfy.

The cells with genuine model defects did not move, which is the check that
matters: the repairs corrected harness error without laundering real failures.

### The positive control was derived from a candidate

The three original references were built by starting from **claude-opus-5's own
output** and patching it. That breaks the control in a specific way: a reference
derived from a candidate proves the suite is satisfiable by _that candidate's
architecture_, not by an independent spec-conformant implementation. Any
assumption the suite shared with opus's choices was invisible to it — which is
exactly how the `<select>` defect survived.

The Portalis case is sharper. Its reference is opus's code plus `keepalive: true`
on ten mutation fetches, commented _"Survives the page navigating away
mid-submit."_ No model uses `keepalive` anywhere. Stripping all ten lines, the
reference still scores 19/19 and 21/21 — so that patch was compensating for a
race in the harness's own `createProject` helper (submit, then navigate
immediately, aborting the write), not demonstrating anything about the app.

**Apps 4–6 were therefore built from the specs, never from the tests.** A
reference author may read a test to diagnose a failure but may not implement
anything the spec does not ask for. That constraint turned each reference build
into a spec-sufficiency audit and immediately found eleven further cases where a
test demanded an unpinned contract — three of which would have failed a fully
correct app.

### Others worth naming

- **Browser GC**: a generated app's own Playwright install garbage-collected the
  suite's browser; three cells scored 0/54 for infrastructure failure. Fixed
  with `PLAYWRIGHT_SKIP_BROWSER_GC=1` plus a `harness_error` status so the cell
  is refused rather than scored zero.
- **Zombie engine requests**: killed runs leave server-side work; undici's 300s
  headers timeout plus silent AI-SDK retries produced exactly-300s stall loops
  that inflated one cell from ~4 to 54 minutes. Fixed by propagating client
  aborts and draining before each run.
- **Consent prompts** hang 300s then deny headless. Fixed by pre-seeding
  `agentToolConsents`.
- **String-matched identifiers**: the judge resolved a cell's app with
  `cellId.endsWith("-deskhero")`, which fell through to `relay-crm` the moment
  cell ids gained an effort suffix — judging deskhero and portalis apps against
  the wrong spec for an entire sweep. Now matches anywhere in the id and
  **throws** when it cannot resolve.
- **Substring id matching**: fifteen assertions matched a short record id as a
  substring of a whole page or JSON body. No prompt pins an id's format,
  `bigserial` is normal, and a two-digit id collides with the digits in every
  Next.js chunk src and with `"lineTotalCents":1299` in the same response. Ids
  are now matched as parsed fields or pinned `data-*` attributes.
- **Silent tag-checkout skip**: `run-suite.sh` tested "is this path inside any
  repo" rather than "is this its own repo", so five oracle trees scored all three
  checkpoints against a single tree. Worse, had the outer repo ever owned a
  `checkpoint-mN` tag, the same line would have checked it out across the entire
  working tree.

---

## 4. Caveats

- **N=1 per cell.** A single build-breaking line moves an app column by 70+
  points, which is larger than the entire reasoning-effort effect. Treat
  per-cell numbers as observations, not estimates.
- **The judge scored against pre-repair test results.** Its weight is 15% and
  its rubric is diff-based, so the effect is small, but it is real. Re-judging
  costs roughly $10.
- **Only the 24 most-failed tests were audited for fairness.** The same class
  almost certainly exists at lower failure counts, depressing individual cells
  rather than whole columns.
- **Single judge, same vendor as three candidates** (user decision, superseding
  a cross-vendor pair design).
- **claude-sonnet-5 is priced at introductory rates** (through 2026-08-31).
- **Web tools were enabled** — product realism over reproducibility; results may
  drift with the live web.
- **The twins prove every probe trips, not every assertion within a probe.**
  Playwright abandons a test at its first failed assertion, so a probe's
  trailing "and the data is unchanged" re-reads have no demonstrated negative
  control. Closing this needs a second twin variant that writes and _then_
  answers 4xx.
- **`led-m3-s07` and `curb-m3-s02` are weaker than they advertise** and are
  documented as such rather than relied on. See DESIGN.md §10b.
- An independent blind code review (opus-5, correctness/security/
  maintainability) lives in `results/opus-review/`; it ranked models in the same
  order as the behavioural scores, which is meaningful convergence given the two
  methods share no machinery.

---

## 5. Reproducing

```bash
# one cell (model × app × 3 milestones)
APPBENCH_APP=relay-crm ./run-cell.sh openai/gpt-5.6-sol

# score it (clones each milestone snapshot, runs its suite, judges)
APPBENCH_APP=relay-crm ./s-score.sh gpt-5.6-sol-relay-crm

# the gate — run this before trusting any score
./oracle/preflight.sh relay-crm 3 3900

# regenerate RESULTS.md + scatters from results/
node report.mjs
```

Requires `DYAD_PRO_KEY` and a running neon-sim (`neon-sim/README.md`).

| Document                             | Contents                                          |
| ------------------------------------ | ------------------------------------------------- |
| [RESULTS.md](RESULTS.md)             | Generated scoreboard, per-model failure lists     |
| [DESIGN.md](DESIGN.md)               | Full design, fixed decisions, operational lessons |
| [oracle/README.md](oracle/README.md) | The controls and how to build a new pair          |
| `design/app-*.md`                    | Per-app spec: prompts, CUJ tables, probe tables   |
