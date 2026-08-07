# Generated apps — app-builder benchmark

**21 complete Next.js apps**: 7 models × 3 specs (Relay CRM, Deskhero, Portalis),
each built end to end by one model through Dyad local-agent mode against the same
three milestone prompts (`benchmarks/app-builder/specs/<app>/`), from the same
pinned template against a Neon-compatible backend (neon-sim). Each directory is
the final state at `checkpoint-m3` of that model's single benchmark cell (N=1),
committed **verbatim and unreviewed**, exactly as the model left it.

Layout: `<app>/<model>/` — e.g. `relay-crm/claude-opus-5/`.

| Model | Relay CRM | Deskhero | Portalis | Cost | **Overall** |
| --- | --- | --- | --- | --- | --- |
| gpt-5.6-sol | 86.3% / $8.70 | 94.2% / $6.16 | 84.7% / $5.42 | $20.28 | **88.4%** |
| claude-opus-5 | 85.2% / $10.84 | 95.6% / $6.75 | 79.1% / $6.06 | $23.66 | **86.6%** |
| claude-fable-5 | 78.9% / $12.86 | 93.7% / $10.86 | 84.0% / $10.06 | $33.77 | **85.5%** |
| gpt-5.6-terra | 87.0% / $1.48 | 87.1% / $2.35 | 8.0% / $2.30 | $6.13 | **60.7%** |
| claude-sonnet-5 | 8.0% / $8.26 | 90.5% / $3.69 | 72.3% / $2.77 | $14.72 | **56.9%** |
| grok-4.5 | 82.4% / $1.97 | 49.2% / $1.44 | 13.2% / $1.53 | $4.94 | **48.3%** |
| gpt-5.6-luna | 56.7% / $1.46 | 59.1% / $0.79 | 3.5% / $0.93 | $3.18 | **39.8%** |

Score / build cost per app. Composite = 60% CUJ pass rate + 25% security probes +
15% LLM judge. Methodology, per-cell diagnosis and caveats:
`benchmarks/app-builder/REPORT.md` on the benchmark branch (PR #4141).

> **These scores supersede an earlier version of this file.** A fairness audit
> found that the 24 tests which 6+ of 7 models failed *all* required something
> the milestone prompts never pinned — most consequentially a helper asserting
> that a `workspace-switcher-option` becomes *visible*, which Playwright never
> reports for an `<option>` inside a `<select>`, so a switcher built that way
> could not pass at all. Four of seven models built exactly that. Repairing it
> test-side moved Relay CRM by +32.4 for sol, +30.5 for grok, +29.0 for terra,
> +20.0 for fable — and +3.2 for opus, the one model whose always-visible button
> switcher the old helper could observe. **The apps in this directory did not
> change; only the scoring did.**

## Why some cells are near zero

These are not "the model could not build the app". In each case it built a
plausible application that dies on one line — which is exactly what the apps here
let you verify:

- **gpt-5.6-terra / Portalis (8.0%)** and **gpt-5.6-luna / Portalis (3.5%)** —
  both declare `uuid` columns for the session user id, which is an opaque
  32-character string. Every query throws `invalid input syntax for type uuid`.
  luna's additionally fails `next build` from M2 (an unwrapped `useSearchParams`).
- **claude-sonnet-5 / Relay CRM (8.0%)** — the client session hook never
  populates, so every authenticated surface renders signed-out.
- **grok-4.5 / Deskhero (49.2%) and Portalis (13.2%)** — genuine breadth
  failures rather than one line: whole M2/M3 feature sets absent.

## What these are for

They exist so the scores can be read against the code that earned them — schema
choices, server-side authorization patterns, the specific CUJ failures — without
standing up the benchmark.

**Do not deploy, lint, format or fix them.** Any edit invalidates the
correspondence with the recorded scores. They are captured artifacts, not
maintained code.

See also `../oracle-apps/`, which holds the reference implementations and broken
twins that validate the harness itself — including three references built from
the specs rather than from the tests.

A blind opus-5 code review of all 21 apps (correctness / security /
maintainability) lives in `benchmarks/app-builder/results/opus-review/` on the
benchmark branch. It ranked the models in the same order as the behavioural
scores, which is meaningful convergence given the two methods share no machinery.

To run one locally you need the neon-sim stack from the benchmark branch
(`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` in `.env.local`),
then `pnpm install && next dev`.
