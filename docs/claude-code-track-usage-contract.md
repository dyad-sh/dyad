# Claude Code usage: shared external-model contract

Revised 2026-09-15 to follow [Dyad #4483](https://github.com/dyad-sh/dyad/pull/4483) and the current shared `external_model_usage` service. This replaces the prototype's proposed reservation/outbox/catalog contract. Live Claude charging remains unverified.

## Pricing and admission

- With Pro enabled: $0.02 per million total tokens when the actual model ID contains `-luna`, `-mini`, or `-nano`; $0.10 per million otherwise. No API list-price multiplier or unknown-model special case. Cached tokens count once at the same rate.
- With Pro off: no Dyad credit check or report. Claude subscription usage still applies. This is the existing shared subscription policy, not a fallback after an accounting failure.
- Pro requests capture the accepted Dyad key and consume a main-only, one-use admission. Confirmed insufficient balance or rejected credentials prevents acceptance. Network errors, timeouts, and malformed balance responses allow generation, matching #4483. No reservation or alternate payment source is selected.

## Reporting

`POST /track-usage`, authenticated with the accepted **Dyad** key (never Claude credentials):

```json
{
  "version": 1,
  "id": "main-generated-uuid",
  "connection": "subscription",
  "modelProvider": "anthropic",
  "modelId": "claude-sonnet-actual-id",
  "createdAt": "2026-09-15T12:00:00.000Z",
  "totalTokens": 150,
  "cachedInputTokens": 20,
  "uncachedInputTokens": 80,
  "outputTokens": 50
}
```

`totalTokens = cachedInputTokens + uncachedInputTokens + outputTokens`.
Claude `modelUsage` entries are the sole source, including auxiliary calls. Claude input tokens exclude cache reads/writes; convert to AI-SDK total input by adding both once. Cache writes join uncached input in this engine wire format. Never add top-level aggregate usage to model buckets. TTL allocation has no pricing effect.

One admitted CLI turn can yield multiple reports with distinct event IDs, one per actual model bucket; all retain the same captured account/time. The engine calculates/debits charges, owns credit eligibility and idempotency, and records the authoritative synthetic pricing policy (`dyad/dyad-synthetic-cost-tracking`). The client does not send a monetary amount or trust CLI dollar estimates. The current shared contract does not carry chat/session correlation or a client catalog version; these are not required for the flat policy and are not fabricated by this adapter.

## Failures and persistence

Consume reporting state before the single attempt. No durable outbox, retry, startup replay, reservations, reconciliation records, or blocked future turns. Report counts from failed/cancelled turns when the CLI emits a final usage snapshot. If counts are missing/invalid, do not invent them; discard reporting state and log metadata only. Delivery failures are logged without keys or upstream bodies; accepted usage may remain uncharged, intentionally matching #4483.

Messages retain informational measured model usage and `attempted`, `unavailable`, or `unbilled` status, **not settlement receipts**. The existing billing account is the source of actual spend. CLI session recovery remains separate from billing: interrupted sessions require a new chat to avoid replaying edits.

The loopback fixture validates shape, disjoint totals, flat rates and duplicate identity. It has no live balance or debit. Production Claude reports and real credit debits still require engine integration verification.
