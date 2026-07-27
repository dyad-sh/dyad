# Evals

The eval suite covers the production `search_chats` and `read_chat` flow after
the pi migration.

`plumbing_check.eval.ts` is model-free and always runs. It seeds the real test
database, drains the production FTS index, exercises both tools, records
observed citations, and verifies cross-app reads fail closed.

`chat_history.eval.ts` runs the same retrieval flow against the authored
scenarios in `fixtures/chat_history/`. Paid benchmark cases use pi directly;
they no longer depend on the Vercel AI SDK or the removed Dyad Engine gateway.

The former code-editing eval was intentionally removed with `search_replace`.
Its tools and prompt variants measured the deleted build/Pro execution path,
so retaining it would not evaluate the shipped agent.

## Run

Run the model-free plumbing and fixture validation:

```bash
npm run eval
```

Paid benchmark jobs are skipped unless `OPENAI_API_KEY` is present. Jobs for
Anthropic are included when `ANTHROPIC_API_KEY` is also present. The benchmark
uses GPT 5.4 as its judge, so OpenAI credentials are required for every paid
run.

```bash
OPENAI_API_KEY="..." npm run eval -- chat_history
OPENAI_API_KEY="..." ANTHROPIC_API_KEY="..." npm run eval -- chat_history
```

Useful filters:

```bash
CH_SMOKE=1 OPENAI_API_KEY="..." npm run eval -- chat_history
CH_ONLY=vague_decision-1 OPENAI_API_KEY="..." npm run eval -- chat_history
CH_CONCURRENCY=2 OPENAI_API_KEY="..." npm run eval -- chat_history
```

Wrong benchmark answers are recorded instead of failing the suite. Results are
written under `benchmark-results/chat-history/<run>/` as JSONL plus a Markdown
summary. Wiring, fixture consistency, and harness isolation remain hard test
failures.

See `fixtures/chat_history/AUTHORING.md` for scenario authoring rules.
