# Proposed subscription usage contract (v1)

Status: proposed engine contract; client and local test fixture implemented,
but not implemented or agreed with the production engine. Commercial gate:
see [validation report](claude-code-validation.md). Live charging is unverified.

## Prototype wire subset

The implemented client sends the request below without the proposed optional
audit fields `cliVersion`, `source`, and `sourceEventIds`. Its accounting source
is one final CLI `modelUsage` snapshot per turn; subagents are disabled. A missing
final snapshot yields an incomplete event, never inferred partial counts.

`POST /authorize-usage` takes `{backend, chatId, turnId}` and requires
`{reservationId, pricingSnapshotId, testMode}`. `POST /track-usage` returns
`{eventId, status, chargeUsd, pricingSnapshotId}`, where status is `settled`,
`test-settled`, or `reconciliation`, and chargeUsd is a nonnegative decimal
string. Reconciliation charge values are not shown as final costs.

The prototype persists an atomic JSON outbox before execution and before
delivery, retries on startup, next admission and explicit retry, and recovers
crashed collecting records as incomplete. The full contract below additionally
requires engine-owned reconciliation, richer receipts, reservation budgets,
credit-pool policy, audit identities and periodic backoff. Reconciliation
receipts currently block further subscription admission until resolved outside
this prototype; the retry button only retries undelivered records.

The fixture uses synthetic rates, in-memory reservations and no real balance.
It is suitable for wire/idempotency/arithmetic tests, not production charging.

## Admission and credit eligibility

Before starting any Subscription turn, the engine must authorize the user,
explicit eligible credit pool, backend, pricing policy and catalog version.
A new admission/reservation operation is required in addition to track-usage:
a balance read alone races concurrent turns. Return a turn-bound reservation
ID, immutable pricing snapshot ID, credit-pool ID and execution allowance.
The engine team must define reservation size, renewal, expiry, maximum debit,
late usage settlement and treatment of usage beyond the reservation.

Default integration behavior: no admission on insufficient eligible balance,
missing catalog information or unavailable engine. Do not select a different
credit pool, API key or backend. No offline free turns. Preserve submitted
prompt/attachments when admission fails. Existing Pro/API accounting is unchanged.

## POST /track-usage

Use existing engine authentication, not Claude credentials. Proposed request:

```json
{
  "schemaVersion": 1,
  "eventId": "persisted-client-generated-uuid",
  "backend": "claude-code",
  "appId": 123,
  "chatId": 456,
  "turnId": "durable-turn-uuid",
  "sessionId": "explicit-cli-session-uuid",
  "reservationId": "engine-reservation-id",
  "pricingSnapshotId": "engine-issued-immutable-snapshot",
  "cliVersion": "2.1.260",
  "outcome": "completed",
  "coverage": "complete",
  "source": "reconciled-cli-turn-usage",
  "sourceEventIds": ["cli-result-uuid"],
  "models": [
    {
      "actualModelId": "observed-raw-model-id",
      "reportedCanonicalModelId": "observed-canonical-id",
      "uncachedInputTokens": 2,
      "cacheReadInputTokens": 2800,
      "cacheWrite5mInputTokens": 0,
      "cacheWrite1hInputTokens": 2407,
      "cacheWriteUnclassifiedInputTokens": 0,
      "outputTokens": 9
    }
  ]
}
```

Each category is a non-negative safe integer and disjoint. Reject invalid,
negative, overflowing and unknown-schema requests. Unknown counts are not zero:
report `coverage: "incomplete"` with missing fields and an accounting error
instead of fabricating a complete models array. Outcome can also be failed or
cancelled; reported consumed usage remains billable.

Aggregate all actual model calls, including auxiliary calls and subagents,
exactly once. Main-model top-level totals must not be added to per-model totals.
Cache TTL breakdown is part of cache-write total, not an additional category.
Thinking is already included in output. The observed CLI result includes an
auxiliary model absent from top-level usage; fixtures must preserve that case.
Never infer mixed-model TTL allocation from a main-model-only breakdown.

For partial/cancelled usage, persist immutable disjoint usage segments, each
with its own eventId and source-call identities. Later recovery must submit
only new segments; any cumulative-final reconciliation requires a separate
engine-owned replacement protocol, not another debit of the full total.
This segmentation/source-identity protocol still requires real-CLI validation.

## Authoritative pricing

Engine resolves raw model identifiers using a versioned mapping covering the
approved local and remote catalogs. Client recognition and canonical IDs are
hints, not authority. Pin model identity, catalog content, currency, rates,
context/service tier rules and pricing-policy version in the receipt.

- Recognized model with complete rates: `0.25 * sum(categoryTokens * categoryRatePerMillion / 1000000)`.
- Unknown to both approved catalogs: `sum(disjointTokens) * 0.10 / 1000000`.
  Do not apply another 25% multiplier.
- Recognized model with missing applicable rate or unresolved write TTL:
  `pricing_incomplete`; hold for reconciliation, not unknown-model fallback.
- Unknown catalog availability is not an unknown model. Catalog outage cannot
  trigger the fallback rate.
- Missing usage: `usage_incomplete`; persist and visibly reconcile. No invented
  counts or zero-cost success receipt.

Use decimal/fixed-point arithmetic and an agreed rounding rule. Round at the
ledger transaction boundary, not per tiny token category. Do not trust client
monetary amounts or the CLI's costUSD/total_cost_usd estimates.

## Atomicity and responses

Uniqueness key: authenticated account plus eventId. In one engine transaction,
validate reservation ownership, validate source overlap, resolve pricing, write
the event and ledger debit, and save a receipt. Identical retries return that
receipt without another debit; same ID with different payload returns 409.
The response must identify whether accepted usage is settled or awaiting
reconciliation; acceptance alone must not be shown as a successful charge.

Receipt: eventId, ledgerEntryId, status, exact decimal charge/currency,
per-model category calculations, pricing snapshot/policy, eligible credit-pool
ID, remaining balance and reservation state. Explicit error codes:
insufficient_balance, reservation_invalid, pricing_incomplete,
usage_incomplete, identity_conflict, service_unavailable.

Usage already consumed must be recorded even if final debit exceeds available
balance. Engine policy must decide settlement/debt; the client must not discard
usage or silently draw a different payment source. Block later turns until the
accounting state allows admission.

## Durable client delivery and UI

Write event and pending-outbox row transactionally before sending. Keep the
same event ID and payload on timeout/crash/retry, including lost responses.
Retry transient errors with bounded exponential backoff and jitter; permanent
validation errors enter visible reconciliation. Preserve unresolved accounting
records independently of chat/app deletion and reconcile at application start.
Do not tie reporting lifetime to the cancelled generation AbortSignal.

Before first use, disclose both subscription usage and separate Dyad charges,
formula/fallback, and eligible credits. Show pending, settled, incomplete and
failed accounting states distinctly. Persist the accepted disclosure version.
Separate Dyad services such as auxiliary generation must have explicit
availability and charges; don't silently reuse Pro billing for this backend.

Required contract tests: replay after lost response, conflicting payload ID,
cross-account reservation misuse, concurrent admission, cache/TTL overlap,
auxiliary models, cancellation partial recovery, recognized incomplete rates,
catalog outage vs unknown model, fractional rounding, insufficient settlement
balance, outbox recovery, and deletion with pending reports.
