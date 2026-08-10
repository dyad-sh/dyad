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
| gpt-5.6-sol     | 86.3% ($8.70)  | 94.2% ($6.16)  | 84.7% ($5.42)  | 58 min     | $20.28     | **88.4%** |
| claude-opus-5   | 85.2% ($10.84) | 95.6% ($6.75)  | 79.1% ($6.06)  | 54 min     | $23.66     | **86.6%** |
| claude-fable-5  | 78.9% ($12.86) | 93.7% ($10.86) | 84.0% ($10.06) | 54 min     | $33.77     | **85.5%** |
| gpt-5.6-terra   | 87.0% ($1.48)  | 87.1% ($2.35)  | 8.0% ($2.30)   | 25 min     | $6.13      | **60.7%** |
| claude-sonnet-5 | 8.0% ($8.26)   | 90.5% ($3.69)  | 72.3% ($2.77)  | 58 min     | $14.72     | **56.9%** |
| grok-4.5        | 82.4% ($1.97)  | 49.2% ($1.44)  | 13.2% ($1.53)  | 50 min     | $4.94      | **48.3%** |
| gpt-5.6-luna    | 56.7% ($1.46)  | 59.1% ($0.79)  | 3.5% ($0.93)   | 27 min     | $3.18      | **39.8%** |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="scatter-dark.svg">
  <img alt="Overall composite score versus total build cost across all apps" src="scatter-light.svg">
</picture>

## Reasoning-effort sweep (luna + terra)

The main table runs every model at the product default (medium). This sweep
re-runs the two cheapest models at `high` and `xhigh` — same harness, same
controls. Effort is applied at the recording proxy (`reasoning_effort` /
`reasoning.effort`) because Dyad's `thinkingBudget` setting exposes only
low/medium/high, so these rows do **not** use a product-reachable configuration
and are reported separately from the headline matrix.

| Model                  | Effort | Relay CRM | Deskhero | Portalis | Cost   | Wall-clock | Overall   |
| ---------------------- | ------ | --------- | -------- | -------- | ------ | ---------- | --------- |
| gpt-5.6-luna           | medium | 56.7%     | 59.1%    | 3.5%     | $3.18  | 27 min     | **39.8%** |
| gpt-5.6-luna           | high   | 76.6%     | 68.8%    | 92.5%    | $6.51  | 61 min     | **79.3%** |
| gpt-5.6-luna           | xhigh  | 41.1%     | 95.8%    | 0.0%     | $9.82  | 71 min     | **45.6%** |
| gpt-5.6-terra          | medium | 87.0%     | 87.1%    | 8.0%     | $6.13  | 25 min     | **60.7%** |
| gpt-5.6-terra          | high   | 85.5%     | 92.6%    | 8.1%     | $10.28 | 43 min     | **62.1%** |
| gpt-5.6-terra          | xhigh  | 84.9%     | 95.8%    | 13.8%    | $16.18 | 61 min     | **64.8%** |
| deepseek-v4-flash-0731 | low    | 46.6%     | 78.6%    | 52.9%    | $0.45  | 88 min     | **59.4%** |
| deepseek-v4-flash-0731 | high   | 56.9%     | 90.7%    | 48.1%    | $0.32  | 76 min     | **65.2%** |
| deepseek-v4-flash-0731 | xhigh  | 60.9%     | 46.6%    | 7.5%     | $0.28  | 72 min     | **38.4%** |

At N=1 a single build-breaking line moves an app column by 70+ points, which is
larger than the entire effort effect — read a column as measuring reasoning only
where every checkpoint in it built. See the PR discussion for the per-cell
diagnosis of each near-zero.

## Per-model failures

