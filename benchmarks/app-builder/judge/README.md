# LLM-judge pipeline

Scores one checkpoint per invocation with the candidate model's **two
cross-vendor judges**, per DESIGN.md §2. Judge traffic goes straight to the
engine (never through the recording proxy) so judge tokens are never
attributed to a cell's build cost.

## Usage

```bash
node judge.mjs --cell <cellId> --milestone <m> [--judges id1,id2]
# e.g.
node judge.mjs --cell claude-sonnet-5-relay-crm --milestone 1
```

Requires `DYAD_PRO_KEY` in the environment, the cell's archived checkout at
`results/s-cell/checkouts/<cellId>` (with `checkpoint-m<k>` tags), and — when
available — CUJ results at `results/s-score/<cellId>-ckpt<m>-a1.json` (judged
"from code alone" otherwise). Output: `results/judge/<cellId>-m<m>.json` with
per-judge raw verdicts + usage + cost, per-dimension averages, and
`judgeScore` (mean of dims ÷ 10) for the 15% slot in the checkpoint score.

## Judge assignment (same-vendor judge dropped)

| Candidate vendor | Judges      |
| ---------------- | ----------- |
| all candidates   | gpt-5.6-sol |

## Input caps

≤40k chars of milestone diff (files prioritized: `src/app/api`, `src/db`,
auth, middleware, `src/lib`; lockfiles/images excluded; dropped-file count is
reported to the judge), ≤20k chars of priority source files at the checkpoint,
≤2k chars of file tree, the milestone prompt, and the automated test summary.

## Notes

- Validation ran with `--judges gemini/gemini-3.6-flash,gemini/gemini-3.6-flash`
  (cheapest pair) against `claude-sonnet-5-relay-crm` m1: verdict
  bugs 9 / security 10 / code_quality 9 / schema 9 → judgeScore 0.925.
  Production runs use the default single-judge assignment (gpt-5.6-sol).
- gemini-3.6-flash occasionally emits malformed JSON; the parser tolerates
  trailing commas / literal newlines / numeric strings, re-prompts once, and
  saves raw text to `results/judge/debug-*.txt` on failure. A single-judge
  result is marked `judgePanel: "partial"`.
- Cost per checkpoint ≈ $0.01–0.15 depending on the judge pair (input is
  ~15–25k tokens; opus-seat invocations dominate).
