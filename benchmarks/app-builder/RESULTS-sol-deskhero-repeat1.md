## GPT-6 Sol Deskhero — user-requested replicate (2026-09-22)

> Historical pre-audit comparison, preserved for provenance. Current scores and
> corrected costs are in [RESULTS.md](RESULTS.md), following the
> [September 29 harness/accounting audit](AUDIT.md).

This is a fresh full generation at the same product-default **medium** effort, same pinned prompts and catalog (`catalog-2026-09-22-gpt6-sl.json`), and unchanged pricing. No model-output fixes or additional hints. **Leaderboard update (2026-09-22):** at the user’s explicit request, repeat1 now replaces the original Deskhero cell in the headline score, cost, and duration. Original artifacts and the comparison below are preserved. Relay CRM and Portalis remain their original runs; this is a mixed-run result, not a fresh three-app run.

| Run                          | Deskhero /100 | Build cost | Build minutes | Checkpoint checks passed |
| ---------------------------- | ------------: | ---------: | ------------: | ------------------------ |
| Original                     |          37.0 |      $2.44 |          14.8 | 12/12, 4/20, 3/22        |
| repeat1 (separate replicate) |          95.9 |      $3.21 |          17.8 | 12/12, 20/20, 22/22      |

The repeat passed all **33 customer-journey checks and 21 security probes**. Judge scores were 0.675, 0.725, and 0.775; all three score/judge pairs validated using `validateCheckpoint`. All milestone snapshots exist and all stream-error counts are zero. End-to-end run time was 22.9 minutes including setup and scoring. Costs above are generation costs, excluding judge calls.

**Why the difference:** the original milestone-2/3 `src/lib/auth/current-user.ts` granted the initial admin role only when `NODE_ENV === 'development'` and the email local part started with `admin+`. The scorer runs a production build, so admin personas became requesters and redirected to `/tickets`; admin-bootstrap was the first failure and many later checks failed at that prerequisite. The repeat's milestones 2 and 3 grant the same email-based role without the environment gate, and the admin workflows passed. The prompt's “Bootstrap rule (local dev)” wording remains ambiguous relative to production-mode evaluation. This is not evidence of 35 independent bugs in the original or of missing tables.

**Run integrity:** 162 wire requests used GPT-6 Sol at medium with a 128000 output cap: 161 HTTP 200 and one HTTP 502, followed by successful requests. The transient response recovered without a manual generation retry; no harness or generated-code changes were made. The wire verifier flags that non-200, which is disclosed rather than hidden. No judges were missing or needed replacement.

**Interpretation:** +58.9 points demonstrates sensitivity to one bootstrap decision under unchanged inputs, not a fresh three-app run. Each run is one sample; small score differences are noise, and this pair does not establish an expected score.

Artifacts: [validation](results/run-20260922-sol-deskhero-repeat/validation.json), [run state](results/run-20260922-sol-deskhero-repeat/state.json). Original cell: `gpt-6-sol-deskhero`; replicate: `gpt-6-sol-deskhero-repeat1`.
