# Codex subscription

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
  "id": "f6d2a682-63bd-4e0a-a36a-78be594c3f93",
  "modelProvider": "openai",
  "connection": "subscription",
  "modelId": "gpt-5.6-astra",
  "createdAt": "2026-09-04T00:00:00.000Z",
  "totalTokens": 150,
  "cachedInputTokens": 20,
  "uncachedInputTokens": 80,
  "outputTokens": 50
}
```

Engine must validate counts, authenticate the billing account, authorize charges,
and claim each account/event ID before debiting. Confirmed receipts return
unchanged on retry. An ambiguous gateway timeout stays pending for reconciliation
rather than risking a duplicate debit:

```json
{ "id": "f6d2a682-63bd-4e0a-a36a-78be594c3f93", "chargedUsd": 0.000015 }
```

Engine charges **$0.033 per million total tokens** for model IDs containing
`-luna`, `-mini`, or `-nano`; **$0.10 per million total tokens** for all other
models, including uncatalogued models. Matching uses the resolved model ID, not
the display name. Dyad does not calculate or submit a price.

`totalTokens = cachedInputTokens + uncachedInputTokens + outputTokens`. Cached
input means cache reads; cache creation/write tokens count as uncached input.
Output already includes reasoning: never add reasoning tokens again. Existing
local ledger records retain their disjoint categories and are converted on send,
so pending usage survives the contract change without losing its event ID.

Each streamed model step has a durable report. Complete token usage is saved
before reporting; failures preserve the same ID for retry. New requests wait for
unsettled reports, and reports cannot be settled under a different Dyad key.
The device UI displays receipted charges and pending reports, not an estimate of
the user's full account balance. Engine is not implemented in this repository.

### Remaining limitations and verification

- A cancelled/crashed request without final usage is marked unresolved, never
  silently charged as zero. Subsequent subscription requests are blocked until
  reconciliation. There is no automatic Engine reconciliation protocol yet;
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
resolved model usage, idempotent report retries, cancellation, and normalized usage payloads.

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
