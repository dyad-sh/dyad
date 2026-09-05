# Codex subscription prototype

## Architecture and UX

The Subscription section of the model picker connects a ChatGPT account through
browser OAuth (PKCE). Dyad's main process stores its own credentials using
Electron safeStorage, refreshes them, and calls the Codex Responses endpoint
directly. Credentials never cross renderer IPC and are not imported from another
application. An available OS keyring is required; there is no plaintext fallback.

This is a transport for Dyad's existing agent, not the Codex CLI's agent loop.
Dyad still owns prompts, tool execution, permissions, file edits, preview and undo.
No extra shell tool is introduced. Existing Dyad tool permissions still apply.
Model availability is ultimately decided by the subscription service, not the API
catalog; unavailable models fail without switching to a paid API automatically.

Subscription, Pro credits and API key selections are persisted on the existing
chat. A switch applies to the next message, without creating a new chat. Portable
visible history and tool-call/result pairs are retained; account-bound reasoning
and provider item metadata are stripped at explicit connection boundaries.
Subscription replies are labeled `ChatGPT subscription (resolved model)`.
Legacy model choices retain their existing routing behavior. Separate auxiliary
services such as code exploration/review retain their existing billing routes;
the subscription is not a promise that every Dyad service uses ChatGPT.

## Engine contract: POST /track-usage

Authentication is the user's **Dyad Pro key**, never their ChatGPT token. The
`Idempotency-Key` header equals the persisted UUID `id`. Example body (all values
are illustrative, not credentials):

```json
{
  "version": 1,
  "id": "usage-event-uuid",
  "provider": "openai",
  "connection": "subscription",
  "model": "resolved-model-name",
  "createdAt": "2026-09-04T00:00:00.000Z",
  "tokens": { "input": 70, "cacheRead": 20, "cacheWrite": 10, "output": 50 },
  "catalog": { "knownModel": true, "version": "catalog-version" },
  "pricingPolicy": "subscription-v1"
}
```

Engine must validate counts, authenticate the billing account, authorize charges,
and atomically debit once per account/event ID. Repeat requests must return the
same receipt, including after a timeout following a successful debit:

```json
{ "id": "usage-event-uuid", "chargedUsd": 0.000123 }
```

Known local/remote catalog models cost **25% of their API list token rates**, per
category. Unknown models cost **$0.10 per million tokens across all categories**,
without an additional 25% multiplier. Categories are disjoint: `input` excludes
cache reads/writes; `output` already includes reasoning. Never add reasoning
tokens again. The pure calculator in `src/lib/subscriptionUsage.ts` defines this
arithmetic; Engine owns actual price lookup, model alias recognition, rounding,
balance enforcement and authoritative receipts. Current client catalogs do not
contain exact list prices. The client's catalog hint must not be trusted as a
billing authorization or price source.

Each streamed model step has a durable report. Complete token usage is saved
before reporting; failures preserve the same ID for retry. New requests wait for
unsettled reports, and reports cannot be settled under a different Dyad key.
The device UI displays receipted charges and pending reports, not an estimate of
the user's full account balance. Engine is not implemented in this repository.

### Prototype limitations / release blockers

- A cancelled/crashed request without final usage is marked unresolved, never
  silently charged as zero. Subsequent subscription requests are blocked until
  reconciliation. This prototype has no Engine reconciliation protocol yet;
  the Retry action cannot recover missing token counts. Other connections remain
  usable. Production needs a recoverable cancellation/accounting design.
- Direct client-reported usage is not tamper-proof. Production billing needs an
  explicit trust/abuse policy, preflight balance/reservation handling, and the
  deployed Engine endpoint. The first request can run before endpoint availability
  is known, but subsequent requests block on its unsettled receipt.
- Public native-client OAuth registration/transport follows the OpenCode pattern;
  that is not proof of authorization for a distributed, surcharged commercial
  integration. Confirm provider authorization before release.
- Nonstreaming generation through the subscription adapter is intentionally
  unsupported. Chat uses streaming; auxiliary services keep their existing routes.
- Real subscription inference has **not passed** on the implementation host:
  packaged Electron reports secure storage unavailable before browser sign-in.
  Do not treat mocked parser tests as proof of service compatibility.

## Verification

Unit/component coverage includes source routing, OAuth state/PKCE, secure-storage
refusal, portable history, real AI SDK SSE parsing against a fake response,
resolved model usage, idempotent report retries, cancellation, and pricing math.

For a real inference smoke, on an interactive machine with an available OS
keyring and a ChatGPT subscription:

```sh
npm run build
DYAD_LIVE_SUBSCRIPTION_SMOKE=1 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- codex_subscription_live.spec.ts
```

Complete the official browser sign-in locally; never paste credentials into logs
or chat. The opt-in test uses real subscription inference through packaged Dyad
and a **stub Engine receipt only**. It checks a file-tool edit, a same-chat
follow-up, model attribution and usage reports; it is not a production charge
test. Browser traces are disabled and the temporary profile's connection is
removed on exit. `DYAD_LIVE_SUBSCRIPTION_MODEL` can select an available model.

Before release, additionally exercise subscription-to-API/Pro switches with
real history, cancellation recovery, read-only modes, preview and undo on the
real subscription, plus a real Engine debit/retry test.
