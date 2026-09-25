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
- **When changing a fixed internal model, synchronize both remote catalogs
  before shipping:** the production catalog and
  `testing/fake-llm-server/index.ts`. A successful remote fetch bypasses
  `MODEL_OPTIONS`, so persona preflight rejects a model that exists only in the
  app fallback catalog and E2E Explorer/Implementer spawns fail immediately.
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
- **ChatGPT subscription model visibility depends on Codex `client_version`.**
  The signed-in `/backend-api/codex/models` endpoint rejects a request without
  it (HTTP 400). For the same account, `0.154.0` omitted GPT-6 Sol while
  `0.155.1` included it; compare versions with one account before changing the
  remote catalog's `codexClientVersion`.
- **Keep a last known good Codex client version across Dyad catalog outages.**
  Falling back to a pinned version after a failed catalog refresh can invalidate
  a healthy ChatGPT model list and hide subscription models until recovery.
- **Do not serialize two ChatGPT model requests on a subscription send.** If
  the remote version changes during an in-flight lookup, return its successful
  result and refresh in the background; check other suites' catalog mocks when
  adding new imports to `codex_subscription_account.ts`.
- **A background account-model refresh must invalidate the subscription picker
  query when the list changes.** Its normal idle polling interval is 30 minutes.
  If ChatGPT rejects a published client version with HTTP 400, retry the pinned
  version once; do not double-request on auth or transient network failures.
- **Auto entries can be engine-only products, not provider model aliases.**
  When adding a direct-inference source, hide and reject engine-only choices
  (such as Super Value); never let them fall through generic premium Auto aliases.
- **BYO applies to main-chat inference, not Pro auxiliary tasks.** Keep fixed
  helper/persona models and route Pro BYO helpers through the engine using a
  request-only settings snapshot; never require another provider key or mutate the main-chat source.