- **gpt-5.6-sol**: crm-m2-06@relay-crm:ckpt2, crm-m2-s04@relay-crm:ckpt2, crm-m2-06@relay-crm:ckpt3, crm-m3-05@relay-crm:ckpt3, crm-m3-06@relay-crm:ckpt3, m3-audit-role@deskhero:ckpt3, P1-06@portalis:ckpt1, P1-06@portalis:ckpt2, P2-02@portalis:ckpt2, S2-04@portalis:ckpt2, P2-02@portalis:ckpt3, P2-05@portalis:ckpt3
- **claude-opus-5**: crm-m1-08@relay-crm:ckpt1, crm-m1-10@relay-crm:ckpt1, crm-m2-02@relay-crm:ckpt2, crm-m1-08@relay-crm:ckpt3, crm-m3-05@relay-crm:ckpt3, crm-m3-06@relay-crm:ckpt3, P2-02@portalis:ckpt2, P2-02@portalis:ckpt3, P2-05@portalis:ckpt3, P3-01@portalis:ckpt3, P3-02@portalis:ckpt3, P3-03@portalis:ckpt3, P3-04@portalis:ckpt3, P3-09@portalis:ckpt3, S3-06@portalis:ckpt3
- **claude-fable-5**: crm-m2-01@relay-crm:ckpt2, crm-m2-02@relay-crm:ckpt2, crm-m2-06@relay-crm:ckpt2, crm-m2-s03@relay-crm:ckpt2, crm-m2-s04@relay-crm:ckpt2, crm-m2-06@relay-crm:ckpt3, crm-m3-03@relay-crm:ckpt3, crm-m3-05@relay-crm:ckpt3, crm-m3-07@relay-crm:ckpt3, m3-audit-role@deskhero:ckpt3, P1-01@portalis:ckpt1, P1-02@portalis:ckpt1, P2-03@portalis:ckpt2, P1-01@portalis:ckpt3, P2-05@portalis:ckpt3, P3-09@portalis:ckpt3
- **gpt-5.6-terra**: crm-m2-s03@relay-crm:ckpt2, crm-m3-03@relay-crm:ckpt3, crm-m3-05@relay-crm:ckpt3, crm-m3-s02@relay-crm:ckpt3, m1-signout-guard@deskhero:ckpt1, m3-deactivate@deskhero:ckpt3, m3-reactivate@deskhero:ckpt3, m3-workflow-regression@deskhero:ckpt3, P1-01@portalis:ckpt1, P1-02@portalis:ckpt1, P1-03@portalis:ckpt1, P1-04@portalis:ckpt1, P1-05@portalis:ckpt1, P1-06@portalis:ckpt1, P1-07@portalis:ckpt1, P1-08@portalis:ckpt1, P1-09@portalis:ckpt1, S1-01@portalis:ckpt1, S1-02@portalis:ckpt1, P1-03@portalis:ckpt2, P1-06@portalis:ckpt2, P1-07@portalis:ckpt2, P2-01@portalis:ckpt2, P2-02@portalis:ckpt2, P2-03@portalis:ckpt2, P2-04@portalis:ckpt2, P2-05@portalis:ckpt2, P2-06@portalis:ckpt2, P2-07@portalis:ckpt2, P2-08@portalis:ckpt2, P2-09@portalis:ckpt2, S2-01@portalis:ckpt2, S2-02@portalis:ckpt2, S2-03@portalis:ckpt2, S2-04@portalis:ckpt2, S2-05@portalis:ckpt2, S2-06@portalis:ckpt2, S2-07@portalis:ckpt2, P1-01@portalis:ckpt3, P2-02@portalis:ckpt3, P2-05@portalis:ckpt3, P3-01@portalis:ckpt3, P3-02@portalis:ckpt3, P3-03@portalis:ckpt3, P3-04@portalis:ckpt3, P3-05@portalis:ckpt3, P3-06@portalis:ckpt3, P3-07@portalis:ckpt3, P3-08@portalis:ckpt3, P3-09@portalis:ckpt3, S3-01@portalis:ckpt3, S3-02@portalis:ckpt3, S3-03@portalis:ckpt3, S3-04@portalis:ckpt3, S3-05@portalis:ckpt3, S3-06@portalis:ckpt3, S3-07@portalis:ckpt3, S3-08@portalis:ckpt3, S3-09@portalis:ckpt3
- **claude-sonnet-5**: crm-m1-01@relay-crm:ckpt1, crm-m1-02@relay-crm:ckpt1, crm-m1-04@relay-crm:ckpt1, crm-m1-05@relay-crm:ckpt1, crm-m1-06@relay-crm:ckpt1, crm-m1-07@relay-crm:ckpt1, crm-m1-08@relay-crm:ckpt1, crm-m1-09@relay-crm:ckpt1, crm-m1-10@relay-crm:ckpt1, crm-m1-s01@relay-crm:ckpt1, crm-m1-s02@relay-crm:ckpt1, crm-m1-01@relay-crm:ckpt2, crm-m1-05@relay-crm:ckpt2, crm-m1-07@relay-crm:ckpt2, crm-m1-09@relay-crm:ckpt2, crm-m2-01@relay-crm:ckpt2, crm-m2-02@relay-crm:ckpt2, crm-m2-03@relay-crm:ckpt2, crm-m2-04@relay-crm:ckpt2, crm-m2-05@relay-crm:ckpt2, crm-m2-06@relay-crm:ckpt2, crm-m2-07@relay-crm:ckpt2, crm-m2-08@relay-crm:ckpt2, crm-m2-s01@relay-crm:ckpt2, crm-m2-s02@relay-crm:ckpt2, crm-m2-s03@relay-crm:ckpt2, crm-m2-s04@relay-crm:ckpt2, crm-m2-s05@relay-crm:ckpt2, crm-m2-s06@relay-crm:ckpt2, crm-m1-01@relay-crm:ckpt3, crm-m1-08@relay-crm:ckpt3, crm-m2-03@relay-crm:ckpt3, crm-m2-06@relay-crm:ckpt3, crm-m3-01@relay-crm:ckpt3, crm-m3-02@relay-crm:ckpt3, crm-m3-03@relay-crm:ckpt3, crm-m3-04@relay-crm:ckpt3, crm-m3-05@relay-crm:ckpt3, crm-m3-06@relay-crm:ckpt3, crm-m3-07@relay-crm:ckpt3, crm-m3-08@relay-crm:ckpt3, crm-m3-s01@relay-crm:ckpt3, crm-m3-s02@relay-crm:ckpt3, crm-m3-s03@relay-crm:ckpt3, crm-m3-s04@relay-crm:ckpt3, crm-m3-s05@relay-crm:ckpt3, crm-m3-s06@relay-crm:ckpt3, crm-m3-s07@relay-crm:ckpt3, crm-m3-s08@relay-crm:ckpt3, m2-create@deskhero:ckpt2, m3-audit-role@deskhero:ckpt3, P1-02@portalis:ckpt1, P1-06@portalis:ckpt1, P1-06@portalis:ckpt2, P2-02@portalis:ckpt2, P2-03@portalis:ckpt2, P2-04@portalis:ckpt2, S2-04@portalis:ckpt2, P1-01@portalis:ckpt3, P2-02@portalis:ckpt3, P2-05@portalis:ckpt3, P3-01@portalis:ckpt3, P3-09@portalis:ckpt3
- **grok-4.5**: crm-m1-10@relay-crm:ckpt1, crm-m2-02@relay-crm:ckpt2, crm-m2-06@relay-crm:ckpt2, crm-m2-s03@relay-crm:ckpt2, crm-m2-s04@relay-crm:ckpt2, crm-m1-08@relay-crm:ckpt3, crm-m2-06@relay-crm:ckpt3, m2-promote-agent@deskhero:ckpt2, m2-assign@deskhero:ckpt2, m2-agent-queue@deskhero:ckpt2, m2-self-assign@deskhero:ckpt2, m2-happy-path@deskhero:ckpt2, m2-reopen@deskhero:ckpt2, m2-button-gating@deskhero:ckpt2, m2-notes@deskhero:ckpt2, m2-notes-hidden@deskhero:ckpt2, m2-p-agent-promote@deskhero:ckpt2, m2-p-skip-transition@deskhero:ckpt2, m2-p-unassigned-transition@deskhero:ckpt2, m2-p-notes-leak@deskhero:ckpt2, m3-setup@deskhero:ckpt3, m3-overdue-clears@deskhero:ckpt3, m3-canned-apply@deskhero:ckpt3, m3-reply-thread@deskhero:ckpt3, m3-deactivate@deskhero:ckpt3, m3-reactivate@deskhero:ckpt3, m3-audit-role@deskhero:ckpt3, m3-audit-transitions@deskhero:ckpt3, m3-workflow-regression@deskhero:ckpt3, m3-p-dead-cookie-read@deskhero:ckpt3, m3-p-dead-cookie-write@deskhero:ckpt3, m3-p-audit-leak@deskhero:ckpt3, m3-p-note-serialization@deskhero:ckpt3, m3-p-agent-deactivate@deskhero:ckpt3, m3-p-sla-edit-role@deskhero:ckpt3, P1-03@portalis:ckpt1, P1-04@portalis:ckpt1, P1-05@portalis:ckpt1, P1-06@portalis:ckpt1, P1-07@portalis:ckpt1, P1-08@portalis:ckpt1, P1-09@portalis:ckpt1, S1-01@portalis:ckpt1, S1-02@portalis:ckpt1, P1-03@portalis:ckpt2, P1-06@portalis:ckpt2, P1-07@portalis:ckpt2, P2-01@portalis:ckpt2, P2-02@portalis:ckpt2, P2-03@portalis:ckpt2, P2-04@portalis:ckpt2, P2-05@portalis:ckpt2, P2-06@portalis:ckpt2, P2-07@portalis:ckpt2, P2-08@portalis:ckpt2, P2-09@portalis:ckpt2, S2-01@portalis:ckpt2, S2-02@portalis:ckpt2, S2-03@portalis:ckpt2, S2-04@portalis:ckpt2, S2-05@portalis:ckpt2, S2-06@portalis:ckpt2, S2-07@portalis:ckpt2, P2-02@portalis:ckpt3, P2-05@portalis:ckpt3, P3-01@portalis:ckpt3, P3-02@portalis:ckpt3, P3-03@portalis:ckpt3, P3-04@portalis:ckpt3, P3-05@portalis:ckpt3, P3-06@portalis:ckpt3, P3-07@portalis:ckpt3, P3-08@portalis:ckpt3, P3-09@portalis:ckpt3, S3-01@portalis:ckpt3, S3-02@portalis:ckpt3, S3-03@portalis:ckpt3, S3-04@portalis:ckpt3, S3-05@portalis:ckpt3, S3-06@portalis:ckpt3, S3-07@portalis:ckpt3, S3-08@portalis:ckpt3, S3-09@portalis:ckpt3
- **gpt-5.6-luna**: crm-m1-s02@relay-crm:ckpt1, crm-m2-01@relay-crm:ckpt2, crm-m2-02@relay-crm:ckpt2, crm-m2-03@relay-crm:ckpt2, crm-m2-04@relay-crm:ckpt2, crm-m2-08@relay-crm:ckpt2, crm-m2-s02@relay-crm:ckpt2, crm-m2-s03@relay-crm:ckpt2, crm-m2-s04@relay-crm:ckpt2, crm-m2-03@relay-crm:ckpt3, crm-m3-01@relay-crm:ckpt3, crm-m3-02@relay-crm:ckpt3, crm-m3-03@relay-crm:ckpt3, crm-m3-04@relay-crm:ckpt3, crm-m3-07@relay-crm:ckpt3, crm-m3-s01@relay-crm:ckpt3, crm-m3-s02@relay-crm:ckpt3, crm-m3-s03@relay-crm:ckpt3, crm-m3-s04@relay-crm:ckpt3, crm-m3-s05@relay-crm:ckpt3, crm-m3-s07@relay-crm:ckpt3, crm-m3-s08@relay-crm:ckpt3, m1-signout-guard@deskhero:ckpt1, m2-create@deskhero:ckpt2, m2-assign@deskhero:ckpt2, m2-agent-queue@deskhero:ckpt2, m2-happy-path@deskhero:ckpt2, m2-reopen@deskhero:ckpt2, m2-button-gating@deskhero:ckpt2, m2-notes@deskhero:ckpt2, m2-notes-hidden@deskhero:ckpt2, m2-p-skip-transition@deskhero:ckpt2, m2-p-notes-leak@deskhero:ckpt2, m3-overdue-clears@deskhero:ckpt3, m3-canned-apply@deskhero:ckpt3, m3-reply-thread@deskhero:ckpt3, m3-deactivate@deskhero:ckpt3, m3-reactivate@deskhero:ckpt3, m3-audit-transitions@deskhero:ckpt3, m3-workflow-regression@deskhero:ckpt3, m3-p-note-serialization@deskhero:ckpt3, m3-p-sla-edit-role@deskhero:ckpt3, P1-01@portalis:ckpt1, P1-02@portalis:ckpt1, P1-03@portalis:ckpt1, P1-04@portalis:ckpt1, P1-05@portalis:ckpt1, P1-06@portalis:ckpt1, P1-07@portalis:ckpt1, P1-08@portalis:ckpt1, P1-09@portalis:ckpt1, S1-01@portalis:ckpt1, S1-02@portalis:ckpt1, build_failed@portalis:ckpt2, build_failed@portalis:ckpt3

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
