# Scoring and accounting audit — September 2026

This repair keeps generated apps, prompts, selected runs, the judge model/rubric
and 60/25/15 weights unchanged. It changes the harness, not model output. Model
builds were not repeated; production compilation of archived code is part of
checkpoint evaluation.

The unchanged composite pools customer-journey checks across the three
checkpoints (60%), pools security probes (25%), and averages the three judge
scores (15%). A model's overall is the mean of its complete app composites.

## Reproduced harness defects

| Check                              | Evidence and repair                                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRM empty state                    | The saved app renders both `contacts-list` and `contacts-empty`. The old union throws a strict-locator error. Accept either visible surface, then separately assert zero contact rows and no owner data.                                                                          |
| Portalis sign-out                  | The required `sign-out-button` is inside the required `user-menu`. Open the menu before clicking its item. No test-ID fallback was added.                                                                                                                                         |
| Portalis organization switcher     | The app mounts options when its dropdown opens. Open it before counting IDs; preserve support for native selects and already-open menus.                                                                                                                                          |
| CRM invite acceptance              | The old helper returned after the click, before the POST committed. Poll the invitee's pinned membership API before inspecting it or navigating. The unauthorized-accept attack and roster assertions remain unchanged.                                                           |
| Portalis project lifecycle         | Checkpoint 3 navigated away immediately after save/delete, unlike checkpoint 2. Wait for submission before checking persistence.                                                                                                                                                  |
| Deskhero deletion                  | The prompt does not require a confirmation test ID. The app uses an accessible alert dialog. Support inline/native/modal confirmation and wait for the pinned DELETE response before checking the list. The previous test could also falsely pass before hydration.               |
| Deskhero self-assignment           | The checkpoint-2 test navigated away immediately after clicking Assign to me. Wait for the pinned PATCH before inspecting the agent queue, as the existing administrator-assignment helper already does.                                                                          |
| CRM deletion                       | The same immediate-navigation race occurred in checkpoint 1 and 3 contact deletion. Wait before checking the list and direct detail access.                                                                                                                                       |
| CRM stage persistence and activity | Sonnet's saved kanban code moves the card optimistically before awaiting PATCH. The tests reloaded/navigated before that write settled, losing the persisted stage or its activity entry. Settle submission before navigation; keep the same persistence and timeline assertions. |
| Portalis member settings           | Read-only inputs are noneditable even when not disabled. Do not attempt to fill them; still verify the administrator sees the unchanged organization name.                                                                                                                        |

Targeted original-versus-repaired executions used GPT-6.1 Sol's identical
saved checkpoints and fresh test identities. The repaired full suites pass
156/156 checks. The original Deskhero deletion check was nondeterministic;
the replacement explicitly observes the successful deletion response.

## Accounting

`proxy/accounting.mjs` owns usage normalization and list-price calculation for
both live recording and historical correction. It preserves OpenAI cache-write
counts, uses the selected context tier's write rate, handles Anthropic's
start/delta usage ahead of lossy engine stop summaries, and retains usage
across large streamed responses instead of evicting it from a rolling tail.

`audit-accounting.mjs` correlates requests using archived message request IDs.
Unlabelled side tasks are bounded by the milestone's creation and checkpoint
commit timestamps in the correlated ledger. Cell totals must reconcile before
correction. The previous gap-clustering/proportional-allocation repricer is
replaced; each milestone gets its actual attributable token cost. Original
ledgers are never rewritten and original summaries are backed up.

Historical prices remain the pinned list-price book, including its documented
normalizations. These are **model-token cost estimates**, not provider invoices;
judge and non-token tool-service fees are excluded. Missing usage cannot be
reconstructed from request size. Such totals are labelled `≥` (known-token
lower bounds) and excluded from cost/value comparisons. Unreconcilable or
unpriced records remain unverified rather than being assigned zero cost.

## Reproduce

```sh
node --test benchmarks/app-builder/proxy/engine-proxy.test.mjs \
  benchmarks/app-builder/audit-accounting.test.mjs \
  benchmarks/app-builder/scoring.test.mjs \
  benchmarks/app-builder/promote-rescore.test.mjs \
  benchmarks/app-builder/judge/judge.test.mjs
cd benchmarks/app-builder/cuj-tests
npm test -- --config playwright.harness.config.mjs
```

Against the local artifact archive and a running neon-sim:

