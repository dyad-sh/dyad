# Authoring compaction-benchmark fixtures

Each fixture is a synthetic-but-realistic long Dyad AI-coding session (~180k
estimated transcript tokens) with a ground-truth manifest. Fixtures are
produced by `generate.mjs` from a **spec** you author; the session narrative
itself is written by `gpt-5.6-sol` phase-by-phase, and deterministic
bulk-asset/filler turns amplify the transcript to target size (inserted
_before_ the final phase, so the tail stays the authored in-flight task).

## Workflow

1. Write `specs/<name>.spec.json` (format below).
2. Run from this directory:
   `node generate.mjs --spec specs/<name>.spec.json`
   (env: `DYAD_PRO_KEY`; takes ~10–20 min — sequential engine calls.)
3. On success it writes `<name>.json` (the fixture) and `<name>.stats.json`.
   On failure it prints the reason (invalid segment JSON after retries,
   missing evidence, token band) — adjust the spec (more/bigger phases or
   bulk assets if short; fewer if long) and re-run with `--force`.

## Spec format

```jsonc
{
  "name": "feature-marathon", // kebab-case, becomes the filename
  "domain": "2-4 sentences describing the app being built and its stack",
  "phases": [
    {
      "id": "p1",
      "goal": "What happens in this phase, concretely (who asks for what, what gets built, what goes wrong). Mention where evidence facts should surface.",
      "turns": 5, // user+assistant pairs; 4-7 typical
      "activeFiles": ["src/pages/Login.tsx", "src/lib/auth.ts"],
      "factIds": ["F1", "F2"], // facts that MUST be planted here
      "bulk": [
        // optional large generated assets
        {
          "asset": "seed-data",
          "path": "src/data/products.ts",
          "kind": "products", // products | users | events
          "count": 220,
        },
        // also: { "asset": "locale-json", "path": "src/locales/de.json", "count": 400 }
        //       { "asset": "long-css",    "path": "src/styles/utilities.css", "count": 260 }
      ],
    },
  ],
  "facts": [
    {
      "id": "F1",
      "tier": 1, // 1 = must survive compaction (3x weight), 2 = should (2x), 3 = nice (1x)
      "category": "decision", // decision | code-change | task-state | plan | constraint | error
      "statement": "What a perfect summary would preserve, phrased as a checkable claim.",
      "evidence": "EXACT string the generator forces into the transcript verbatim.",
    },
  ],
  "traps": [
    {
      "id": "T1",
      "statement": "The summary must present <old> as superseded/abandoned and <new> as current. Presenting <old> as current = contradicted.",
      "supersededEvidence": "EXACT string for the old/abandoned direction",
      "oldPhase": "p1",
      "currentEvidence": "EXACT string for the superseding direction",
      "newPhase": "p3",
    },
  ],
  "probes": [
    {
      "id": "P1",
      "question": "Task given to a fresh model that sees ONLY the summary, e.g. 'What is the next step and why?'",
      "expected": "What a correct answer must contain (used by the judge).",
    },
  ],
}
```

## Authoring guidance

- **Scale**: the authored core comes out around 25–60k est tokens (phases ×
  turns × file sizes); filler covers the rest. 4–6 phases, 4–7 turns each,
  2–4 bulk assets across the spec is the sweet spot. Do not try to reach
  180k with authored phases alone.
- **Evidence strings** must be natural in-dialogue sentences or code
  fragments, 6–20 words, distinctive enough that a substring match is
  meaningful (no generic "run the tests"). They are matched **verbatim** —
  avoid characters the author model might normalize (smart quotes, em
  dashes, `->` arrows).
- **Tier-1 facts** should concentrate in the _final_ phase (current task
  state, active plan) plus the 1–2 load-bearing early decisions/constraints.
  Early-phase detail that a good summary may legitimately drop is tier 3.
- **Traps** are the discriminating cases: a decision made early
  (`oldPhase`) and reversed later (`newPhase`), a disproven debugging
  hypothesis, an abandoned library choice. `statement` must say explicitly
  what counts as contradicted.
- **Probes** test downstream usability, not trivia: "what's the next step",
  "did we already try X", "which files implement Y and what's left".
- **12±2 facts, 2–3 traps, exactly 3 probes** per scenario.
- The final phase must end mid-task (something concrete in flight), because
  production compaction fires mid-session.
