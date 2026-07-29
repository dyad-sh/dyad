# Generated apps — app-builder benchmark, Relay CRM column (2026-07-29)

Seven complete Next.js apps, each built end-to-end by a different model through
Dyad's local-agent mode against the same three milestone prompts
(`benchmarks/app-builder/specs/relay-crm/`), starting from the same pinned
template snapshot with a Neon-compatible backend (neon-sim). Each directory is
the final state at `checkpoint-m3` of that model's single benchmark cell
(N=1) — committed VERBATIM, unreviewed, exactly as the model left it.

| Directory | Model | Build | Cost | CUJs | Security probes | Composite |
|---|---|---|---|---|---|---|
| `claude-fable-5/` | claude-fable-5 | 20 min | $12.86 | 32/34 | 16/16 | 93.1% |
| `gpt-5.6-sol/` | gpt-5.6-sol | 27 min | $8.70 | 31/34 | 16/16 | 91.8% |
| `claude-opus-5/` | claude-opus-5 | 22 min | $10.84 | 31/34 | 16/16 | 91.5% |
| `x-ai_grok-4.5/` | grok-4.5 | 19 min | $1.97 | 31/34 | 16/16 | 91.1% |
| `claude-sonnet-5/` | claude-sonnet-5 | 26 min | $8.26 | 31/34 | 16/16 | 91.0% |
| `gpt-5.6-luna/` | gpt-5.6-luna | 12 min | $1.46 | 32/34 | 15/16 | 90.8% |
| `gpt-5.6-terra/` | gpt-5.6-terra | 6 min | $1.48 | 31/34 | 16/16 | 90.1% |

Scores and methodology: `benchmarks/app-builder/RESULTS.md` on the benchmark
branch (PR #4141). Milestone-by-milestone history is preserved in the
benchmark's archived checkouts (git tags `checkpoint-m1..m3`); these trees are
the m3 snapshots only.

**These apps are benchmark artifacts, not maintained code.** They exist so the
scores can be inspected against the code that earned them (schema choices,
authorization patterns, the specific CUJ failures). Do not deploy them; do not
lint/format/fix them — any edit invalidates the correspondence with the
recorded scores. They are excluded from repo-wide checks via the directory
`.gitignore`-style carve-outs in the PR.

To run one locally you need the neon-sim stack from the benchmark branch
(`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` in
`.env.local`), then `pnpm install && next dev`.
