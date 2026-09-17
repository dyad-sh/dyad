# Model effort and catalog limits on the engine path

Learned while running the app-builder benchmark (`dyad:run-benchmark`) across
15 models. Each item was a silent wrong result before it was understood.

- **The remote catalog's `maxOutputTokens` is sent verbatim as the request's
  `max_tokens`.** Providers that count prompt + max_tokens against the context
  window (OpenRouter did for `meta/muse-spark-1.3`, catalog value 943,718 vs a
  1,048,576 context) reject every request once the prompt passes ~105k tokens:
  `400 This endpoint's maximum context length is 1048576 tokens. However, you
requested about 1055390 tokens`. Keep catalog output limits well under the
  context window.
- **A model the catalog does not know resolves to `maxOutputTokens: undefined`,
  and `@ai-sdk/anthropic` then defaults `max_tokens` to 4096.** Symptom: every
  large `write_file` truncates, the agent re-reads and retries, responses of
  exactly 4096 completion tokens. OpenAI-compatible paths send no default and
  are not affected.
- **Effort is provider-specific on the engine (LiteLLM) path**, see
  `src/ipc/utils/thinking_utils.ts`: OpenAI gets `reasoning.effort`
  (`/responses`), Anthropic gets `output_config.effort` + adaptive thinking,
  Gemini gets a thinking BUDGET (`thinking.budget_tokens`: minimal 0, low
  1000, medium 4000, high -1 = dynamic), not a `thinkingLevel`; OpenRouter
  models are sent no effort field at all and run at the provider default.
- **Gemini 3 through the engine can fail mid-conversation with
  `400 Vertex_ai_betaException … "Corrupted thought signature"`** (LiteLLM
  thought-signature round-trip). It kills the agent turn; treat it as an
  engine-side fault, not a model or prompt problem.
- **Probing a model with a 1-token chat completion is not a reliable "does it
  exist" check**: OpenRouter refuses `max_tokens: 1` for reasoning models,
  and `gpt-6-astra` rejects `max_tokens` entirely (`Use
'max_completion_tokens' instead`). Use ≥16 tokens and try both parameter
  names before concluding a model name is invalid.
