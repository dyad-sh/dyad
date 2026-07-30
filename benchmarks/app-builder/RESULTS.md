# App-Builder Benchmark — Results

Run: 2026-07-29 · 7 models × up to 3 apps (Relay CRM, Deskhero, Portalis) ×
3 milestones each, N=1, Dyad local-agent mode at product-default reasoning
effort (medium, recorded per request). Per checkpoint: fixed Playwright CUJ
suites + adversarial security probes against pinned UI contracts, plus an LLM
judge (gpt-5.6-sol, single judge, input-capped). Composite per app =
60% CUJ + 25% probes + 15% judge; overall = mean of scored app composites.
Costs are list-price dollars from exact per-request token counts
(cached/uncached/cache-write split) captured at the wire.

| Model           | Relay CRM      | Deskhero       | Portalis       | Build time | Total cost | Overall   |
| --------------- | -------------- | -------------- | -------------- | ---------- | ---------- | --------- |
| claude-opus-5   | 91.5% ($10.84) | 91.0% ($6.75)  | 93.5% ($6.06)  | 54 min     | $23.66     | **92.0%** |
| claude-fable-5  | 93.1% ($12.86) | 90.9% ($10.86) | 90.5% ($10.06) | 54 min     | $33.77     | **91.5%** |
| gpt-5.6-sol     | 91.8% ($8.70)  | 90.7% ($6.16)  | 91.6% ($5.42)  | 58 min     | $20.28     | **91.4%** |
| grok-4.5        | 91.1% ($1.97)  | 91.0% ($1.44)  | 91.1% ($1.53)  | 50 min     | $4.94      | **91.1%** |
| claude-sonnet-5 | 91.0% ($8.26)  | 90.8% ($3.69)  | 91.0% ($2.77)  | 58 min     | $14.72     | **90.9%** |
| gpt-5.6-terra   | 90.1% ($1.48)  | 89.5% ($2.35)  | 90.3% ($2.30)  | 25 min     | $6.13      | **90.0%** |
| gpt-5.6-luna    | 90.8% ($1.46)  | 90.0% ($0.79)  | 28.0% ($0.93)  | 27 min     | $3.18      | **69.6%** |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="scatter-dark.svg">
  <img alt="Overall composite score versus total build cost across all apps" src="scatter-light.svg">
</picture>

## Per-model failures

- **claude-opus-5**: crm-m1-05@relay-crm:ckpt1, crm-m1-05@relay-crm:ckpt2, crm-m1-08@relay-crm:ckpt3, m1-validation@deskhero:ckpt1, m2-create@deskhero:ckpt2, m3-setup@deskhero:ckpt3, P2-02@portalis:ckpt2, P1-01@portalis:ckpt3
- **claude-fable-5**: crm-m1-05@relay-crm:ckpt2, crm-m1-01@relay-crm:ckpt3, m1-signout-guard@deskhero:ckpt1, m2-create@deskhero:ckpt2, m3-setup@deskhero:ckpt3, P1-01@portalis:ckpt1, P1-03@portalis:ckpt2, P1-01@portalis:ckpt3
- **gpt-5.6-sol**: crm-m1-05@relay-crm:ckpt1, crm-m1-05@relay-crm:ckpt2, crm-m1-08@relay-crm:ckpt3, m1-delete@deskhero:ckpt1, m2-assign@deskhero:ckpt2, m3-setup@deskhero:ckpt3, P1-06@portalis:ckpt1, P1-06@portalis:ckpt2, P1-01@portalis:ckpt3
- **grok-4.5**: crm-m1-04@relay-crm:ckpt1, crm-m1-05@relay-crm:ckpt2, crm-m2-03@relay-crm:ckpt3, m1-signout-guard@deskhero:ckpt1, m2-promote-agent@deskhero:ckpt2, m3-setup@deskhero:ckpt3, P1-03@portalis:ckpt1, P1-03@portalis:ckpt2, P1-01@portalis:ckpt3
- **claude-sonnet-5**: crm-m1-01@relay-crm:ckpt1, crm-m1-01@relay-crm:ckpt2, crm-m1-01@relay-crm:ckpt3, m1-edit@deskhero:ckpt1, m2-create@deskhero:ckpt2, m3-setup@deskhero:ckpt3, P1-02@portalis:ckpt1, P1-06@portalis:ckpt2, P1-01@portalis:ckpt3
- **gpt-5.6-terra**: crm-m1-05@relay-crm:ckpt1, crm-m2-01@relay-crm:ckpt2, crm-m2-03@relay-crm:ckpt3, m1-validation@deskhero:ckpt1, m2-agent-queue@deskhero:ckpt2, m3-overdue@deskhero:ckpt3, P1-01@portalis:ckpt1, P1-03@portalis:ckpt2, P1-01@portalis:ckpt3
- **gpt-5.6-luna**: crm-m1-s02@relay-crm:ckpt1, crm-m2-01@relay-crm:ckpt2, crm-m2-03@relay-crm:ckpt3, m1-delete@deskhero:ckpt1, m2-create@deskhero:ckpt2, m3-sla-set@deskhero:ckpt3, P1-01@portalis:ckpt1, build_failed@portalis:ckpt2, build_failed@portalis:ckpt3

## Caveats (disclosed by design)

- N=1 per cell. Judge is gpt-5.6-sol for all candidates (user decision;
  same-vendor bias toward the gpt-5.6 family — bounded by the 15% judge weight).
- claude-sonnet-5 priced at intro rates (through 2026-08-31).
- Web tools enabled (product realism over reproducibility; web drift caveat).
- Durations exclude infra stalls (client-abort rows checked per cell).
- A complementary blind code review (opus-5, correctness/security/
  maintainability) lives in results/opus-review/ — behavioral scores and code
  quality diverge; see the PR discussion.

Regenerate: `node benchmarks/app-builder/report.mjs` (reads results/).
