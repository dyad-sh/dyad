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

## BYO credit preflight

Before every subscription model request (including subsequent agent steps), Dyad
fetches the existing `GET https://api.dyad.sh/v1/user/info` using the same Dyad
billing key captured for that request. This uses a fresh main-process lookup,
not the five-minute UI cache or the UI's test-build mock balance.

- Positive `totalCredits - usedCredits`: proceed.
- Confirmed exhausted balance (including HTTP 200 with exhausted counts) or HTTP
  402: block before inference and ask the user to add credits.
- HTTP 401/403: block and ask the user to update the Dyad key.
- Timeout (five seconds), network failure, rate limiting, service errors, or
  invalid response: log a redacted warning and **allow generation**. No retry.
- User cancellation is not an outage; it stops the request.

Only BYO subscription generation is gated. Existing API-key/Pro inference routes
are unchanged, and the account display still returns null on lookup failure.
This is an eligibility check, not a reservation: spend may lag, concurrent calls
can pass together, and outages intentionally fail open. Post-generation usage
reporting remains a single attempt with no replay.

## Engine contract: POST /track-usage

Authentication is the user's **Dyad Pro key**, never their ChatGPT token. The UUID
`id` is for correlation only, not idempotency. There is no idempotency header.
Example body (all values are illustrative, not credentials):

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

Engine validates counts, authenticates the billing account, and attempts one
charge through `dyad/dyad-synthetic-cost-tracking`. On success it responds:

```json
{ "id": "f6d2a682-63bd-4e0a-a36a-78be594c3f93", "chargedUsd": 0.000015 }
```

Engine charges **$0.02 per million total tokens** for model IDs containing
`-luna`, `-mini`, or `-nano`; **$0.10 per million total tokens** for all other
models, including uncatalogued models. Matching uses the resolved model ID, not
the display name. Dyad does not calculate or submit a price.

`totalTokens = cachedInputTokens + uncachedInputTokens + outputTokens`. Cached
input means cache reads; cache creation/write tokens count as uncached input.
Output already includes reasoning: never add reasoning tokens again.

Each completed streamed model step triggers one background reporting attempt.
The billing account is captured when that request starts. A failure or missing
usage never blocks chat, and the stream does not wait for billing to finish.
There are no persisted reports, retries, local charge totals, reconciliation
controls, or startup replay. Old `codex-subscription-usage.json` files are ignored,
not read or replayed. Active request context is kept only in memory and consumed
before sending, preventing duplicate completion callbacks from reporting twice.

Engine makes one synthetic debit attempt per received report and has no usage
table or deduplication. Two separately submitted copies can charge twice; this
is best-effort single-attempt reporting, not exactly-once server processing.

### Remaining limitations and verification

- Network failures, cancellation without final usage, crashes, and shutdown can
  lose charges. This is an accepted trade-off; neither side replays them.
- Client-reported usage is not tamper-proof. Engine checks the balance at report
  time, but this is not an inference reservation or an account-wide spend lock.
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
resolved model usage, single-attempt failures, restart/no-replay behavior,
nonblocking stream completion, and normalized usage payloads.

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
real subscription, plus a real Engine single-attempt debit test.
