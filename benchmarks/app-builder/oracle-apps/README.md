# Oracle apps — the benchmark's controls, as source

Twelve apps: for each of the six benchmark apps, a **reference** implementation
and a deliberately **broken twin**. They are what makes the scores in
[`../REPORT.md`](../REPORT.md) trustworthy, and they are here so you can read
them without standing up the benchmark.

| | Tree | Contract |
| --- | --- | --- |
| Positive control | `<app>/reference` | must score **100%** of every checkpoint's CUJs and probes |
| Negative control | `<app>/broken` | **every** security probe must fail, while every non-probe CUJ still passes |

`oracle/preflight.sh` in the benchmark refuses to score a model cell unless both
hold, per app *and* per checkpoint. All eighteen controls were green when these
were captured.

## Why both are necessary

The reference catches a suite that is **impossible to satisfy** — a testid nobody
pinned, a race the app cannot win, a precondition asserted in the wrong test.

The twin catches the opposite and more dangerous failure: a probe that **passes
everything**. A probe nobody has ever seen fire is not evidence of security, and
25% of each quality score rides on the probe table. Three probes in this
benchmark turned out to be testing weaker properties than they advertised — one
asserted inside a `try/catch` that swallowed its own detection, one accepted any
4xx from an app that performed the `UPDATE` and *then* answered 403, one accepted
a silently-ignored 200 where the spec pins 403. None of the three could fail.
Review did not find them; the twins did.

Each twin carries one named defect per probe (drop a tenant filter, answer 200
where 403 is pinned, write first and refuse afterwards, trust a client-supplied
id, skip a role check). Everything else is identical to its reference, so a probe
failure is attributable to exactly one defect. Each `broken/ORACLE.md` lists them.

## Two things worth knowing before you read these

**The first three references are not independent.** `relay-crm`, `deskhero` and
`portalis` were built by starting from **claude-opus-5's own benchmark output**
and patching it. That weakens the control in a specific way: a reference derived
from a candidate proves the suite is satisfiable by *that candidate's
architecture*, not by an independent spec-conformant implementation. It is why a
harness assertion that no `<select>`-based workspace switcher could satisfy
survived for so long — opus happened to render always-visible buttons, the
reference inherited that shape, and the control never fired.

`portalis/reference` is the clearest case: it is opus's code plus `keepalive:
true` on ten mutation fetches. No model uses `keepalive` anywhere. Strip all ten
and it still scores 19/19 and 21/21 — that patch was compensating for a race in
the harness's own helper, not demonstrating anything about the app.

**`ledgerly`, `slotline` and `curbside` were built from the specs, never from the
tests.** The author could read a test to diagnose a failure but could not
implement anything the spec did not ask for. That constraint turns a reference
build into a spec-sufficiency audit, and it immediately found eleven cases where
a test demanded a contract its prompt never pinned — three of which would have
failed a fully correct app. These six trees are the ones to read if you want to
see what the benchmark actually asks for.

## Layout and running them

Each tree is a Next.js app with a hand-written `schema.sql` at its root that
applies cleanly to an empty database and is idempotent on re-apply. The
`neon_auth` schema is provisioned by `neon-sim`, not by these files. Every tree's
`ORACLE.md` records its final scores and, for the twins, its defect list.

`node_modules`, `.next`, `.env.local` and git history are stripped. In the
benchmark each tree is its own repository carrying `checkpoint-m1/2/3` tags,
because milestones legitimately change behaviour — Deskhero M1 lets an owner
close their own ticket, which M2's transition matrix forbids — so no single tree
satisfies all three checkpoints. **What is here is the checkpoint-m3 state only.**
To run one against its own checkpoint you need the tagged repository, not this
snapshot.

```bash
# from benchmarks/app-builder/, with neon-sim running
./oracle/run-suite.sh oracle/curbside/reference curbside 3 3900
./oracle/preflight.sh curbside 3 3900          # both controls, one command
```

These are captured artifacts: editing them breaks correspondence with the
recorded results.
