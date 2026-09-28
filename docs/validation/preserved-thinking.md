# Preserved thinking: Plan → Agent

Validated on 2026-09-28 against Dyad Engine's streaming Messages endpoint with
`anthropic/claude-opus-5-5` and a protected Dyad Pro credential.

## Configuration

Both the Dyad Pro Engine and direct Anthropic provider now send
`thinking.block_binding.prefix_mismatch_behavior: "drop_block"` together with
`anthropic-beta: thinking-binding-controls-2026-08-01`, preserving other beta
headers. This applies to adaptive/enabled thinking, not disabled/between-tools
thinking. The pinned AI SDK does not expose the controls, so the shared fetch
wrapper applies them after serialization.

The `anthropic_preserved_thinking` debug log records the model, request ID, and
`input_transformations` (only type, path, reason). It observes streaming
`message_start` and fallback `message_delta` as well as non-streaming responses.
It does not log credentials, prompts, thinking text, or signatures.

## Controlled API experiment

The test kept messages append-only, changed the system prompt from Plan to Agent,
and replayed the original signed thinking blocks. Each turn produced a signed
thinking block. Paths identify the blocks in the actual request.

| Turn             | Thinking blocks sent                           | Dropped paths (`prefix_binding_mismatch`) |
| ---------------- | ---------------------------------------------- | ----------------------------------------- |
| Plan 1           | none                                           | none                                      |
| Plan 2           | `messages.1.content.0`                         | none                                      |
| Agent 1 (switch) | `messages.1.content.0`, `messages.3.content.0` | both Plan blocks                          |
| Agent 2          | previous two + `messages.5.content.0`          | only the two Plan blocks                  |
| Agent 3          | previous three + `messages.7.content.0`        | only the two Plan blocks                  |

A second branch removed the reported Plan blocks immediately after the switch.
Both subsequent Agent requests then returned `input_transformations: []` while
replaying the Agent blocks. The main experiment intentionally retained the old
blocks; the application does not delete stored history as part of this change.
Some controlled responses contained only thinking (the probe used a 5,000-token
cap); this experiment checks acceptance of signed input blocks, not answer
quality or completion.

**Conclusion:** new-mode thinking can be preserved on later turns even while old
blocks continue to be reported as dropped. A nonempty transformation array alone
does not mean that every block was discarded. Further edits to the system, tools,
or earlier messages can still invalidate newer thinking; this is not a promise
that arbitrary file edits, context rewriting, or tool changes preserve it.

## Real Dyad pipeline

The opt-in `src/__tests__/evals/preserved_thinking.eval.ts` drives the real
`chat:stream` handler, mode-specific prompts/tools, database persistence and
history reconstruction against the live Engine in an isolated fixture app.
Explorer/Implementer are disabled and prompts ask for a conceptual code example
without tools or file edits, isolating the mode-switch behavior.

The successful three-turn run persisted one reasoning block per turn. At the
switch and on the subsequent Agent turn, the only reported dropped path was
`messages.1.content.0` (the Plan block). The instrumented final request explicitly
sent both that block and `messages.3.content.0` (the Agent block); only the Plan
block appeared in the response transformation list.

Run with `DYAD_LIVE_PRESERVED_THINKING=1` and `DYAD_PRO_KEY` supplied securely in the
environment:

```sh
npm run eval -- src/__tests__/evals/preserved_thinking.eval.ts
```

Inspect `PRESERVED_THINKING_TURN`, `PRESERVED_THINKING_INPUT`,
`PRESERVED_THINKING_OUTPUT`, and
`anthropic_preserved_thinking` log entries together. The test requires reasoning
to be persisted on every turn, so an empty transformation list cannot pass merely
because the model produced no thinking. Live adaptive output is nondeterministic;
this test is skipped in ordinary CI and makes paid requests only when opted in.

Reference: [Anthropic preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#mismatch-behavior).
