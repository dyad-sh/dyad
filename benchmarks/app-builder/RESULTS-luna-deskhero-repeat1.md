## GPT-6 Luna Deskhero — user-requested replicate (2026-09-22)

> Historical pre-audit comparison, preserved for provenance. Current scores and
> corrected costs are in [RESULTS.md](RESULTS.md), following the
> [September 29 harness/accounting audit](AUDIT.md).

Fresh full generation at the same product-default **medium** effort, unchanged prompts, pinned catalog (`catalog-2026-09-22-gpt6-sl.json`), pricing, and budgets. No generated-code fixes or admin-bootstrap hints. **Leaderboard update (2026-09-22):** at the user’s explicit request, repeat1 now replaces the original Deskhero cell in the headline score, cost, and duration. Original artifacts and the comparison below are preserved. Relay CRM and Portalis remain their original runs; this is a mixed-run result, not a fresh three-app run.

| Run                          | Deskhero /100 | Build cost | Build minutes | Checkpoint checks passed |
| ---------------------------- | ------------: | ---------: | ------------: | ------------------------ |
| Original                     |          39.3 |      $0.33 |          27.1 | 12/12, 5/20, 3/22        |
| repeat1 (separate replicate) |      **86.5** |  **$0.24** |      **23.8** | **9/12, 19/20, 21/22**   |

The repeat passed **28/33 customer-journey checks and 21/21 security probes** (49/54 total). Judge scores were 0.55, 0.75, and 0.825; all three score/judge pairs validated with the exported `validateCheckpoint`. All three database snapshots were confirmed in PostgreSQL; each milestone recorded zero stream errors. End-to-end generation and scoring took 29.3 minutes. Costs are generation only, excluding judges.

**Why the improvement:** the original signup handler assigned the admin role only when `NODE_ENV !== "production"` and the email local part started with `admin+`. Production scoring therefore created requesters, blocking many downstream admin/agent checks. The repeat's `src/app/api/me/bootstrap-role/route.ts` applies the email rule without the environment gate, and the admin/agent workflow checks largely passed. The unchanged prompt's “local dev” bootstrap wording remains ambiguous relative to production-mode evaluation.

**Remaining failures:** three milestone-1 checks expected lowercase priority text (`high` / `medium`), but the UI displayed `High` / `Medium priority`; the milestone-2 bootstrap check reached the admin dashboard but expected lowercase `admin`, while the badge displayed `Admin`. The milestone-3 audit test filtered for literal `role_change`, while the generated audit UI renders that event as `Role change`. Source inspection confirms the role-change endpoint writes the event and the UI maps its label; the failed assertion alone does not establish missing audit persistence. These five UI-contract mismatches remain counted as failures; no tests or app code were adjusted.

**Run integrity:** all **124** wire requests used GPT-6 Luna at **medium**, with a **128000** output cap, and all returned HTTP 200. No retries, missing judges, harness repairs, or budget changes were needed.

**Interpretation:** +47.2 points on one independent repeat, not a fresh three-app run. Each run is one sample; this pair does not establish an expected score. Original Relay CRM remains 82.3 ($0.50, 34.4 minutes), Portalis 91.8 ($0.29, 23.4 minutes); the original three-app total was $1.11 and overall 71.2 before selecting repeat1. The demos use those canonical apps plus clearly labelled Deskhero repeat1.

Artifacts: [validation](results/run-20260922-luna-deskhero-repeat/validation.json), [run state](results/run-20260922-luna-deskhero-repeat/state.json). Original cell: `gpt-6-luna-deskhero`; repeat: `gpt-6-luna-deskhero-repeat1`.

### Luna video demos

[Watch all three apps (4:55)](https://wwwillchen-bot-mini.tail5775e4.ts.net:8443/demo-gpt-6-luna-all-apps.mp4). Order: original Relay CRM → Deskhero repeat1 → original Portalis. Durations below are rounded to the nearest second.

| Demo                                                                                                          | Duration | Tour steps | Failures retained in recording                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | -------: | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Relay CRM — original](https://wwwillchen-bot-mini.tail5775e4.ts.net:8443/demo-gpt-6-luna-relay-crm.mp4)      |     1:27 |      10/12 | Invite acceptance timed out; subsequent viewer-permissions assertion failed.                                                                                                                                                                                                                                 |
| [Deskhero — repeat1](https://wwwillchen-bot-mini.tail5775e4.ts.net:8443/demo-gpt-6-luna-deskhero-repeat1.mp4) |     2:15 |       6/12 | Agent queue ticket-opening failed, then dependent transition, note, reply/resolution and requester-reply steps failed; audit display assertion also failed. The ticket is visible in sample frames, but its queue link lacks the tour's `ticket-row` selector. These tour results are distinct from scoring. |
| [Portalis — original](https://wwwillchen-bot-mini.tail5775e4.ts.net:8443/demo-gpt-6-luna-portalis.mp4)        |     1:13 |      12/13 | Usage-dashboard visibility assertion failed.                                                                                                                                                                                                                                                                 |

**Video verification:** all three recordings are H.264, 1600×1000, yuv420p, 24 fps, with matching time bases. Combined via FFmpeg concat streamcopy (294.625 seconds), fully decoded without errors. Sample frames and the Deskhero repeat title were visually inspected. All four HTTPS URLs returned **200** for full requests and **206** for byte-range requests. Browser playback/seeking was not manually exercised.

**Serving change:** the existing Python gallery server did not support byte ranges. Tailscale direct-file serving could not read the external-drive files and was reverted. An existing Express library now serves only these four videos on loopback port 8091, with four explicit Tailscale routes. The gallery root proxy, other routes, videos, and index were preserved. The server uses no API credential. Details: `results/run-20260922-luna-deskhero-repeat/video-verification.json`, `video-server.pid`, and before/after Tailscale snapshots; launcher: `.claude/tmp/bench-20260921/serve-luna-videos.cjs` under the repository.