```sh
node benchmarks/app-builder/audit-accounting.mjs --data "$BENCH" \
  --out "$BENCH/results/accounting-audit" --write
node benchmarks/app-builder/rescore.mjs --data "$BENCH" \
  --out "$BENCH/results/rescore-audit" --jobs 3
```

The rescore manifest records each checkpoint SHA, snapshot database, suite
hash, outcome, and unavailable archive. Rerunning the same command resumes
unfinished evaluations; changing the suite requires a new output directory.
Use at most six workers and only with adequate memory. The local test phase
does not call models. Since the LLM judge consumes test outcomes, refresh its
verdict when those outcomes change; retain valid verdicts only when their
evidence is unchanged. Publication must wait for artifact validation;
raw saved apps and databases are local artifacts, not included in Git.

Run the judge refresh in an authenticated, protected execution. It can watch
the local rescore and processes only changed evidence or missing judgments:

```sh
node benchmarks/app-builder/rejudge.mjs --data "$BENCH" \
  --scores "$BENCH/results/rescore-audit" --out "$BENCH/results/rejudge-audit"
```

It stops on a failed judge rather than retrying the whole queue. New verdicts
record the source commit and a hash of the supplied test evidence. Old verdicts
remain untouched until promotion; judge costs remain separate from build costs.

After all tasks finish, validate and promote them together:

```sh
node benchmarks/app-builder/promote-rescore.mjs --data "$BENCH" \
  --scores "$BENCH/results/rescore-audit" --judges "$BENCH/results/rejudge-audit"
```

Promotion preserves the previous score artifacts before replacing them. Saved
summaries whose checkpoint code is missing are explicitly unscored, not silently
mixed into the refreshed tables with old-harness scores. Recoverable experiments
without a saved judge receive one using the same rubric; any missing or invalid
judge blocks publication rather than silently producing a partial composite.

## Preserved application failures

The final source review distinguishes six real compilation failures from one
start/readiness failure. Five older Sidekick experiment checkpoints have invalid
Next.js page/route types; GLM 5.3 Flash CRM checkpoint 3 omits a required workspace
role property. Its checkpoint 2 builds only API routes and has no sign-in page,
so it cannot run the pinned authenticated journeys. These are not relabelled as
infrastructure errors or excused by the harness repair.

Sonnet 5.5's final CRM checkpoint passes the repaired stage-persistence and
activity-creation checks but still fails the expected activity actor-name check
(the UI shows an email instead). The corrected suite reports 19/20, not a perfect
score. Other unchanged assertions continue to count genuine workflow failures.

## Published audit results

- **348/348 recoverable checkpoints evaluated** from unchanged saved source and
  database snapshots. A transient simulator connection failure was retried; no
  infrastructure failures were published as model failures.
- **341 required judgments validated:** 196 refreshed or reused with matching
  corrected evidence, 145 valid unchanged verdicts retained. Seven genuine
  build/start failures do not require judges.
- **63 missing source checkpoints** are explicitly unscored. Six unsupported todo
  experiments are inventoried separately. All 22 previously complete selected
  model comparisons remain complete; MiMo Pro still lacks a complete overall.
- Accounting across **157 saved cells:** 138 verified, 17 incomplete lower bounds,
  and two unreconciled/unverified records. No raw ledger was rewritten.

| Selected model      | Previous overall | Corrected overall | Corrected build cost |
| ------------------- | ---------------: | ----------------: | -------------------: |
| GPT-6.1 Sol         |             93.0 |              97.4 |                $3.52 |
| Claude Opus 5.5     |             93.4 |              96.0 |               $14.29 |
| Claude Sonnet 5.5   |             92.8 |              95.9 |                $4.05 |
| GPT-6 Sol           |             94.3 |              95.4 |               $10.46 |
| GPT-6 Luna          |             86.9 |              88.9 |                $1.07 |
| DeepSeek V4.1 Flash |             88.5 |              91.4 |                $0.66 |

The selected Sol/Luna Deskhero repeats remain selected. One sample per app/run;
small score differences are not statistically meaningful. Before/after values
for every displayed model, checkpoint source/evidence hashes, unavailable
archives, and accounting reconciliation status are recorded in
[audit metadata](audits/2026-09-29.json),
[checkpoint inventory](audits/2026-09-29-checkpoints.csv), and
[accounting inventory](audits/2026-09-29-accounting.csv).
