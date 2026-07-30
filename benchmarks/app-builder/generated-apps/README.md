# Generated apps — app-builder benchmark (2026-07-29)

**21 complete Next.js apps**: 7 models × 3 specs (Relay CRM, Deskhero, Portalis),
each built end-to-end by one model through Dyad local-agent mode against the same
three milestone prompts (`benchmarks/app-builder/specs/<app>/`), from the same
pinned template with a Neon-compatible backend (neon-sim). Each directory is the
final state at `checkpoint-m3` of that model's single benchmark cell (N=1),
committed VERBATIM and unreviewed, exactly as the model left it.

Layout: `<app>/<model>/`.

| Directory | Model | Relay CRM | Deskhero | Portalis | Overall |
|---|---|---|---|---|---|
| `claude-opus-5/` | claude-opus-5 | 91.5% / $10.84 | 91.0% / $6.75 | 93.5% / $6.06 | **92.0%** |
| `claude-fable-5/` | claude-fable-5 | 93.1% / $12.86 | 90.9% / $10.86 | 90.5% / $10.06 | **91.5%** |
| `gpt-5.6-sol/` | gpt-5.6-sol | 91.8% / $8.70 | 90.7% / $6.16 | 91.6% / $5.42 | **91.4%** |
| `x-ai_grok-4.5/` | grok-4.5 | 91.1% / $1.97 | 91.0% / $1.44 | 91.1% / $1.53 | **91.1%** |
| `claude-sonnet-5/` | claude-sonnet-5 | 91.0% / $8.26 | 90.8% / $3.69 | 91.0% / $2.77 | **90.9%** |
| `gpt-5.6-terra/` | gpt-5.6-terra | 90.1% / $1.48 | 89.5% / $2.35 | 90.3% / $2.30 | **90.0%** |
| `gpt-5.6-luna/` | gpt-5.6-luna | 90.8% / $1.46 | 90.0% / $0.79 | 28.0% / $0.93 | **69.6%** |

(score / build cost per app; scoring = 60% CUJ pass rate + 25% security probes +
15% LLM judge. Methodology and caveats: `benchmarks/app-builder/RESULTS.md` on the
benchmark branch, PR #4141.)

Notable: gpt-5.6-luna's Portalis app fails `next build` from milestone 2 onward
(the sign-in page throws during production prerendering), which is why its overall
drops to 69.6% — the app is committed here in exactly that state.

**These are benchmark artifacts, not maintained code.** They exist so the scores can
be inspected against the code that earned them (schema choices, authorization
patterns, the specific CUJ failures). Do not deploy them; do not lint/format/fix
them — any edit invalidates the correspondence with the recorded scores.

A blind opus-5 code review of all 21 apps (correctness / security / maintainability)
lives in `benchmarks/app-builder/results/opus-review/` on the benchmark branch.

To run one locally you need the neon-sim stack from the benchmark branch
(`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` in `.env.local`),
then `pnpm install && next dev`.
