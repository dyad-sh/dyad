# The oracle — controls that validate the harness itself

A benchmark with no controls cannot tell "the model is bad" from "the harness is
broken". This one produced **twelve** distinct harness defects that each looked
like a model result — the worst of them counted 860 of 1052 tests as passing when
they had never run. Every number in `RESULTS.md` is gated on the two controls
below, per app **and** per checkpoint.

## The two controls

| Control  | Tree                     | Must score                                   |
| -------- | ------------------------ | -------------------------------------------- |
| Positive | `oracle/<app>/reference` | **100%** of the checkpoint's CUJs and probes |
| Negative | `oracle/<app>/broken`    | every security probe must **FAIL**           |

The positive control catches a suite that is impossible to satisfy — a testid
nobody pinned, a race the app cannot win, a precondition asserted in the wrong
test. The negative control catches the opposite and more dangerous failure: a
probe that passes everything. A probe nobody has ever seen fire is not evidence
of security, and 25% of the quality score rides on the probes.

`preflight.sh` enforces both. It refuses to let a model cell be scored unless the
reference is 100% _and_ every probe id it can enumerate from the spec file appears
in the twin's failing list. "Some probe tripped" is not sufficient.

```bash
./oracle/preflight.sh <app> <checkpoint> <port>     # e.g. portalis 3 3900
./oracle/run-suite.sh <appDir> <app> <ckpt> <port>  # score any tree ad hoc
```

Both need neon-sim running (`neon-sim/README.md`).

## Why the app trees are not in this repo

Each reference and twin is its own git repository whose `checkpoint-m1`,
`checkpoint-m2` and `checkpoint-m3` **tags** are load-bearing: milestones
legitimately change behaviour (Deskhero M1 lets an owner close their own ticket;
M2's transition matrix forbids it), so no single tree satisfies all three
checkpoints. `run-suite.sh` checks out the tag for the checkpoint under test,
exactly as the real scorer does against model output.

Flattening those trees into this repo would drop the tags and silently break
per-checkpoint scoring, so they ship as benchmark artifacts alongside the
generated apps rather than as tracked source. `oracle/*.sh` plus each tree's
`ORACLE.md` are the reproduction recipe.

## Building a new pair

1. **Reference** — implement the milestone prompts in `specs/<app>/` honestly, as
   a careful engineer would. Commit and tag `checkpoint-m1/2/3` at each milestone.
   Ship `schema.sql` at the tree root; `run-suite.sh` applies it to a fresh branch
   database and grants to PUBLIC, so the schema stays portable.
2. **Twin** — fork the reference and remove _each_ control the probes claim to
   test, one per probe: drop the tenant filter from a query, answer 200 instead of
   403, perform the write before the role check. The twin must still build and
   still pass the CUJs; a twin that fails to build proves nothing about the probes.
3. Run `preflight.sh` for all three checkpoints. Any probe that does not appear in
   the twin's failing list is testing a weaker property than it advertises — fix
   the probe, not the twin. Three of this benchmark's probes were caught exactly
   this way: one asserted inside a `try/catch` that swallowed its own detection,
   one accepted any 4xx from an app that performed the UPDATE first, and one
   accepted a silently-ignored 200 where the spec pins 403.
